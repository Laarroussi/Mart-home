/**
 * /api/videos — Gestion des vidéos (entraînement, éducation, info)
 *
 * Règles par rôle :
 *   - principal_admin : CRUD complet (créer, modifier, archiver, attribuer)
 *   - investigator    : lecture + attribution à ses patients
 *   - patient         : lecture seule de ses vidéos attribuées (via GET /mine)
 *                       OU des vidéos visibility='all' / visibility='patient'
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// GET /api/videos
// - principal_admin / investigator : voit toutes les vidéos non archivées (+ archivées si ?includeArchived=true)
// - patient : voit ses vidéos attribuées + celles visibility='all' ou 'patient'
// Filtres optionnels : ?type=training|education|info, ?category=...
// ============================================================
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { type, category, includeArchived } = req.query;
    const params = [];
    let sql;

    if (req.user.role === ROLE.PATIENT) {
      // Vidéos visibles pour ce patient : visibility 'all' ou 'patient', ou attribuées
      sql = `
        SELECT v.*, FALSE AS assigned FROM videos v
         WHERE v.archived = FALSE
           AND v.visibility IN ('all', 'patient')
        UNION
        SELECT v.*, TRUE AS assigned FROM videos v
          JOIN patient_videos pv ON pv.video_id = v.id
         WHERE v.archived = FALSE
           AND pv.patient_id = $1
      `;
      params.push(req.user.patient_id || '');
    } else {
      // Staff (principal_admin / investigator)
      sql = `SELECT v.*, FALSE AS assigned FROM videos v WHERE 1=1`;
      if (includeArchived !== 'true') sql += ' AND v.archived = FALSE';
    }

    // Filtres communs
    if (type)     { params.push(type);     sql += ` AND video_type = $${params.length}`; }
    if (category) { params.push(category); sql += ` AND category   = $${params.length}`; }
    sql += ' ORDER BY order_index, title';

    const { rows } = await query(sql, params);
    res.json({ videos: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/videos/mine — Pour un patient : ses vidéos attribuées uniquement
// ============================================================
router.get('/mine', requireAuth, requireRole(ROLE.PATIENT), async (req, res, next) => {
  try {
    if (!req.user.patient_id) return res.json({ videos: [] });
    const { rows } = await query(
      `SELECT v.*, pv.assigned_at, pv.assigned_by, pv.note
         FROM videos v
         JOIN patient_videos pv ON pv.video_id = v.id
        WHERE pv.patient_id = $1
          AND v.archived = FALSE
        ORDER BY pv.assigned_at DESC`,
      [req.user.patient_id]
    );
    res.json({ videos: rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/videos — Créer une vidéo (principal_admin seulement)
// Body : { id?, title, description?, category?, video_type, source, youtube_id?, url?,
//          interval_label?, duration_min?, english_title?, visibility?, order_index? }
// ============================================================
router.post('/', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), async (req, res, next) => {
  try {
    let {
      id, title, description, category, video_type, source,
      youtube_id, url, interval_label, duration_min, english_title,
      thumbnail_url, visibility, order_index
    } = req.body || {};

    if (!title) return res.status(400).json({ error: 'title requis' });
    video_type = video_type || 'training';
    source     = source || (youtube_id ? 'youtube' : (url ? 'external' : 'youtube'));

    if (source === 'youtube' && !youtube_id) {
      // Tente d'extraire l'id YouTube depuis url si fourni
      if (url) {
        const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
        if (m) youtube_id = m[1];
      }
      if (!youtube_id) return res.status(400).json({ error: 'youtube_id ou url YouTube requis pour source=youtube' });
    }
    if (source === 'external' && !url) return res.status(400).json({ error: 'url requis pour source=external' });

    if (!id) id = youtube_id || 'v-' + Date.now().toString(36);

    // Si pas d'order_index, on prend max+1
    if (order_index === undefined || order_index === null) {
      const r = await query('SELECT COALESCE(MAX(order_index),0)+1 AS next FROM videos');
      order_index = r.rows[0].next;
    }

    const { rows } = await query(
      `INSERT INTO videos (id, title, description, category, video_type, source,
                           youtube_id, url, interval_label, duration_min, english_title,
                           thumbnail_url, visibility, order_index, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [id, title, description || null, category || null, video_type, source,
       youtube_id || null, url || null, interval_label || null,
       duration_min ? parseInt(duration_min, 10) : null, english_title || null,
       thumbnail_url || null, visibility || 'all', order_index, req.user.id]
    );
    res.status(201).json({ video: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Une vidéo avec cet id existe déjà' });
    next(err);
  }
});

// ============================================================
// PATCH /api/videos/:id — Modifier une vidéo (principal_admin seulement)
// ============================================================
router.patch('/:id', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), async (req, res, next) => {
  try {
    const allowed = ['title','description','category','video_type','source','youtube_id','url',
                     'interval_label','duration_min','english_title','thumbnail_url',
                     'visibility','order_index','archived'];
    const fields = [];
    const params = [];
    for (const key of allowed) {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, key)) {
        params.push(req.body[key]);
        fields.push(`${key} = $${params.length}`);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE videos SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Vidéo introuvable' });
    res.json({ video: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/videos/:id — Supprimer (principal_admin seulement)
//   Soft delete par défaut (archived=true) ; ?hard=true pour suppression réelle
// ============================================================
router.delete('/:id', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), async (req, res, next) => {
  try {
    if (req.query.hard === 'true') {
      const r = await query('DELETE FROM videos WHERE id = $1', [req.params.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Vidéo introuvable' });
      return res.json({ success: true, hardDeleted: true });
    }
    const { rows } = await query(
      'UPDATE videos SET archived = TRUE WHERE id = $1 RETURNING id, archived',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Vidéo introuvable' });
    res.json({ success: true, archived: true });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/videos/:id/assign — Attribuer une vidéo à un ou plusieurs patients
// Body : { patientIds: ['MRF-001', ...], note? }
// Accès : principal_admin OU investigator
// ============================================================
router.post('/:id/assign', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const { patientIds, note } = req.body || {};
    if (!Array.isArray(patientIds) || !patientIds.length) {
      return res.status(400).json({ error: 'patientIds (array non vide) requis' });
    }
    const videoId = req.params.id;
    const exists = await query('SELECT id FROM videos WHERE id = $1', [videoId]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Vidéo introuvable' });

    let assigned = 0;
    for (const pid of patientIds) {
      const r = await query(
        `INSERT INTO patient_videos (patient_id, video_id, assigned_by, note)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (patient_id, video_id) DO UPDATE
           SET assigned_by = $3, assigned_at = NOW(), note = COALESCE($4, patient_videos.note)
         RETURNING id`,
        [pid, videoId, req.user.id, note || null]
      );
      if (r.rowCount) assigned++;
    }
    res.json({ success: true, assigned, videoId });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/videos/:id/assign/:patientId — Retirer l'attribution
// Accès : principal_admin OU investigator
// ============================================================
router.delete('/:id/assign/:patientId', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const r = await query(
      'DELETE FROM patient_videos WHERE video_id = $1 AND patient_id = $2',
      [req.params.id, req.params.patientId]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Attribution introuvable' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/videos/:id/patients — Liste des patients à qui une vidéo est attribuée
// Accès : principal_admin OU investigator
// ============================================================
router.get('/:id/patients', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT pv.patient_id, pv.assigned_at, pv.assigned_by, pv.note, u.name AS patient_name
         FROM patient_videos pv
         LEFT JOIN users u ON u.patient_id = pv.patient_id AND u.role = 'patient'
        WHERE pv.video_id = $1
        ORDER BY pv.assigned_at DESC`,
      [req.params.id]
    );
    res.json({ patients: rows });
  } catch (err) { next(err); }
});

module.exports = router;
