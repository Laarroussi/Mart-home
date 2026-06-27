/**
 * /api/auth — Authentification (login, logout, me)
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

/** POST /api/auth/login — Connexion par email + mot de passe */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

    const { rows } = await query(
      'SELECT id, role, name, email, password_hash, active, patient_id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (!rows.length) return res.status(401).json({ error: 'Identifiants invalides' });

    const user = rows[0];
    if (!user.active) return res.status(403).json({ error: 'Compte désactivé' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Identifiants invalides' });

    await query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    await query(
      'INSERT INTO notification_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [user.id, 'login', req.ip]
    );

    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, role: user.role, name: user.name, email: user.email, patient_id: user.patient_id }
    });
  } catch (err) { next(err); }
});

/** POST /api/auth/logout */
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await query(
      'INSERT INTO notification_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [req.user.id, 'logout', req.ip]
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

/** GET /api/auth/me — Récupère l'utilisateur actuel à partir du token */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/** POST /api/auth/change-password */
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Anciens et nouveau mot de passe requis' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Mot de passe trop court (min. 8 caractères)' });

    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Ancien mot de passe incorrect' });

    const newHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS, 10) || 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
