/**
 * /api/users — Gestion des comptes (admin / principal uniquement)
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { requireAuth, requireRole, canManageUsers } = require('../middleware/auth');

const router = express.Router();

const ROLE_CAN_CREATE = {
  admin: ['admin', 'principal', 'investigator', 'patient'],
  principal: ['investigator', 'patient'],
  investigator: ['patient'],
  patient: []
};

/** GET /api/users — Liste tous les utilisateurs (admin/principal) */
router.get('/', requireAuth, requireRole('admin', 'principal'), async (req, res, next) => {
  try {
    const { role, active } = req.query;
    let sql = `SELECT id, role, name, email, phone, service, patient_id, created_by, created_at, active, last_login FROM users WHERE 1=1`;
    const params = [];
    if (role) { params.push(role); sql += ` AND role = $${params.length}`; }
    if (active !== undefined) { params.push(active === 'true'); sql += ` AND active = $${params.length}`; }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await query(sql, params);
    res.json({ users: rows });
  } catch (err) { next(err); }
});

/** POST /api/users — Crée un compte (admin/principal) */
router.post('/', requireAuth, requireRole('admin', 'principal'), async (req, res, next) => {
  try {
    const { role, name, email, password, phone, service, patient_id } = req.body || {};
    if (!role || !name || !email || !password) return res.status(400).json({ error: 'role, name, email, password requis' });

    // Vérification permission (un principal ne peut pas créer un admin)
    const allowed = ROLE_CAN_CREATE[req.user.role] || [];
    if (!allowed.includes(role)) {
      return res.status(403).json({ error: `Votre rôle (${req.user.role}) n'autorise pas la création d'un compte ${role}` });
    }

    // Email unique
    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email déjà utilisé' });

    if (password.length < 8) return res.status(400).json({ error: 'Mot de passe trop court (min. 8 caractères)' });

    const id = 'u-' + role.slice(0, 3) + '-' + Date.now().toString(36);
    const password_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 10);

    const { rows } = await query(
      `INSERT INTO users (id, role, name, email, password_hash, phone, service, patient_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, role, name, email, phone, service, patient_id, created_at`,
      [id, role, name, email.toLowerCase(), password_hash, phone || null, service || null, patient_id || null, req.user.id]
    );
    await query(
      'INSERT INTO notification_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [req.user.id, 'create-user', JSON.stringify({ created: id, role }), req.ip]
    );
    res.status(201).json({ user: rows[0] });
  } catch (err) { next(err); }
});

/** PATCH /api/users/:id — Modifier un compte */
router.patch('/:id', requireAuth, requireRole('admin', 'principal'), async (req, res, next) => {
  try {
    const { name, phone, service, active } = req.body || {};
    const target = await query('SELECT role FROM users WHERE id = $1', [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
    // Un principal ne peut pas modifier un admin
    if (target.rows[0].role === 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Seul un admin peut modifier un compte admin' });
    }
    const fields = []; const params = [];
    if (name !== undefined)    { params.push(name); fields.push(`name = $${params.length}`); }
    if (phone !== undefined)   { params.push(phone); fields.push(`phone = $${params.length}`); }
    if (service !== undefined) { params.push(service); fields.push(`service = $${params.length}`); }
    if (active !== undefined)  { params.push(active); fields.push(`active = $${params.length}`); }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING id, role, name, email, phone, service, active`,
      params
    );
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
