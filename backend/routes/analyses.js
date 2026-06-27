/**
 * /api/analyses — Upload fichiers VO₂ / pOpmètre + parsing métriques
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { query } = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const uploadDir = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, Date.now() + '-' + safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.UPLOAD_MAX_SIZE_MB, 10) || 20) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.(csv|xlsx|xls|txt)$/i.test(file.originalname);
    if (!ok) return cb(new Error('Format non accepté (CSV/XLSX/TXT uniquement)'));
    cb(null, true);
  }
});

/** POST /api/analyses/:type/upload/:patientId/:evaluationId
 *  type = 'vo2' | 'pulse'
 *  form-data : file = <fichier>
 */
router.post('/:type/upload/:patientId/:evaluationId', requireAuth, requireRole('admin', 'principal', 'investigator'),
  upload.single('file'), async (req, res, next) => {
  try {
    const { type, patientId, evaluationId } = req.params;
    if (!['vo2', 'pulse'].includes(type)) return res.status(400).json({ error: 'type doit être vo2 ou pulse' });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu' });

    // Parsing : pour VO2 = XLSX, pour pulse = CSV
    let metrics = {};
    try {
      if (type === 'vo2') {
        const wb = XLSX.readFile(req.file.path);
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
        metrics = parseVo2(rows);
      } else {
        const text = fs.readFileSync(req.file.path, 'utf8');
        metrics = parsePulseCsv(text);
      }
    } catch (parseErr) {
      console.error('[ANALYSES] parsing failed', parseErr.message);
      metrics = { parseError: parseErr.message };
    }

    const { rows } = await query(
      `INSERT INTO analyses_files (patient_id, evaluation_id, file_type, file_name, file_path, file_size, metrics, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [patientId, evaluationId, type, req.file.originalname, req.file.path, req.file.size, JSON.stringify(metrics), req.user.id]
    );

    // Met à jour l'évaluation avec les métriques clés
    if (type === 'vo2' && metrics.vo2max) {
      await query('UPDATE evaluations SET vo2 = $1, sv1 = $2, ve_vco2_slope = $3, vo2_data = $4 WHERE id = $5',
        [metrics.vo2max, metrics.sv1, metrics.vevco2Slope, JSON.stringify(metrics), evaluationId]);
    } else if (type === 'pulse' && metrics.pwv) {
      await query('UPDATE evaluations SET pulse_data = $1 WHERE id = $2',
        [JSON.stringify(metrics), evaluationId]);
    }

    res.status(201).json({ file: rows[0], metrics });
  } catch (err) { next(err); }
});

/** GET /api/analyses/:patientId */
router.get('/:patientId', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'patient' && req.user.patient_id !== req.params.patientId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    const { rows } = await query(
      'SELECT * FROM analyses_files WHERE patient_id = $1 ORDER BY uploaded_at DESC',
      [req.params.patientId]
    );
    res.json({ files: rows });
  } catch (err) { next(err); }
});

// ============================================================
// Parsers minimalistes (les vrais algos sont côté frontend)
// ============================================================
function parseVo2(rows) {
  // Détecte la ligne d'en-tête contenant VO2 + VCO2
  let headerRow = 0;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const joined = (rows[i] || []).join(' ').toLowerCase();
    if (joined.includes('vo2') && joined.includes('vco2')) { headerRow = i; break; }
  }
  const headers = (rows[headerRow] || []).map(h => h == null ? '' : String(h).trim());
  const vo2Idx = headers.findIndex(h => /vo2\/?kg|vo2kg|^vo2$/i.test(h));
  const fcIdx  = headers.findIndex(h => /^fc$|^hr$|heart/i.test(h));
  const wIdx   = headers.findIndex(h => /watt|puiss|power/i.test(h));
  let vo2max = -Infinity, fcmax = -Infinity, pmax = -Infinity;
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const v = parseFloat(r[vo2Idx]); if (Number.isFinite(v) && v > vo2max) vo2max = v;
    const f = parseFloat(r[fcIdx]);  if (Number.isFinite(f) && f > fcmax) fcmax = f;
    const w = parseFloat(r[wIdx]);   if (Number.isFinite(w) && w > pmax)  pmax = w;
  }
  return {
    vo2max: vo2max > -Infinity ? Math.round(vo2max * 10) / 10 : null,
    fcmax: fcmax > -Infinity ? Math.round(fcmax) : null,
    pmax: pmax > -Infinity ? Math.round(pmax) : null,
    sv1: null, vevco2Slope: null,
    n: Math.max(0, rows.length - headerRow - 1)
  };
}

function parsePulseCsv(text) {
  const info = {};
  text.split(/\r?\n/).forEach(line => {
    const m = line.match(/^([^:;,]+)[:;,]\s*(.+)$/);
    if (m) info[m[1].trim().toLowerCase()] = m[2].trim();
  });
  const getNum = (keys) => {
    for (const k of keys) {
      const found = Object.keys(info).find(key => key.includes(k));
      if (found) {
        const n = parseFloat(String(info[found]).replace(',', '.').replace(/[^\d.\-]/g, ''));
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  };
  return {
    pwv: getNum(['pwv', 'ftpwv', 'vop']),
    ptt: getNum(['ptt', 'transit']),
    aix: getNum(['augmentation', 'aix']),
    sbp: getNum(['sbp', 'systol']),
    dbp: getNum(['dbp', 'diastol']),
    hr:  getNum(['hr', 'fc'])
  };
}

module.exports = router;
