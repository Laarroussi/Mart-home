/**
 * /api/notifications — Envoi SF-36, GPAQ, complétion patient
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const LABELS = {
  sf36: 'Questionnaire SF-36 (qualité de vie)',
  gpaq: 'Questionnaire GPAQ (activité physique)'
};

/** GET /api/notifications/:patientId */
router.get('/:patientId', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'patient' && req.user.patient_id !== req.params.patientId) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    const { rows } = await query(
      'SELECT * FROM notifications WHERE patient_id = $1 ORDER BY sent_date DESC NULLS LAST',
      [req.params.patientId]
    );
    res.json({ notifications: rows });
  } catch (err) { next(err); }
});

/** POST /api/notifications/send
 *  Body: { patientIds: ['MRF-001', ...], types: ['sf36','gpaq'] }
 *  Si patientIds = "all" → tous les patients
 */
router.post('/send', requireAuth, requireRole('principal_admin', 'investigator'), async (req, res, next) => {
  try {
    let { patientIds, types } = req.body || {};
    if (!types || !types.length) return res.status(400).json({ error: 'types[] requis' });
    if (patientIds === 'all') {
      const { rows } = await query('SELECT id FROM patients');
      patientIds = rows.map(r => r.id);
    }
    if (!Array.isArray(patientIds) || !patientIds.length) {
      return res.status(400).json({ error: 'patientIds[] requis' });
    }
    const today = new Date().toISOString().slice(0, 10);
    let sent = 0;
    for (const pid of patientIds) {
      for (const t of types) {
        // Si une notif pending existe déjà pour ce type, incrémente reminders
        const exists = await query(
          `SELECT id, reminders FROM notifications
           WHERE patient_id = $1 AND type = $2 AND status = 'pending'
           ORDER BY sent_date DESC LIMIT 1`,
          [pid, t]
        );
        if (exists.rows.length) {
          await query(
            'UPDATE notifications SET reminders = reminders + 1, sent_date = $1 WHERE id = $2',
            [today, exists.rows[0].id]
          );
        } else {
          await query(
            `INSERT INTO notifications (id, patient_id, type, label, source, sent_date)
             VALUES ($1, $2, $3, $4, 'investigator', $5)`,
            ['n-' + pid + '-' + t + '-' + Date.now(), pid, t, LABELS[t] || t, today]
          );
        }
        sent++;
      }
    }
    await query(
      'INSERT INTO notification_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [req.user.id, 'send-questionnaires', JSON.stringify({ patientIds: patientIds.length, types, count: sent }), req.ip]
    );
    res.json({ success: true, sent });
  } catch (err) { next(err); }
});

/** POST /api/notifications/:id/complete — Le patient complète un questionnaire */
router.post('/:id/complete', requireAuth, async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { score } = req.body || {};
    const { rows } = await query(
      `UPDATE notifications SET status = 'completed', completed_date = $1, score = $2
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [today, score || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Notification introuvable ou déjà complétée' });
    await query(
      'INSERT INTO notification_log (user_id, patient_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, rows[0].patient_id, 'complete-notif', JSON.stringify({ id: req.params.id, score }), req.ip]
    );
    res.json({ notification: rows[0] });
  } catch (err) { next(err); }
});

/** GET /api/notifications/log/recent — Journal des envois (admin/principal) */
router.get('/log/recent', requireAuth, requireRole('principal_admin'), async (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 100;
    const { rows } = await query(
      'SELECT * FROM notification_log ORDER BY timestamp DESC LIMIT $1',
      [limit]
    );
    res.json({ log: rows });
  } catch (err) { next(err); }
});

module.exports = router;
