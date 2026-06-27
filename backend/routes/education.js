/**
 * /api/education — Capsules + workflow (pré → vidéo → post) + scores + validation
 */
const express = require('express');
const { query, transaction } = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const VALIDATION_THRESHOLD = 70;

/** GET /api/education/capsules — Liste capsules disponibles */
router.get('/capsules', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM education_capsules WHERE active = true ORDER BY id');
    res.json({ capsules: rows });
  } catch (err) { next(err); }
});

/** GET /api/education/summary — Synthèse cohorte par capsule (vue v_education_summary) */
router.get('/summary', requireAuth, requireRole('principal_admin', 'investigator'), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM v_education_summary ORDER BY capsule_id');
    res.json({ summary: rows });
  } catch (err) { next(err); }
});

/** GET /api/education/records — Filtrable par patient et/ou capsule */
router.get('/records', requireAuth, async (req, res, next) => {
  try {
    let sql = 'SELECT er.*, c.title AS capsule_title, c.theme FROM education_records er JOIN education_capsules c ON c.id = er.capsule_id WHERE 1=1';
    const params = [];
    if (req.user.role === 'patient' && req.user.patient_id) {
      params.push(req.user.patient_id); sql += ` AND er.patient_id = $${params.length}`;
    } else {
      if (req.query.patient_id) { params.push(req.query.patient_id); sql += ` AND er.patient_id = $${params.length}`; }
    }
    if (req.query.capsule_id)   { params.push(req.query.capsule_id); sql += ` AND er.capsule_id = $${params.length}`; }
    sql += ' ORDER BY er.updated_at DESC';
    const { rows } = await query(sql, params);
    res.json({ records: rows });
  } catch (err) { next(err); }
});

/** POST /api/education/send
 *  Body: { patientIds: ['MRF-001'] | 'all', capsuleId, when: 'pre' | 'post' }
 */
router.post('/send', requireAuth, requireRole('principal_admin', 'investigator'), async (req, res, next) => {
  try {
    let { patientIds, capsuleId, when } = req.body || {};
    if (!capsuleId || !when) return res.status(400).json({ error: 'capsuleId et when requis' });
    if (patientIds === 'all') {
      const { rows } = await query('SELECT id FROM patients');
      patientIds = rows.map(r => r.id);
    }
    const cap = await query('SELECT * FROM education_capsules WHERE id = $1', [capsuleId]);
    if (!cap.rows.length) return res.status(404).json({ error: 'Capsule introuvable' });
    const today = new Date().toISOString().slice(0, 10);
    let sent = 0;

    for (const pid of patientIds) {
      // Upsert education_records
      await query(
        `INSERT INTO education_records (patient_id, capsule_id, sent_date, pre_status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (patient_id, capsule_id)
         DO UPDATE SET sent_date = $3, reminders = education_records.reminders + 1`,
        [pid, capsuleId, today]
      );
      if (when === 'pre') {
        await query(
          `INSERT INTO notifications (id, patient_id, type, subtype, capsule_id, label, source, sent_date)
           VALUES ($1,$2,'education','pre',$3,$4,'investigator',$5)`,
          ['n-' + pid + '-' + capsuleId + '-pre-' + Date.now(),
           pid, capsuleId,
           `${cap.rows[0].title} — Questionnaire diagnostique (pré-vidéo)`, today]
        );
        sent++;
      }
    }
    await query(
      'INSERT INTO notification_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [req.user.id, 'send-capsule', JSON.stringify({ capsuleId, when, patients: patientIds.length, sent }), req.ip]
    );
    res.json({ success: true, sent });
  } catch (err) { next(err); }
});

/** POST /api/education/:patientId/:capsuleId/complete-pre */
router.post('/:patientId/:capsuleId/complete-pre', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'patient' && req.user.patient_id !== req.params.patientId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    const { score } = req.body || {};
    if (score == null || score < 0 || score > 100) return res.status(400).json({ error: 'score 0-100 requis' });
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await query(
      `UPDATE education_records
       SET pre_status = 'completed', pre_score = $1, pre_completed_date = $2
       WHERE patient_id = $3 AND capsule_id = $4 AND pre_status = 'pending'
       RETURNING *`,
      [score, today, req.params.patientId, req.params.capsuleId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Pré-Q non disponible' });
    // Marquer la notif pré comme complétée
    await query(
      `UPDATE notifications SET status = 'completed', completed_date = $1, score = $2
       WHERE patient_id = $3 AND capsule_id = $4 AND subtype = 'pre' AND status = 'pending'`,
      [today, score, req.params.patientId, req.params.capsuleId]
    );
    res.json({ record: rows[0] });
  } catch (err) { next(err); }
});

/** POST /api/education/:patientId/:capsuleId/watch-video */
router.post('/:patientId/:capsuleId/watch-video', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'patient' && req.user.patient_id !== req.params.patientId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    const today = new Date().toISOString().slice(0, 10);
    const result = await transaction(async (client) => {
      const upd = await client.query(
        `UPDATE education_records
         SET video_watched = true, video_watched_date = $1, post_status = 'pending'
         WHERE patient_id = $2 AND capsule_id = $3 AND pre_status = 'completed' AND video_watched = false
         RETURNING *`,
        [today, req.params.patientId, req.params.capsuleId]
      );
      if (!upd.rows.length) {
        throw Object.assign(new Error('Vidéo non disponible (pré-Q requise) ou déjà visionnée'), { status: 400 });
      }
      // Crée la notification post automatiquement
      const cap = await client.query('SELECT title FROM education_capsules WHERE id = $1', [req.params.capsuleId]);
      await client.query(
        `INSERT INTO notifications (id, patient_id, type, subtype, capsule_id, label, source, sent_date)
         VALUES ($1,$2,'education','post',$3,$4,'auto-after-video',$5)`,
        ['n-' + req.params.patientId + '-' + req.params.capsuleId + '-post-' + Date.now(),
         req.params.patientId, req.params.capsuleId,
         `${cap.rows[0].title} — Questionnaire sommatif (post-vidéo)`, today]
      );
      return upd.rows[0];
    });
    res.json({ record: result });
  } catch (err) { next(err); }
});

/** POST /api/education/:patientId/:capsuleId/complete-post */
router.post('/:patientId/:capsuleId/complete-post', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'patient' && req.user.patient_id !== req.params.patientId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    const { score } = req.body || {};
    if (score == null || score < 0 || score > 100) return res.status(400).json({ error: 'score 0-100 requis' });
    const today = new Date().toISOString().slice(0, 10);
    const validated = score >= VALIDATION_THRESHOLD;
    const { rows } = await query(
      `UPDATE education_records
       SET post_status = 'completed', post_score = $1, post_completed_date = $2, validated = $3
       WHERE patient_id = $4 AND capsule_id = $5 AND post_status = 'pending'
       RETURNING *`,
      [score, today, validated, req.params.patientId, req.params.capsuleId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post-Q non disponible' });
    await query(
      `UPDATE notifications SET status = 'completed', completed_date = $1, score = $2
       WHERE patient_id = $3 AND capsule_id = $4 AND subtype = 'post' AND status = 'pending'`,
      [today, score, req.params.patientId, req.params.capsuleId]
    );
    res.json({ record: rows[0], validated, threshold: VALIDATION_THRESHOLD });
  } catch (err) { next(err); }
});

module.exports = router;
