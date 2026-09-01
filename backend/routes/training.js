/**
 * /api/training — Séances d'entraînement patient
 *
 * Workflow type :
 *   1. POST /sessions                  → patient démarre, renvoie session_id
 *   2. POST /sessions/:id/samples      → push d'échantillons (batch) toutes les 5-10 sec
 *   3. POST /sessions/:id/end          → terminer avec borg + stats agrégées
 *   4. GET  /sessions/:id              → détail (incluant samples) pour la fiche résumé
 *
 * Permissions :
 *   - patient        : crée/modifie/lit UNIQUEMENT ses propres séances
 *   - investigator   : lit les séances de ses patients (TODO : table d'attribution)
 *                      pour l'instant lit toutes les séances en tant que staff
 *   - principal_admin: lit tout
 */
const express = require('express');
const { query, pool } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// POST /api/training/sessions — Démarrer une séance
// Body : {
//   session_type        : 'video' | 'visio' | 'libre' | 'autre' (défaut 'libre')
//   video_id?           : si type=video, l'id de la vidéo regardée
//   training_program_id?: si la séance fait partie d'un programme prescrit
//   visio_session_id?   : si type=visio, l'id de la séance visio
//   content?            : pré-rempli automatiquement selon le contexte (modifiable à la fin)
// }
// Le patient_id est déduit du token. Statut initial = 'in_progress'.
// ============================================================
router.post('/sessions', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== ROLE.PATIENT || !req.user.patient_id) {
      return res.status(403).json({ error: 'Seul un patient peut démarrer une séance d\'entraînement' });
    }
    const {
      session_type, video_id, training_program_id, visio_session_id, content
    } = req.body || {};

    const type = ['video', 'visio', 'libre', 'autre'].includes(session_type) ? session_type : 'libre';

    const { rows } = await query(
      `INSERT INTO training_sessions
         (patient_id, session_type, video_id, training_program_id, visio_session_id,
          content, started_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), 'in_progress')
       RETURNING *`,
      [req.user.patient_id, type, video_id || null,
       training_program_id || null, visio_session_id || null,
       content || null]
    );
    res.status(201).json({ session: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/training/sessions/:id/samples — Push d'un batch d'échantillons
// Body : { samples: [{ t_seconds, hr, pa_estimated, energy_kcal }, ...] }
// Idempotent grâce à ON CONFLICT (session_id, t_seconds)
// ============================================================
router.post('/sessions/:id/samples', requireAuth, async (req, res, next) => {
  try {
    const { samples } = req.body || {};
    if (!Array.isArray(samples) || !samples.length) {
      return res.status(400).json({ error: 'samples (array non vide) requis' });
    }
    // Vérif ownership
    const own = await checkSessionAccess(req, req.params.id);
    if (!own.ok) return res.status(own.status).json({ error: own.error });
    if (own.session.status === 'completed' || own.session.status === 'cancelled') {
      return res.status(409).json({ error: 'Séance déjà clôturée' });
    }

    // Limite raisonnable pour éviter abus : 600 samples max par batch (1h à 10s d'intervalle)
    const batch = samples.slice(0, 600);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      for (const s of batch) {
        if (s.t_seconds == null) continue;
        const r = await client.query(
          `INSERT INTO training_samples (session_id, t_seconds, hr, pa_estimated, energy_kcal)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (session_id, t_seconds) DO UPDATE
             SET hr = EXCLUDED.hr,
                 pa_estimated = EXCLUDED.pa_estimated,
                 energy_kcal = EXCLUDED.energy_kcal`,
          [req.params.id, parseInt(s.t_seconds, 10),
           s.hr != null ? parseInt(s.hr, 10) : null,
           s.pa_estimated != null ? parseInt(s.pa_estimated, 10) : null,
           s.energy_kcal != null ? parseFloat(s.energy_kcal) : null]
        );
        if (r.rowCount) inserted++;
      }
      await client.query('COMMIT');
      res.json({ success: true, inserted, total: batch.length });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/training/sessions/:id/end — Terminer la séance
// Body : { borg_cr10 (0-10), status?, notes? }
// Calcule automatiquement les stats agrégées depuis training_samples
// ============================================================
// ============================================================
// POST /api/training/sessions/:id/end — Terminer la séance
// Body : {
//   borg_cr10 (0-10, OBLIGATOIRE)
//   content?         : contenu de la séance (obligatoire pour libre si pas déjà rempli)
//   patient_comment? : commentaire libre du patient
//   status?          : 'completed' (défaut) | 'interrupted' | 'cancelled'
//   notes?           : notes additionnelles (rarement utilisé côté client)
// }
// Calcule automatiquement les stats agrégées depuis training_samples
// ============================================================
router.post('/sessions/:id/end', requireAuth, async (req, res, next) => {
  try {
    // duration_s : durée DÉCLARÉE par le patient (séance réalisée sans ceinture
    // cardio, saisie a posteriori depuis sa séance prescrite). Prioritaire sur
    // la durée calculée, qui n'a pas de sens dans ce cas.
    const { borg_cr10, content, patient_comment, status, notes, duration_s } = req.body || {};
    if (borg_cr10 == null || borg_cr10 < 0 || borg_cr10 > 10) {
      return res.status(400).json({ error: 'borg_cr10 entre 0 et 10 requis' });
    }
    const own = await checkSessionAccess(req, req.params.id);
    if (!own.ok) return res.status(own.status).json({ error: own.error });

    const finalStatus = (status === 'interrupted' || status === 'cancelled') ? status : 'completed';

    // Vérif contenu obligatoire pour les séances libres si pas déjà rempli
    if (own.session.session_type === 'libre' && !own.session.content && !content) {
      return res.status(400).json({ error: 'content obligatoire pour une séance libre (décrivez ce que vous avez fait)' });
    }

    // Calcul stats agrégées depuis training_samples
    const aggR = await query(
      `SELECT
         MIN(hr) AS hr_min, AVG(hr) AS hr_avg, MAX(hr) AS hr_max,
         MIN(pa_estimated) AS pa_min, AVG(pa_estimated) AS pa_avg, MAX(pa_estimated) AS pa_max,
         MAX(energy_kcal) AS energy_total,
         MAX(t_seconds) AS max_t
       FROM training_samples WHERE session_id = $1`,
      [req.params.id]
    );
    const a = aggR.rows[0] || {};

    const { rows } = await query(
      `UPDATE training_sessions
          SET ended_at = NOW(),
              duration_s = COALESCE($1, EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER),
              status = $2,
              borg_cr10 = $3,
              hr_min = $4, hr_avg = $5, hr_max = $6,
              pa_estimated_min = $7, pa_estimated_avg = $8, pa_estimated_max = $9,
              energy_total_kcal = $10,
              notes = COALESCE($11, notes),
              content = COALESCE($12, content),
              patient_comment = COALESCE($13, patient_comment)
        WHERE id = $14
        RETURNING *`,
      [
        (duration_s != null && Number.isFinite(parseInt(duration_s, 10)) && parseInt(duration_s, 10) > 0)
          ? parseInt(duration_s, 10)
          : (a.max_t || null),
        finalStatus,
        parseInt(borg_cr10, 10),
        a.hr_min, a.hr_avg, a.hr_max,
        a.pa_min, a.pa_avg, a.pa_max,
        a.energy_total,
        notes || null,
        content || null,
        patient_comment || null,
        req.params.id
      ]
    );
    if (!rows.length) return res.status(404).json({ error: 'Séance introuvable' });
    res.json({ session: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/training/sessions/mine — Patient : ses séances
// ============================================================
router.get('/sessions/mine', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== ROLE.PATIENT || !req.user.patient_id) {
      return res.status(403).json({ error: 'Réservé aux patients' });
    }
    const { rows } = await query(
      `SELECT id, started_at, ended_at, duration_s, status, borg_cr10,
              session_type, content, patient_comment,
              video_id, training_program_id, visio_session_id,
              hr_min, hr_avg, hr_max,
              pa_estimated_min, pa_estimated_avg, pa_estimated_max,
              energy_total_kcal, notes
         FROM training_sessions
        WHERE patient_id = $1
        ORDER BY started_at DESC
        LIMIT 50`,
      [req.user.patient_id]
    );
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/training/sessions/:id — Détail avec samples (pour fiche résumé)
// ============================================================
router.get('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const own = await checkSessionAccess(req, req.params.id);
    if (!own.ok) return res.status(own.status).json({ error: own.error });
    const samples = await query(
      `SELECT t_seconds, hr, pa_estimated, energy_kcal
         FROM training_samples WHERE session_id = $1 ORDER BY t_seconds`,
      [req.params.id]
    );
    own.session.samples = samples.rows;
    res.json({ session: own.session });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/training/sessions — Staff : toutes les séances
// Filtres : ?patient_id=...
// ============================================================
router.get('/sessions', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    let sql = `SELECT id, patient_id, started_at, ended_at, duration_s, status,
                      session_type, content, patient_comment,
                      video_id, training_program_id, visio_session_id,
                      borg_cr10, hr_min, hr_avg, hr_max,
                      pa_estimated_min, pa_estimated_avg, pa_estimated_max,
                      energy_total_kcal, notes
                 FROM training_sessions WHERE 1=1`;
    const params = [];
    if (req.query.patient_id) {
      params.push(req.query.patient_id);
      sql += ` AND patient_id = $${params.length}`;
    }
    sql += ' ORDER BY started_at DESC LIMIT 200';
    const { rows } = await query(sql, params);
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

// ============================================================
// Helper : vérifie qu'un utilisateur peut accéder à une session
// ============================================================
async function checkSessionAccess(req, sessionId) {
  const r = await query('SELECT * FROM training_sessions WHERE id = $1', [sessionId]);
  if (!r.rows.length) return { ok: false, status: 404, error: 'Séance introuvable' };
  const session = r.rows[0];
  if (req.user.role === ROLE.PATIENT) {
    if (session.patient_id !== req.user.patient_id) {
      return { ok: false, status: 403, error: 'Accès interdit à cette séance' };
    }
  }
  // Staff : accès libre (TODO : restreindre aux patients attribués pour investigator)
  return { ok: true, session };
}

module.exports = router;
