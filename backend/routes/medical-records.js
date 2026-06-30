/**
 * /api/medical-records — Dossier médical structuré du patient
 * =============================================================
 * Routes :
 *   GET    /:patient_id                          → renvoie le dossier (8 sections)
 *   PATCH  /:patient_id/:section                 → met à jour une section (avec traçabilité)
 *   GET    /:patient_id/documents                → liste les PDF importés
 *   POST   /:patient_id/documents                → upload PDF + texte extrait + data extraite
 *   GET    /:patient_id/documents/:id            → détail (avec raw_file si ?withRaw=true)
 *   POST   /:patient_id/documents/:id/integrate  → intègre les données validées dans le dossier
 *   POST   /:patient_id/documents/:id/reject     → rejette
 *   DELETE /:patient_id/documents/:id            → supprime (principal_admin uniquement)
 *
 * Permissions :
 *   - patient     : lecture seule de son propre dossier (sans sources/modifications/raw_file)
 *   - investigator: lecture + écriture + import + intégration
 *   - principal_admin: tout + suppression
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();
const MAX_FILE_KB = 12 * 1024; // 12 MB max pour un PDF

const VALID_SECTIONS = [
  'identity', 'history', 'antecedents',
  'patient_goals', 'clinician_goals', 'key_points',
  'evaluations_summary', 'sessions_summary'
];

// === Helper : vérifie l'accès au dossier d'un patient ===
function canRead(user, patientId) {
  if (user.role === ROLE.PATIENT) return user.patient_id === patientId;
  return true; // investigator + principal_admin
}
function canWrite(user) {
  return user.role === ROLE.INVESTIGATOR || user.role === ROLE.PRINCIPAL_ADMIN;
}

// === Helper : crée ou récupère le dossier ===
async function ensureRecord(patientId) {
  const r = await query('SELECT * FROM medical_records WHERE patient_id = $1', [patientId]);
  if (r.rows.length) return r.rows[0];
  const ins = await query(
    'INSERT INTO medical_records (patient_id) VALUES ($1) RETURNING *',
    [patientId]
  );
  return ins.rows[0];
}

// ============================================================
// GET /:patient_id — récupère le dossier complet
// ============================================================
router.get('/:patient_id', requireAuth, async (req, res, next) => {
  try {
    if (!canRead(req.user, req.params.patient_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const rec = await ensureRecord(req.params.patient_id);
    // Filtre pour le rôle patient
    if (req.user.role === ROLE.PATIENT) {
      delete rec.sources;
      delete rec.modifications;
    }
    res.json({ record: rec });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /:patient_id/:section — met à jour une section
// Body : { data: <objet de la section>, source?: 'manual'|'pdf'|'cpet'|'pulse_wave'|..., source_doc_id?, comment? }
// ============================================================
router.patch('/:patient_id/:section', requireAuth, async (req, res, next) => {
  try {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const section = req.params.section;
    if (!VALID_SECTIONS.includes(section)) {
      return res.status(400).json({ error: 'Section invalide. Valeurs autorisées : ' + VALID_SECTIONS.join(', ') });
    }
    const { data, source, source_doc_id, comment } = req.body || {};
    if (data == null || typeof data !== 'object') {
      return res.status(400).json({ error: 'data requis (objet)' });
    }
    const rec = await ensureRecord(req.params.patient_id);
    const oldData = rec[section] || {};

    // Calcule diffs champ par champ
    const diffs = [];
    const allKeys = new Set([...Object.keys(oldData), ...Object.keys(data)]);
    for (const k of allKeys) {
      if (JSON.stringify(oldData[k]) !== JSON.stringify(data[k])) {
        diffs.push({
          section, field: k,
          old: oldData[k] != null ? oldData[k] : null,
          new: data[k] != null ? data[k] : null,
          by: req.user.id,
          source: source || 'manual',
          source_doc_id: source_doc_id || null,
          comment: comment || null,
          at: new Date().toISOString()
        });
      }
    }

    // Met à jour sources : chaque champ modifié reçoit sa source
    const newSources = { ...(rec.sources || {}) };
    if (!newSources[section]) newSources[section] = {};
    for (const k of Object.keys(data)) {
      newSources[section][k] = {
        source: source || 'manual',
        source_doc_id: source_doc_id || null,
        by: req.user.id,
        at: new Date().toISOString()
      };
    }

    const updateSQL = `
      UPDATE medical_records
         SET ${section} = $1::jsonb,
             sources = $2::jsonb,
             modifications = COALESCE(modifications, '[]'::jsonb) || $3::jsonb,
             updated_at = NOW(),
             updated_by = $4
       WHERE patient_id = $5
       RETURNING *`;
    const u = await query(updateSQL,
      [JSON.stringify(data), JSON.stringify(newSources),
       JSON.stringify(diffs), req.user.id, req.params.patient_id]);
    res.json({ record: u.rows[0], diffs });
  } catch (err) { next(err); }
});

// ============================================================
// GET /:patient_id/documents — liste les PDF importés
// ============================================================
router.get('/:patient_id/documents', requireAuth, async (req, res, next) => {
  try {
    if (!canRead(req.user, req.params.patient_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const { rows } = await query(
      `SELECT id, patient_id, file_name, file_size_kb, file_mime,
              extracted_data, integrated_data, status, ocr_used, notes,
              uploaded_at, uploaded_by, reviewed_at, reviewed_by
         FROM medical_record_documents
        WHERE patient_id = $1
        ORDER BY uploaded_at DESC`,
      [req.params.patient_id]);
    res.json({ documents: rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /:patient_id/documents — upload PDF (base64) + texte extrait
// Body : { file_name, file_size_kb, file_mime, raw_file (base64),
//          extracted_text, extracted_data (objet par section), ocr_used?, notes? }
// ============================================================
router.post('/:patient_id/documents', requireAuth, async (req, res, next) => {
  try {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const {
      file_name, file_size_kb, file_mime, raw_file,
      extracted_text, extracted_data, ocr_used, notes
    } = req.body || {};
    if (!file_name || !raw_file) return res.status(400).json({ error: 'file_name et raw_file requis' });
    if (file_size_kb && file_size_kb > MAX_FILE_KB) {
      return res.status(413).json({ error: `Fichier trop volumineux (${file_size_kb} KB, max ${MAX_FILE_KB} KB)` });
    }
    const { rows } = await query(
      `INSERT INTO medical_record_documents
         (patient_id, file_name, file_size_kb, file_mime, raw_file,
          extracted_text, extracted_data, status, ocr_used, notes, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10)
       RETURNING id, file_name, file_size_kb, status, uploaded_at`,
      [req.params.patient_id, file_name, file_size_kb || null, file_mime || 'application/pdf',
       raw_file, extracted_text || null,
       extracted_data ? JSON.stringify(extracted_data) : null,
       !!ocr_used, notes || null, req.user.id]);
    res.status(201).json({ document: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// GET /:patient_id/documents/:id — détail (avec ?withRaw=true pour le PDF base64)
// ============================================================
router.get('/:patient_id/documents/:id', requireAuth, async (req, res, next) => {
  try {
    if (!canRead(req.user, req.params.patient_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const cols = req.query.withRaw === 'true' ? '*' : `id, patient_id, file_name, file_size_kb, file_mime,
            extracted_text, extracted_data, integrated_data, status, ocr_used,
            notes, uploaded_at, uploaded_by, reviewed_at, reviewed_by`;
    const { rows } = await query(
      `SELECT ${cols} FROM medical_record_documents
        WHERE id = $1 AND patient_id = $2`,
      [req.params.id, req.params.patient_id]);
    if (!rows.length) return res.status(404).json({ error: 'Document introuvable' });
    res.json({ document: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /:patient_id/documents/:id/integrate
// Body : { sections_to_integrate: { identity:{...}, history:{...}, ... },
//          comment? }
// → Met à jour les sections concernées du dossier + enregistre la trace
// → Passe le statut du document à 'integrated' (ou 'partial' si certaines sections sont vides)
// ============================================================
router.post('/:patient_id/documents/:id/integrate', requireAuth, async (req, res, next) => {
  try {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const { sections_to_integrate, comment } = req.body || {};
    if (!sections_to_integrate || typeof sections_to_integrate !== 'object') {
      return res.status(400).json({ error: 'sections_to_integrate requis (objet)' });
    }
    const rec = await ensureRecord(req.params.patient_id);
    const docRes = await query('SELECT id, file_name FROM medical_record_documents WHERE id=$1 AND patient_id=$2',
      [req.params.id, req.params.patient_id]);
    if (!docRes.rows.length) return res.status(404).json({ error: 'Document introuvable' });
    const docInfo = docRes.rows[0];

    const diffs = [];
    const updates = {};
    const newSources = { ...(rec.sources || {}) };

    for (const section of Object.keys(sections_to_integrate)) {
      if (!VALID_SECTIONS.includes(section)) continue;
      const newData = sections_to_integrate[section];
      if (newData == null || typeof newData !== 'object') continue;
      // Merge avec la section existante (ne remplace que les champs présents dans newData)
      const merged = { ...(rec[section] || {}), ...newData };
      updates[section] = merged;
      // Diffs
      for (const k of Object.keys(newData)) {
        if (JSON.stringify((rec[section] || {})[k]) !== JSON.stringify(newData[k])) {
          diffs.push({
            section, field: k,
            old: (rec[section] || {})[k] != null ? (rec[section] || {})[k] : null,
            new: newData[k],
            by: req.user.id,
            source: 'pdf',
            source_doc_id: parseInt(req.params.id, 10),
            source_file: docInfo.file_name,
            comment: comment || null,
            at: new Date().toISOString()
          });
        }
      }
      // Sources par champ
      if (!newSources[section]) newSources[section] = {};
      for (const k of Object.keys(newData)) {
        newSources[section][k] = {
          source: 'pdf',
          source_doc_id: parseInt(req.params.id, 10),
          source_file: docInfo.file_name,
          by: req.user.id,
          at: new Date().toISOString()
        };
      }
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Aucune section valide à intégrer' });
    }

    // Construit la requête UPDATE dynamique
    const setClauses = [];
    const params = [];
    let i = 1;
    for (const section of Object.keys(updates)) {
      setClauses.push(`${section} = $${i}::jsonb`);
      params.push(JSON.stringify(updates[section]));
      i++;
    }
    setClauses.push(`sources = $${i}::jsonb`);  params.push(JSON.stringify(newSources)); i++;
    setClauses.push(`modifications = COALESCE(modifications, '[]'::jsonb) || $${i}::jsonb`); params.push(JSON.stringify(diffs)); i++;
    setClauses.push(`updated_at = NOW()`);
    setClauses.push(`updated_by = $${i}`); params.push(req.user.id); i++;
    params.push(req.params.patient_id);
    const updated = await query(
      `UPDATE medical_records SET ${setClauses.join(', ')} WHERE patient_id = $${i} RETURNING *`,
      params);

    // Met à jour le statut du document
    const integratedSnapshot = JSON.stringify(sections_to_integrate);
    await query(
      `UPDATE medical_record_documents
          SET status = 'integrated',
              integrated_data = $1::jsonb,
              reviewed_at = NOW(),
              reviewed_by = $2
        WHERE id = $3`,
      [integratedSnapshot, req.user.id, req.params.id]);

    res.json({ record: updated.rows[0], diffs_count: diffs.length });
  } catch (err) { next(err); }
});

// ============================================================
// POST /:patient_id/documents/:id/reject — rejette le document
// ============================================================
router.post('/:patient_id/documents/:id/reject', requireAuth, async (req, res, next) => {
  try {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const { notes } = req.body || {};
    const { rows } = await query(
      `UPDATE medical_record_documents
          SET status='rejected', reviewed_at=NOW(), reviewed_by=$1, notes=COALESCE($2, notes)
        WHERE id=$3 AND patient_id=$4 RETURNING id, status, reviewed_at, reviewed_by`,
      [req.user.id, notes || null, req.params.id, req.params.patient_id]);
    if (!rows.length) return res.status(404).json({ error: 'Introuvable' });
    res.json({ document: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /:patient_id/documents/:id — suppression (principal_admin)
// ============================================================
router.delete('/:patient_id/documents/:id', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), async (req, res, next) => {
  try {
    const r = await query('DELETE FROM medical_record_documents WHERE id=$1 AND patient_id=$2',
      [req.params.id, req.params.patient_id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Introuvable' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
