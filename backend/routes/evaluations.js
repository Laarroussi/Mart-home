/**
 * /api/evaluations — Évaluations longitudinales d'un patient
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/** GET /api/evaluations/:patientId */
router.get('/:patientId', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'patient' && req.user.patient_id !== req.params.patientId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    const { rows } = await query(
      'SELECT * FROM evaluations WHERE patient_id = $1 ORDER BY eval_id',
      [req.params.patientId]
    );
    res.json({ evaluations: rows });
  } catch (err) { next(err); }
});

/** POST /api/evaluations/:patientId — Nouvelle évaluation */
router.post('/:patientId', requireAuth, requireRole('principal_admin', 'investigator'), async (req, res, next) => {
  try {
    const ev = req.body || {};
    // ID = max eval_id + 1
    const max = await query('SELECT COALESCE(MAX(eval_id), 0) AS max FROM evaluations WHERE patient_id = $1', [req.params.patientId]);
    const evalId = max.rows[0].max + 1;
    const { rows } = await query(
      `INSERT INTO evaluations (patient_id, eval_id, label, eval_date, vo2, sv1, sv2, ve_vco2_slope, watts, fc_max,
                                force_kg, sf36, gpaq, aorta, validated, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [req.params.patientId, evalId, ev.label || ('Évaluation ' + evalId), ev.date,
       ev.vo2, ev.sv1, ev.sv2, ev.ve_vco2_slope, ev.watts, ev.fc_max,
       ev.force, ev.sf36, ev.gpaq, ev.aorta, ev.validated !== false, ev.note || '']
    );
    res.status(201).json({ evaluation: rows[0] });
  } catch (err) { next(err); }
});

/** PATCH /api/evaluations/:id — Modifier une éval (notamment ajouter vo2_data/pulse_data/thresholds) */
router.patch('/by-id/:id', requireAuth, requireRole('principal_admin', 'investigator'), async (req, res, next) => {
  try {
    const allowed = ['label','eval_date','vo2','sv1','sv2','ve_vco2_slope','watts','fc_max','force_kg','sf36','gpaq','aorta','validated','note','vo2_data','pulse_data','thresholds'];
    const fields = []; const params = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        params.push(['vo2_data','pulse_data','thresholds'].includes(k) ? JSON.stringify(req.body[k]) : req.body[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE evaluations SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Évaluation introuvable' });
    res.json({ evaluation: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
