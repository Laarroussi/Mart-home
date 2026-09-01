/**
 * /api/activation — Activation de compte par lien à usage unique
 * ==============================================================
 * Routes publiques (pas de token JWT — le jeton d'activation fait foi) :
 *   GET  /verify/:token   → vérifie la validité, renvoie un e-mail masqué
 *   POST /complete        → { token, password } définit le mot de passe
 *
 * Routes protégées (staff) :
 *   POST /send/:patient_id → (re)génère un lien et l'envoie par e-mail
 *   GET  /status           → diagnostic de la configuration d'envoi
 *
 * Principe : le mot de passe ne transite jamais par e-mail. Le patient
 * le choisit lui-même via un lien personnel, valable 72 h, à usage unique.
 */
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');
const { sendMail, mailerStatus, activationEmail } = require('../config/mailer');

const router = express.Router();

const VALIDITE_HEURES = parseInt(process.env.ACTIVATION_TTL_HOURS, 10) || 72;
const MIN_PWD = 10;

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://marfan-sport-sante.fr').replace(/\/$/, '');
}

/** Masque une adresse : marie.dupont@x.fr → m***t@x.fr */
function maskEmail(email) {
  const [loc, dom] = String(email || '').split('@');
  if (!dom) return '—';
  const visible = loc.length <= 2 ? loc[0] : loc[0] + '***' + loc[loc.length - 1];
  return visible + '@' + dom;
}

/**
 * Génère un jeton, invalide les précédents, envoie l'e-mail.
 * Utilisé par cette route ET par la création de patient.
 * Ne lève jamais : renvoie { ok, error }.
 */
async function creerEtEnvoyerLien({ userId, patientId, email, prenom, createdBy }) {
  if (!email) return { ok: false, error: 'Aucune adresse e-mail renseignée pour ce patient' };
  try {
    // Un seul lien actif à la fois : les anciens sont neutralisés
    await query(
      `UPDATE activation_tokens SET used_at = NOW()
        WHERE user_id = $1 AND used_at IS NULL`, [userId]);

    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + VALIDITE_HEURES * 3600 * 1000);
    await query(
      `INSERT INTO activation_tokens (token, user_id, patient_id, email, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [token, userId, patientId || null, email, expires, createdBy || null]);

    const lien = baseUrl() + '/?activation=' + token;
    const { subject, text, html } = activationEmail({ prenom, lien, heures: VALIDITE_HEURES });

    try {
      const r = await sendMail({ to: email, subject, text, html });
      await query('UPDATE activation_tokens SET sent_ok = TRUE WHERE token = $1', [token]);
      await query(
        `INSERT INTO activation_log (user_id, patient_id, action, detail)
         VALUES ($1,$2,'send-ok',$3)`, [userId, patientId || null, r.mode]);
      return { ok: true, mode: r.mode, email_masque: maskEmail(email) };
    } catch (e) {
      await query('UPDATE activation_tokens SET sent_ok = FALSE, send_error = $2 WHERE token = $1',
        [token, e.message]);
      await query(
        `INSERT INTO activation_log (user_id, patient_id, action, detail)
         VALUES ($1,$2,'send-fail',$3)`, [userId, patientId || null, e.message]);
      // Le lien reste valide : le soignant peut le transmettre autrement
      return { ok: false, error: e.message, lien_secours: lien };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================
// GET /status — diagnostic (staff)
// ============================================================
router.get('/status', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR),
  (req, res) => {
    res.json({ mailer: mailerStatus(), validite_heures: VALIDITE_HEURES, base_url: baseUrl() });
  });

// ============================================================
// POST /send/:patient_id — (re)envoi du lien d'activation (staff)
// ============================================================
router.post('/send/:patient_id', requireAuth,
  requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
    try {
      const pid = req.params.patient_id;
      const { rows } = await query(
        `SELECT id, email, name FROM users WHERE patient_id = $1 AND role = 'patient' LIMIT 1`, [pid]);
      if (!rows.length) return res.status(404).json({ error: 'Aucun compte patient pour ' + pid });

      const u = rows[0];
      const email = (req.body && req.body.email) || u.email;
      // Si une nouvelle adresse est fournie, on met le compte à jour
      if (req.body && req.body.email && req.body.email !== u.email) {
        await query('UPDATE users SET email = $1 WHERE id = $2', [req.body.email, u.id]);
      }
      const r = await creerEtEnvoyerLien({
        userId: u.id, patientId: pid, email,
        prenom: (req.body && req.body.prenom) || null, createdBy: req.user.id
      });
      if (!r.ok) return res.status(502).json({ error: r.error, lien_secours: r.lien_secours });
      res.json({ success: true, email_masque: r.email_masque, mode: r.mode,
                 validite_heures: VALIDITE_HEURES });
    } catch (err) { next(err); }
  });

// ============================================================
// GET /verify/:token — vérification publique du lien
// ============================================================
router.get('/verify/:token', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.token, a.email, a.expires_at, a.used_at, u.name, u.username, u.patient_id
         FROM activation_tokens a JOIN users u ON u.id = a.user_id
        WHERE a.token = $1`, [req.params.token]);
    if (!rows.length) return res.status(404).json({ valid: false, reason: 'inconnu' });
    const t = rows[0];
    if (t.used_at)   return res.status(410).json({ valid: false, reason: 'deja_utilise' });
    if (new Date(t.expires_at) < new Date())
      return res.status(410).json({ valid: false, reason: 'expire' });
    res.json({
      valid: true,
      email_masque: maskEmail(t.email),
      identifiant: t.username || t.patient_id,
      nom: t.name || null,
      min_password: MIN_PWD
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /complete — { token, password } : le patient choisit son mot de passe
// ============================================================
router.post('/complete', async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Lien manquant' });
    if (!password || String(password).length < MIN_PWD) {
      return res.status(400).json({ error: `Le mot de passe doit contenir au moins ${MIN_PWD} caractères` });
    }
    const { rows } = await query(
      `SELECT user_id, patient_id, expires_at, used_at FROM activation_tokens WHERE token = $1`, [token]);
    if (!rows.length) return res.status(404).json({ error: 'Lien invalide' });
    const t = rows[0];
    if (t.used_at) return res.status(410).json({ error: 'Ce lien a déjà été utilisé' });
    if (new Date(t.expires_at) < new Date())
      return res.status(410).json({ error: 'Ce lien a expiré. Demandez-en un nouveau à votre référent.' });

    const hash = await bcrypt.hash(String(password),
      parseInt(process.env.BCRYPT_ROUNDS, 10) || 10);
    await query(
      `UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2`,
      [hash, t.user_id]);
    await query('UPDATE activation_tokens SET used_at = NOW() WHERE token = $1', [token]);
    await query(
      `INSERT INTO activation_log (user_id, patient_id, action, detail)
       VALUES ($1,$2,'activated','mot de passe défini')`, [t.user_id, t.patient_id]);

    res.json({ success: true, message: 'Compte activé. Vous pouvez maintenant vous connecter.' });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.creerEtEnvoyerLien = creerEtEnvoyerLien;
