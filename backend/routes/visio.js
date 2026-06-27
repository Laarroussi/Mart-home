/**
 * /api/visio — Séances visio (CRUD + planification + statuts)
 *
 * Règles par rôle :
 *   - principal_admin : tout (créer, lire, modifier, annuler, supprimer toutes les séances)
 *   - investigator    : créer pour ses patients ; lire/modifier/annuler ses propres séances
 *   - patient         : voir les séances où il est invité ; rejoindre via meeting_link
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// Helper : retourne une session avec ses participants
// ============================================================
async function attachParticipants(session) {
  if (!session) return null;
  const r = await query(
    `SELECT vp.patient_id, vp.joined_at, vp.invited_at
       FROM visio_participants vp
      WHERE vp.visio_id = $1
      ORDER BY vp.invited_at`,
    [session.id]
  );
  session.patients = r.rows;
  return session;
}

// ============================================================
// GET /api/visio/sessions — Lister
// - principal_admin : toutes
// - investigator    : ses propres séances (owner_id ou investigator_id)
// - patient         : 403 (utiliser /mine)
// Filtres : ?status=..., ?upcoming=true
// ============================================================
router.get('/sessions', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const { status, upcoming } = req.query;
    let sql = `SELECT * FROM visio_sessions WHERE 1=1`;
    const params = [];

    if (req.user.role === ROLE.INVESTIGATOR) {
      params.push(req.user.id);
      sql += ` AND (owner_id = $${params.length} OR investigator_id = $${params.length})`;
    }
    if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
    if (upcoming === 'true') sql += ` AND scheduled_at >= NOW() AND status = 'scheduled'`;
    sql += ' ORDER BY COALESCE(scheduled_at, started_at, created_at) DESC LIMIT 100';

    const { rows } = await query(sql, params);
    for (const r of rows) await attachParticipants(r);
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/visio/mine — Patient : ses séances
// ============================================================
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== ROLE.PATIENT || !req.user.patient_id) {
      return res.status(403).json({ error: 'Réservé aux patients' });
    }
    const { rows } = await query(
      `SELECT v.id, v.title, v.description, v.scheduled_at, v.duration_min, v.meeting_link,
              v.status, v.started_at, v.ended_at, vp.joined_at
         FROM visio_sessions v
         JOIN visio_participants vp ON vp.visio_id = v.id
        WHERE vp.patient_id = $1
        ORDER BY COALESCE(v.scheduled_at, v.created_at) DESC`,
      [req.user.patient_id]
    );
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/visio/sessions/:id — Détail
// ============================================================
router.get('/sessions/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM visio_sessions WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Séance introuvable' });
    const session = await attachParticipants(rows[0]);

    if (req.user.role === ROLE.PATIENT) {
      const ok = session.patients.some(p => p.patient_id === req.user.patient_id);
      if (!ok) return res.status(403).json({ error: 'Accès interdit à cette séance' });
    }
    if (req.user.role === ROLE.INVESTIGATOR) {
      if (session.owner_id !== req.user.id && session.investigator_id !== req.user.id) {
        return res.status(403).json({ error: 'Accès interdit à cette séance' });
      }
    }
    res.json({ session });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/visio/sessions — Créer (planifiée)
// Body : { title, description?, scheduled_at, duration_min?, meeting_link?, investigator_id?, patientIds? }
// ============================================================
router.post('/sessions', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const {
      title, description, scheduled_at, duration_min, meeting_link,
      investigator_id, patientIds
    } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title requis' });

    const finalInvestigator = (req.user.role === ROLE.PRINCIPAL_ADMIN && investigator_id)
      ? investigator_id
      : req.user.id;

    const { rows } = await query(
      `INSERT INTO visio_sessions
         (title, description, scheduled_at, duration_min, meeting_link,
          investigator_id, owner_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')
       RETURNING *`,
      [title, description || null, scheduled_at || null,
       duration_min ? parseInt(duration_min, 10) : null,
       meeting_link || null, finalInvestigator, req.user.id]
    );
    const session = rows[0];

    if (Array.isArray(patientIds) && patientIds.length) {
      for (const pid of patientIds) {
        await query(
          `INSERT INTO visio_participants (visio_id, patient_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [session.id, pid]
        );
      }
    }
    await attachParticipants(session);
    res.status(201).json({ session });
  } catch (err) { next(err); }
});

// ============================================================
// Helper : ownership check
// ============================================================
async function checkOwnership(req, sessionId) {
  if (req.user.role === ROLE.PRINCIPAL_ADMIN) return { ok: true };
  const r = await query('SELECT owner_id, investigator_id FROM visio_sessions WHERE id = $1', [sessionId]);
  if (!r.rows.length) return { ok: false, status: 404, error: 'Séance introuvable' };
  const s = r.rows[0];
  if (req.user.role === ROLE.INVESTIGATOR &&
      (s.owner_id === req.user.id || s.investigator_id === req.user.id)) {
    return { ok: true };
  }
  return { ok: false, status: 403, error: 'Vous ne pouvez modifier que vos propres séances' };
}

// ============================================================
// PATCH /api/visio/sessions/:id — Modifier
// ============================================================
router.patch('/sessions/:id', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const own = await checkOwnership(req, req.params.id);
    if (!own.ok) return res.status(own.status).json({ error: own.error });

    const allowed = ['title','description','scheduled_at','duration_min','meeting_link',
                     'status','investigator_id','notes'];
    const fields = []; const params = [];
    for (const k of allowed) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, k)) {
        params.push(req.body[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE visio_sessions SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ session: await attachParticipants(rows[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/visio/sessions/:id/cancel — Annuler
// ============================================================
router.post('/sessions/:id/cancel', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const own = await checkOwnership(req, req.params.id);
    if (!own.ok) return res.status(own.status).json({ error: own.error });
    const { rows } = await query(
      `UPDATE visio_sessions
          SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = $1
        WHERE id = $2 AND status != 'cancelled'
        RETURNING *`,
      [req.user.id, req.params.id]
    );
    if (!rows.length) return res.status(409).json({ error: 'Déjà annulée ou introuvable' });
    res.json({ session: await attachParticipants(rows[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/visio/sessions/:id/start — Démarrer
// ============================================================
router.post('/sessions/:id/start', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const own = await checkOwnership(req, req.params.id);
    if (!own.ok) return res.status(own.status).json({ error: own.error });
    const { rows } = await query(
      `UPDATE visio_sessions SET status = 'in_progress', started_at = COALESCE(started_at, NOW())
        WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({ session: await attachParticipants(rows[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/visio/sessions/:id/end — Terminer + métriques
// ============================================================
router.patch('/sessions/:id/end', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const own = await checkOwnership(req, req.params.id);
    if (!own.ok) return res.status(own.status).json({ error: own.error });
    const { avg_hr, total_energy_kcal, notes } = req.body || {};
    const { rows } = await query(
      `UPDATE visio_sessions
          SET ended_at = NOW(), status = 'completed',
              avg_hr = $1, total_energy_kcal = $2, notes = $3
        WHERE id = $4 RETURNING *`,
      [avg_hr || null, total_energy_kcal || null, notes || null, req.params.id]
    );
    res.json({ session: await attachParticipants(rows[0]) });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/visio/sessions/:id — Supprimer (principal_admin seulement)
// ============================================================
router.delete('/sessions/:id', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), async (req, res, next) => {
  try {
    const r = await query('DELETE FROM visio_sessions WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Séance introuvable' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/visio/sessions/:id/participants — Ajouter patients
// ============================================================
router.post('/sessions/:id/participants', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const own = await checkOwnership(req, req.params.id);
    if (!own.ok) return res.status(own.status).json({ error: own.error });
    const { patientIds } = req.body || {};
    if (!Array.isArray(patientIds) || !patientIds.length) {
      return res.status(400).json({ error: 'patientIds (array non vide) requis' });
    }
    let added = 0;
    for (const pid of patientIds) {
      const r = await query(
        `INSERT INTO visio_participants (visio_id, patient_id)
         VALUES ($1, $2) ON CONFLICT (visio_id, patient_id) DO NOTHING`,
        [req.params.id, pid]
      );
      if (r.rowCount) added++;
    }
    res.json({ success: true, added });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/visio/sessions/:id/participants/:patientId — Retirer un patient
// ============================================================
router.delete('/sessions/:id/participants/:patientId', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const own = await checkOwnership(req, req.params.id);
    if (!own.ok) return res.status(own.status).json({ error: own.error });
    const r = await query(
      'DELETE FROM visio_participants WHERE visio_id = $1 AND patient_id = $2',
      [req.params.id, req.params.patientId]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Participant introuvable' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
