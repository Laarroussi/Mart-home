/**
 * /api/cohort — KPIs, vues agrégées, BDD longitudinale/large/éducation
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

/** GET /api/cohort/overview — KPI cohorte */
router.get('/overview', requireAuth, requireRole('admin','principal','investigator'), async (req, res, next) => {
  try {
    const [overview, geneDist, evalCount] = await Promise.all([
      query('SELECT * FROM v_cohort_overview'),
      query(`SELECT gene, COUNT(*) AS count FROM patients GROUP BY gene ORDER BY count DESC`),
      query('SELECT COUNT(*) AS total FROM evaluations')
    ]);
    res.json({
      ...overview.rows[0],
      total_evaluations: parseInt(evalCount.rows[0].total, 10),
      gene_distribution: geneDist.rows
    });
  } catch (err) { next(err); }
});

/** GET /api/cohort/database?mode=long|wide|edu */
router.get('/database', requireAuth, requireRole('admin','principal','investigator'), async (req, res, next) => {
  try {
    const mode = req.query.mode || 'long';
    if (mode === 'long') {
      const { rows } = await query(`
        SELECT p.id AS patient, p.sex, p.age, p.gene, p.status, p.status_class,
               e.eval_id, e.label, e.eval_date, e.vo2, e.sv1, e.sv2, e.ve_vco2_slope,
               e.watts, e.fc_max, e.force_kg, e.sf36, e.gpaq, e.aorta, e.validated, e.note
        FROM patients p JOIN evaluations e ON e.patient_id = p.id
        ORDER BY p.id, e.eval_id`);
      res.json({ mode, rows });
    } else if (mode === 'wide') {
      const max = await query('SELECT MAX(eval_count) AS m FROM (SELECT COUNT(*) AS eval_count FROM evaluations GROUP BY patient_id) t');
      const maxEval = parseInt(max.rows[0].m, 10) || 0;
      const patients = await query('SELECT * FROM patients ORDER BY id');
      const evals = await query('SELECT * FROM evaluations ORDER BY patient_id, eval_id');
      const map = {};
      evals.rows.forEach(e => { (map[e.patient_id] ||= []).push(e); });
      const rows = patients.rows.map(p => ({ patient: p, evaluations: map[p.id] || [] }));
      res.json({ mode, max_visits: maxEval, rows });
    } else if (mode === 'edu') {
      const { rows } = await query(`
        SELECT p.id AS patient, p.sex, p.gene, p.status_class,
               c.id AS capsule_id, c.title AS capsule_title, c.theme,
               er.sent_date, er.pre_status, er.pre_score, er.pre_completed_date,
               er.video_watched, er.video_watched_date,
               er.post_status, er.post_score, er.post_completed_date,
               er.validated,
               (er.post_score - er.pre_score) AS delta
        FROM patients p
        CROSS JOIN education_capsules c
        LEFT JOIN education_records er ON er.patient_id = p.id AND er.capsule_id = c.id
        WHERE er.id IS NOT NULL OR er.sent_date IS NOT NULL
        ORDER BY p.id, c.id`);
      res.json({ mode, rows });
    } else {
      res.status(400).json({ error: 'mode = long | wide | edu' });
    }
  } catch (err) { next(err); }
});

/** GET /api/cohort/export?mode=long|wide|edu — Export CSV */
router.get('/export', requireAuth, requireRole('admin','principal','investigator'), async (req, res, next) => {
  try {
    const mode = req.query.mode || 'long';
    // Réutilise la même logique mais sort en CSV
    let sql;
    if (mode === 'long') {
      sql = `SELECT p.id, p.sex, p.age, p.gene, p.status,
                    e.eval_id, e.label, e.eval_date,
                    e.vo2, e.sv1, e.sv2, e.force_kg, e.aorta, e.sf36, e.gpaq, e.validated
             FROM patients p JOIN evaluations e ON e.patient_id = p.id
             ORDER BY p.id, e.eval_id`;
    } else if (mode === 'edu') {
      sql = `SELECT p.id AS patient, c.title AS capsule, er.sent_date,
                    er.pre_status, er.pre_score, er.video_watched,
                    er.post_status, er.post_score, er.validated
             FROM education_records er
             JOIN patients p ON p.id = er.patient_id
             JOIN education_capsules c ON c.id = er.capsule_id
             ORDER BY p.id, c.id`;
    } else {
      return res.status(400).json({ error: 'Mode invalide' });
    }
    const { rows } = await query(sql);
    if (!rows.length) return res.status(404).json({ error: 'Aucune donnée' });

    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map(r => headers.map(h => {
        const v = r[h] == null ? '' : String(r[h]).replace(/"/g, '""');
        return `"${v}"`;
      }).join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="marfan-apa-${mode}-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send('﻿' + csv); // BOM UTF-8 pour Excel
  } catch (err) { next(err); }
});

module.exports = router;
