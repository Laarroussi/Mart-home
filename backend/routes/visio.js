/**
 * /api/visio — Sessions visio (création, fin, monitoring)
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

/** GET /api/visio/sessions — Historique */
router.get('/sessions', requireAuth, requireRole('principal_admin', 'investigator'), async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM visio_sessions ORDER BY started_at DESC LIMIT 50');
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

/** POST /api/visio/sessions — Démarrer */
router.post('/sessions', requireAuth, requireRole('principal_admin', 'investigator'), async (req, res, next) => {
  try {
    const { title, participants } = req.body || {};
    const { rows } = await query(
      `INSERT INTO visio_sessions (investigator_id, started_at, title, participants)
       VALUES ($1, NOW(), $2, $3) RETURNING *`,
      [req.user.id, title || 'Séance APA', participants || []]
    );
    res.status(201).json({ session: rows[0] });
  } catch (err) { next(err); }
});

/** PATCH /api/visio/sessions/:id/end — Terminer (avec métriques) */
router.patch('/sessions/:id/end', requireAuth, requireRole('principal_admin', 'investigator'), async (req, res, next) => {
  try {
    const { avg_hr, total_energy_kcal, notes } = req.body || {};
    const { rows } = await query(
      `UPDATE visio_sessions
       SET ended_at = NOW(), avg_hr = $1, total_energy_kcal = $2, notes = $3
       WHERE id = $4 RETURNING *`,
      [avg_hr, total_energy_kcal, notes, req.params.id]
    );
    res.json({ session: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
