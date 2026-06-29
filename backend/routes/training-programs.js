/**
 * /api/training-programs — Séances/programmes d'entraînement prescrits
 *
 * Modèle :
 *   - 1 programme = titre + consignes + N vidéos + N patients destinataires
 *   - Créé par un investigateur ou principal_admin
 *
 * Permissions :
 *   - patient        : voit uniquement ses programmes attribués (GET /mine)
 *   - investigator   : crée, modifie, archive ses propres programmes ; voit tout
 *   - principal_admin: tout
 */
const express = require('express');
const { query, pool } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// Helper : enrichit un programme avec ses vidéos et patients
// ============================================================
async function attachDetails(program) {
  if (!program) return null;
  const v = await query(
    `SELECT tpv.video_id, tpv.order_index, tpv.note AS video_note,
            v.title, v.youtube_id, v.url, v.source, v.category, v.duration_min, v.thumbnail_url
       FROM training_program_videos tpv
       JOIN videos v ON v.id = tpv.video_id
      WHERE tpv.program_id = $1
      ORDER BY tpv.order_index, v.title`,
    [program.id]
  );
  const p = await query(
    `SELECT patient_id, assigned_by, assigned_at FROM training_program_patients
      WHERE program_id = $1 ORDER BY assigned_at`,
    [program.id]
  );
  program.videos = v.rows;
  program.patients = p.rows;
  return program;
}

// ============================================================
// POST /api/training-programs — Créer un programme
// Body : { title, description?, instructions?, videoIds: [...], patientIds: [...] }
// ============================================================
router.post('/', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { title, description, instructions, videoIds, patientIds } = req.body || {};
    if (!title || !title.trim()) return res.status(400).json({ error: 'title requis' });
    const vids = Array.isArray(videoIds) ? videoIds.filter(Boolean) : [];
    const pids = Array.isArray(patientIds) ? patientIds.filter(Boolean) : [];

    await client.query('BEGIN');
    const r = await client.query(
      `INSERT INTO training_programs (title, description, instructions, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title.trim(), description || null, instructions || null, req.user.id]
    );
    const program = r.rows[0];

    // Vidéos
    for (let i = 0; i < vids.length; i++) {
      await client.query(
        `INSERT INTO training_program_videos (program_id, video_id, order_index)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [program.id, vids[i], i + 1]
      );
    }
    // Patients
    for (const pid of pids) {
      await client.query(
        `INSERT INTO training_program_patients (program_id, patient_id, assigned_by)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [program.id, pid, req.user.id]
      );
    }

    await client.query('COMMIT');
    await attachDetails(program);
    res.status(201).json({ program });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ============================================================
// GET /api/training-programs — Lister
// - principal_admin : tous
// - investigator    : ses propres (created_by = lui)
// Filtres : ?includeArchived=true, ?patient_id=...
// ============================================================
router.get('/', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    let sql = `SELECT p.* FROM training_programs p WHERE 1=1`;
    const params = [];
    if (req.user.role === ROLE.INVESTIGATOR) {
      params.push(req.user.id);
      sql += ` AND p.created_by = $${params.length}`;
    }
    if (req.query.includeArchived !== 'true') sql += ` AND p.archived = FALSE`;
    if (req.query.patient_id) {
      params.push(req.query.patient_id);
      sql += ` AND EXISTS (SELECT 1 FROM training_program_patients tpp
                            WHERE tpp.program_id = p.id AND tpp.patient_id = $${params.length})`;
    }
    sql += ' ORDER BY p.created_at DESC LIMIT 200';
    const { rows } = await query(sql, params);
    for (const p of rows) await attachDetails(p);
    res.json({ programs: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/training-programs/mine — Patient : ses programmes
// ============================================================
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== ROLE.PATIENT || !req.user.patient_id) {
      return res.status(403).json({ error: 'Réservé aux patients' });
    }
    const { rows } = await query(
      `SELECT p.*, tpp.assigned_at, tpp.assigned_by
         FROM training_programs p
         JOIN training_program_patients tpp ON tpp.program_id = p.id
        WHERE tpp.patient_id = $1 AND p.archived = FALSE
        ORDER BY tpp.assigned_at DESC`,
      [req.user.patient_id]
    );
    for (const p of rows) await attachDetails(p);
    res.json({ programs: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/training-programs/:id — Détail
// ============================================================
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM training_programs WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Programme introuvable' });
    const program = await attachDetails(r.rows[0]);
    // Patient : doit être dans patients
    if (req.user.role === ROLE.PATIENT) {
      const ok = program.patients.some(p => p.patient_id === req.user.patient_id);
      if (!ok) return res.status(403).json({ error: 'Accès interdit' });
    }
    if (req.user.role === ROLE.INVESTIGATOR && program.created_by !== req.user.id) {
      // investigator peut voir les programmes des autres (lecture seule)
      // → on autorise pour permettre consultation collaborative
    }
    res.json({ program });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/training-programs/:id — Modifier (titre, consignes, vidéos, patients)
// ============================================================
router.patch('/:id', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const r = await client.query('SELECT * FROM training_programs WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Programme introuvable' });
    const existing = r.rows[0];
    if (req.user.role === ROLE.INVESTIGATOR && existing.created_by !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez modifier que vos propres programmes' });
    }

    await client.query('BEGIN');

    // Update champs principaux
    const allowed = ['title', 'description', 'instructions', 'archived'];
    const fields = []; const params = [];
    for (const k of allowed) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, k)) {
        params.push(req.body[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }
    if (fields.length) {
      params.push(req.params.id);
      await client.query(`UPDATE training_programs SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
    }

    // Update vidéos si fourni
    if (Array.isArray(req.body.videoIds)) {
      await client.query('DELETE FROM training_program_videos WHERE program_id = $1', [req.params.id]);
      const vids = req.body.videoIds.filter(Boolean);
      for (let i = 0; i < vids.length; i++) {
        await client.query(
          `INSERT INTO training_program_videos (program_id, video_id, order_index)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [req.params.id, vids[i], i + 1]
        );
      }
    }
    // Update patients si fourni
    if (Array.isArray(req.body.patientIds)) {
      await client.query('DELETE FROM training_program_patients WHERE program_id = $1', [req.params.id]);
      for (const pid of req.body.patientIds.filter(Boolean)) {
        await client.query(
          `INSERT INTO training_program_patients (program_id, patient_id, assigned_by)
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [req.params.id, pid, req.user.id]
        );
      }
    }

    await client.query('COMMIT');
    const fresh = await query('SELECT * FROM training_programs WHERE id = $1', [req.params.id]);
    const program = await attachDetails(fresh.rows[0]);
    res.json({ program });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ============================================================
// DELETE /api/training-programs/:id — Archiver (soft) ou supprimer (?hard=true)
// ============================================================
router.delete('/:id', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const r = await query('SELECT created_by FROM training_programs WHERE id = $1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Programme introuvable' });
    if (req.user.role === ROLE.INVESTIGATOR && r.rows[0].created_by !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez supprimer que vos propres programmes' });
    }
    if (req.query.hard === 'true') {
      if (req.user.role !== ROLE.PRINCIPAL_ADMIN) {
        return res.status(403).json({ error: 'Suppression définitive réservée à principal_admin' });
      }
      await query('DELETE FROM training_programs WHERE id = $1', [req.params.id]);
      return res.json({ success: true, hardDeleted: true });
    }
    await query('UPDATE training_programs SET archived = TRUE WHERE id = $1', [req.params.id]);
    res.json({ success: true, archived: true });
  } catch (err) { next(err); }
});

module.exports = router;
