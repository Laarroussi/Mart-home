/**
 * /api/auth — Authentification (login, logout, me, change-password)
 *
 * Toutes les réponses 'user' incluent must_change_password pour permettre
 * au frontend d'imposer un changement de mot de passe à la 1re connexion.
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { signToken, requireAuth } = require('../middleware/auth');
const { validateNewPassword } = require('../utils/account-helpers');

const router = express.Router();

/** POST /api/auth/login — Connexion par email + mot de passe */
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });

    const { rows } = await query(
      `SELECT id, role, name, username, email, password_hash, active, patient_id,
              birth_date, must_change_password
         FROM users WHERE email = $1`,
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
      user: {
        id: user.id, role: user.role, name: user.name, username: user.username,
        email: user.email, patient_id: user.patient_id,
        must_change_password: user.must_change_password
      }
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
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, role, name, username, email, patient_id, birth_date, must_change_password
         FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(401).json({ error: 'Utilisateur introuvable' });
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

/**
 * POST /api/auth/change-password
 *
 * Body : { oldPassword, newPassword }
 *
 * Règles :
 *   - oldPassword doit matcher le hash actuel
 *   - newPassword : ≥ 8 caractères, ≠ ancien, ≠ date de naissance JJ/MM/AAAA, 1 lettre + (1 chiffre ou 1 spécial)
 *   - Après succès : must_change_password passe à false, last_login mis à jour, action loggée
 */
router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Ancien et nouveau mot de passe requis' });
    }

    // Récupère le hash actuel + date de naissance pour la validation
    const { rows } = await query(
      'SELECT password_hash, birth_date FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(401).json({ error: 'Utilisateur introuvable' });

    const valid = await bcrypt.compare(oldPassword, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: 'Ancien mot de passe incorrect' });

    // Validation du nouveau mot de passe
    const check = validateNewPassword(newPassword, {
      oldPassword,
      birthDate: rows[0].birth_date
    });
    if (!check.ok) return res.status(400).json({ error: check.error });

    const newHash = await bcrypt.hash(newPassword, parseInt(process.env.BCRYPT_ROUNDS, 10) || 10);
    await query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
      [newHash, req.user.id]
    );
    await query(
      'INSERT INTO notification_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [req.user.id, 'change-password', req.ip]
    );

    res.json({ success: true, message: 'Mot de passe modifié avec succès.' });
  } catch (err) { next(err); }
});

module.exports = router;
