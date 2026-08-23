/**
 * /api/consultations — Consultations chronologiques + suivi aortique
 * ==================================================================
 * Routes :
 *   GET    /:patient_id            → liste des consultations (récent → ancien)
 *   POST   /:patient_id            → nouvelle consultation du jour
 *   PATCH  /:patient_id/:id        → modifier une consultation existante
 *   DELETE /:patient_id/:id        → supprimer (principal_admin uniquement)
 *   GET    /:patient_id/aortic     → suivi aortique (baseline + actuel)
 *   PATCH  /:patient_id/aortic     → met à jour le suivi aortique
 *
 * Permissions :
 *   - patient        : lecture seule de ses propres consultations
 *   - investigator   : lecture + création + modification
 *   - principal_admin: tout + suppression
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();

function canRead(user, patientId) {
  if (user.role === ROLE.PATIENT) return user.patient_id === patientId;
  return true;
}
function canWrite(user) {
  return user.role === ROLE.INVESTIGATOR || user.role === ROLE.PRINCIPAL_ADMIN;
}

// ============================================================
// GET /:patient_id — liste des consultations
// ============================================================
router.get('/:patient_id', requireAuth, async (req, res, next) => {
  try {
    if (!canRead(req.user, req.params.patient_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const { rows } = await query(
      `SELECT * FROM consultations
        WHERE patient_id = $1
        ORDER BY consultation_date DESC, created_at DESC`,
      [req.params.patient_id]
    );
    res.json({ consultations: rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /:patient_id — nouvelle consultation
// Body : { consultation_date?, aortic_value_mm?, aortic_site?, aortic_method?,
//          evolution?, evolution_detail?, apa_adaptation?, treatment_change?,
//          comment?, sessions_summary? }
// ============================================================
router.post('/:patient_id', requireAuth, async (req, res, next) => {
  try {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const b = req.body || {};
    const { rows } = await query(
      `INSERT INTO consultations
         (patient_id, consultation_date, aortic_value_mm, aortic_site, aortic_method,
          evolution, evolution_detail, apa_adaptation, treatment_change, comment,
          sessions_summary, created_by)
       VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [req.params.patient_id,
       b.consultation_date || null,
       b.aortic_value_mm != null ? b.aortic_value_mm : null,
       b.aortic_site || null,
       b.aortic_method || null,
       b.evolution || null,
       b.evolution_detail || null,
       b.apa_adaptation || null,
       b.treatment_change || null,
       b.comment || null,
       b.sessions_summary ? JSON.stringify(b.sessions_summary) : null,
       req.user.id]
    );
    const consult = rows[0];

    // Si une mesure aortique est fournie, on met à jour le "current" du suivi aortique
    if (b.aortic_value_mm != null) {
      await query(
        `INSERT INTO medical_records (patient_id, aortic_followup)
         VALUES ($1, jsonb_build_object(
             'current_value_mm', $2::numeric,
             'current_date', COALESCE($3::date, CURRENT_DATE),
             'current_site', $4::text
         ))
         ON CONFLICT (patient_id) DO UPDATE
           SET aortic_followup = COALESCE(medical_records.aortic_followup, '{}'::jsonb) ||
               jsonb_build_object(
                 'current_value_mm', $2::numeric,
                 'current_date', COALESCE($3::date, CURRENT_DATE),
                 'current_site', $4::text
               ),
               updated_at = NOW()`,
        [req.params.patient_id, b.aortic_value_mm, b.consultation_date || null, b.aortic_site || null]
      );
    }
    res.status(201).json({ consultation: consult });
  } catch (err) { next(err); }
});

// ============================================================
// GET /:patient_id/aortic — suivi aortique
// ⚠ DOIT être déclarée AVANT /:patient_id/:id, sinon Express fait
//   correspondre "aortic" au paramètre :id (erreur SQL sur id entier).
// ============================================================
router.get('/:patient_id/aortic', requireAuth, async (req, res, next) => {
  try {
    if (!canRead(req.user, req.params.patient_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const { rows } = await query(
      'SELECT aortic_followup FROM medical_records WHERE patient_id = $1',
      [req.params.patient_id]
    );
    res.json({ aortic: rows.length ? (rows[0].aortic_followup || {}) : {} });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /:patient_id/aortic — met à jour le suivi aortique
// Body : { first_diagnosis_date?, first_value_mm?, first_site?, first_comment?,
//          current_value_mm?, current_date?, current_site?, notes? }
// ⚠ DOIT être déclarée AVANT /:patient_id/:id (voir remarque ci-dessus).
// ============================================================
router.patch('/:patient_id/aortic', requireAuth, async (req, res, next) => {
  try {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const b = req.body || {};
    const { rows } = await query(
      `INSERT INTO medical_records (patient_id, aortic_followup, updated_by)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (patient_id) DO UPDATE
         SET aortic_followup = COALESCE(medical_records.aortic_followup, '{}'::jsonb) || $2::jsonb,
             updated_at = NOW(),
             updated_by = $3
       RETURNING aortic_followup`,
      [req.params.patient_id, JSON.stringify(b), req.user.id]
    );
    res.json({ aortic: rows[0].aortic_followup });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /:patient_id/:id — modifier une consultation
// ============================================================
router.patch('/:patient_id/:id', requireAuth, async (req, res, next) => {
  try {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const b = req.body || {};
    const allowed = ['consultation_date','aortic_value_mm','aortic_site','aortic_method',
                     'evolution','evolution_detail','apa_adaptation','treatment_change','comment'];
    const sets = [];
    const params = [];
    allowed.forEach(k => {
      if (b[k] !== undefined) { params.push(b[k]); sets.push(`${k} = $${params.length}`); }
    });
    if (!sets.length) return res.status(400).json({ error: 'Aucun champ à modifier' });
    params.push(req.user.id); sets.push(`updated_by = $${params.length}`);
    sets.push(`updated_at = NOW()`);
    params.push(req.params.id, req.params.patient_id);
    const { rows } = await query(
      `UPDATE consultations SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND patient_id = $${params.length}
        RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Consultation introuvable' });
    res.json({ consultation: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /:patient_id/:id — suppression (principal_admin)
// ============================================================
router.delete('/:patient_id/:id', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), async (req, res, next) => {
  try {
    const r = await query('DELETE FROM consultations WHERE id=$1 AND patient_id=$2',
      [req.params.id, req.params.patient_id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Introuvable' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
