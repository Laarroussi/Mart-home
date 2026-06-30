/**
 * /api/medical-exams — Examens médicaux importés (CPET, Pulse Wave, ...)
 *
 * Workflow :
 *   1. Le frontend parse le CSV/XLSX et envoie le tout en JSON (raw_file en base64 + parsed_summary + parsed_full)
 *   2. POST /         → crée la ligne en BDD avec status='parsed'
 *   3. GET /patient/:patient_id → liste des examens d'un patient (staff)
 *   4. GET /:id       → détail (avec parsed_full + raw_file si demandé)
 *   5. POST /:id/validate → l'investigateur valide → status='validated' + validated_data + historique
 *   6. PATCH /:id     → modifier après validation → status='modified_after_validation' + historique
 *
 * Permissions :
 *   - patient        : voit ses propres examens (sans validated_data ?)
 *   - investigator   : import + lecture + validation
 *   - principal_admin: tout + suppression
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();

// Limite raisonnable pour éviter abus (10 MB en base64 ≈ 7.5 MB de fichier)
const MAX_FILE_KB = 10 * 1024;

// ============================================================
// POST /api/medical-exams — Créer un examen importé
// Body : {
//   patient_id, exam_type, exam_date?, file_name, file_size_kb, file_mime,
//   raw_file (base64), parsed_summary (objet), parsed_full (objet), notes?
// }
// ============================================================
router.post('/', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const {
      patient_id, exam_type, exam_date, file_name, file_size_kb, file_mime,
      raw_file, parsed_summary, parsed_full, notes
    } = req.body || {};

    if (!patient_id) return res.status(400).json({ error: 'patient_id requis' });
    if (!['cpet','pulse_wave','echocardiography','biology','ecg','spirometry','other'].includes(exam_type)) {
      return res.status(400).json({ error: 'exam_type invalide' });
    }
    if (file_size_kb && file_size_kb > MAX_FILE_KB) {
      return res.status(413).json({ error: `Fichier trop volumineux (${file_size_kb} KB, max ${MAX_FILE_KB} KB)` });
    }

    const { rows } = await query(
      `INSERT INTO medical_exams
         (patient_id, exam_type, exam_date, file_name, file_size_kb, file_mime,
          raw_file, parsed_summary, parsed_full, notes, status, imported_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'parsed', $11)
       RETURNING id, patient_id, exam_type, exam_date, file_name, file_size_kb,
                 parsed_summary, status, imported_at, imported_by`,
      [patient_id, exam_type, exam_date || null, file_name || null,
       file_size_kb || null, file_mime || null,
       raw_file || null,
       parsed_summary ? JSON.stringify(parsed_summary) : null,
       parsed_full ? JSON.stringify(parsed_full) : null,
       notes || null, req.user.id]
    );
    res.status(201).json({ exam: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/medical-exams/patient/:patient_id — Liste pour un patient (résumée)
// Pas de raw_file ni parsed_full pour limiter la taille de la réponse
// ============================================================
router.get('/patient/:patient_id', requireAuth, async (req, res, next) => {
  try {
    // Patient ne peut voir que ses propres examens
    if (req.user.role === ROLE.PATIENT && req.user.patient_id !== req.params.patient_id) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const { rows } = await query(
      `SELECT id, patient_id, exam_type, exam_date, file_name, file_size_kb,
              parsed_summary, status, notes,
              imported_at, imported_by, validated_at, validated_by
         FROM medical_exams
        WHERE patient_id = $1
        ORDER BY exam_date DESC NULLS LAST, imported_at DESC`,
      [req.params.patient_id]
    );
    res.json({ exams: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/medical-exams/:id — Détail complet (avec parsed_full et raw_file)
// Paramètre ?withRaw=true pour inclure le base64 du fichier original
// ============================================================
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const cols = req.query.withRaw === 'true'
      ? '*'
      : `id, patient_id, exam_type, exam_date, file_name, file_size_kb, file_mime,
         parsed_summary, parsed_full, validated_data, modifications, notes, status,
         error_message, imported_at, imported_by, validated_at, validated_by`;
    const { rows } = await query(`SELECT ${cols} FROM medical_exams WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Examen introuvable' });
    const exam = rows[0];
    if (req.user.role === ROLE.PATIENT && exam.patient_id !== req.user.patient_id) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    res.json({ exam });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/medical-exams/:id/validate — Valider l'analyse
// Body : { validated_data (objet), notes? }
// ============================================================
router.post('/:id/validate', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const { validated_data, notes } = req.body || {};
    if (!validated_data) return res.status(400).json({ error: 'validated_data requis' });

    // Récupère l'ancien parsed_summary pour calculer l'historique
    const r0 = await query('SELECT parsed_summary, validated_data, status FROM medical_exams WHERE id = $1', [req.params.id]);
    if (!r0.rows.length) return res.status(404).json({ error: 'Introuvable' });

    const oldData = r0.rows[0].validated_data || r0.rows[0].parsed_summary || {};
    const newData = validated_data;
    const diffs = [];
    Object.keys(newData).forEach(k => {
      if (oldData[k] !== newData[k]) {
        diffs.push({ field: k, old: oldData[k], new: newData[k], by: req.user.id, at: new Date().toISOString() });
      }
    });

    const isFirstValidation = r0.rows[0].status !== 'validated' && r0.rows[0].status !== 'modified_after_validation';
    const newStatus = isFirstValidation ? 'validated' : 'modified_after_validation';

    const { rows } = await query(
      `UPDATE medical_exams
          SET validated_data = $1,
              modifications = COALESCE(modifications, '[]'::jsonb) || $2::jsonb,
              status = $3,
              validated_by = $4,
              validated_at = COALESCE(validated_at, NOW()),
              notes = COALESCE($5, notes)
        WHERE id = $6
        RETURNING id, status, validated_at, validated_by, validated_data, modifications`,
      [JSON.stringify(newData), JSON.stringify(diffs), newStatus, req.user.id, notes || null, req.params.id]
    );
    res.json({ exam: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/medical-exams/:id/graph-config — Sauvegarde curseurs + recalcul
// Body : {
//   graph_config (objet : positions curseurs, zones, choix manuel),
//   validated_data (optionnel : valeurs recalculées),
//   validate (bool : si true → status='validated' et validated_by/at remplis),
//   notes (optionnel)
// }
// ============================================================
router.post('/:id/graph-config', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const { graph_config, validated_data, validate, notes } = req.body || {};
    if (!graph_config) return res.status(400).json({ error: 'graph_config requis' });

    // Récupère l'ancien état pour historique
    const r0 = await query('SELECT graph_config, validated_data, status FROM medical_exams WHERE id = $1', [req.params.id]);
    if (!r0.rows.length) return res.status(404).json({ error: 'Introuvable' });
    const oldGraph = r0.rows[0].graph_config || {};
    const oldData = r0.rows[0].validated_data || {};

    // Diffs pour traçabilité
    const diffs = [];
    Object.keys(graph_config).forEach(k => {
      if (JSON.stringify(oldGraph[k]) !== JSON.stringify(graph_config[k])) {
        diffs.push({ scope: 'graph_config', field: k, old: oldGraph[k], new: graph_config[k], by: req.user.id, at: new Date().toISOString() });
      }
    });
    if (validated_data) {
      Object.keys(validated_data).forEach(k => {
        if (oldData[k] !== validated_data[k]) {
          diffs.push({ scope: 'validated_data', field: k, old: oldData[k], new: validated_data[k], by: req.user.id, at: new Date().toISOString() });
        }
      });
    }

    let newStatus;
    if (validate) {
      const isFirst = r0.rows[0].status !== 'validated' && r0.rows[0].status !== 'modified_after_validation';
      newStatus = isFirst ? 'validated' : 'modified_after_validation';
    } else {
      newStatus = r0.rows[0].status; // garde le statut actuel
    }

    const { rows } = await query(
      `UPDATE medical_exams
          SET graph_config = $1,
              validated_data = COALESCE($2, validated_data),
              modifications = COALESCE(modifications, '[]'::jsonb) || $3::jsonb,
              status = $4,
              validated_by = CASE WHEN $5 THEN $6 ELSE validated_by END,
              validated_at = CASE WHEN $5 THEN COALESCE(validated_at, NOW()) ELSE validated_at END,
              notes = COALESCE($7, notes)
        WHERE id = $8
        RETURNING id, status, validated_at, validated_by, validated_data, graph_config, modifications`,
      [JSON.stringify(graph_config),
       validated_data ? JSON.stringify(validated_data) : null,
       JSON.stringify(diffs),
       newStatus,
       !!validate, req.user.id,
       notes || null,
       req.params.id]
    );
    res.json({ exam: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/medical-exams/:id — Supprimer (principal_admin uniquement)
// ============================================================
router.delete('/:id', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), async (req, res, next) => {
  try {
    const r = await query('DELETE FROM medical_exams WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Introuvable' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/medical-exams — Liste filtrable (staff)
// Filtres : ?type=cpet|pulse_wave, ?status=, ?patient_id=
// ============================================================
router.get('/', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    let sql = `SELECT id, patient_id, exam_type, exam_date, file_name, file_size_kb,
                      parsed_summary, status, notes, imported_at, validated_at
                 FROM medical_exams WHERE 1=1`;
    const params = [];
    if (req.query.type)       { params.push(req.query.type); sql += ` AND exam_type = $${params.length}`; }
    if (req.query.status)     { params.push(req.query.status); sql += ` AND status = $${params.length}`; }
    if (req.query.patient_id) { params.push(req.query.patient_id); sql += ` AND patient_id = $${params.length}`; }
    sql += ' ORDER BY exam_date DESC NULLS LAST, imported_at DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json({ exams: rows });
  } catch (err) { next(err); }
});

module.exports = router;
