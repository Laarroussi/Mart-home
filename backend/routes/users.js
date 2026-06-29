/**
 * /api/users — Gestion des comptes
 *
 * Modèle à 3 rôles :
 *   - principal_admin : peut tout (lister tous, créer / modifier / désactiver n'importe quel rôle)
 *   - investigator    : peut créer / modifier / désactiver uniquement des comptes patient
 *                       et peut lister les comptes patient
 *   - patient         : aucun accès aux endpoints /users
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE, canManageRole } = require('../middleware/auth');
const {
  generateUsername, findUniqueUsername, formatBirthDateAsPassword
} = require('../utils/account-helpers');

const router = express.Router();

/**
 * GET /api/users
 * - principal_admin : voit tous les comptes (filtres optionnels)
 * - investigator    : voit uniquement les comptes patient
 */
router.get('/', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const { role, active } = req.query;
    let sql = `SELECT id, role, name, username, email, phone, service, birth_date, patient_id,
                      created_by, created_at, active, last_login, must_change_password
                 FROM users WHERE 1=1`;
    const params = [];
    // Investigator est limité aux comptes patient
    if (req.user.role === ROLE.INVESTIGATOR) {
      params.push(ROLE.PATIENT);
      sql += ` AND role = $${params.length}`;
    } else if (role) {
      params.push(role);
      sql += ` AND role = $${params.length}`;
    }
    if (active !== undefined) { params.push(active === 'true'); sql += ` AND active = $${params.length}`; }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await query(sql, params);
    res.json({ users: rows });
  } catch (err) { next(err); }
});

/**
 * POST /api/users — Créer un compte
 * - principal_admin : peut créer principal_admin / investigator / patient
 * - investigator    : peut créer UNIQUEMENT patient
 * - autres          : refusé
 */
/**
 * POST /api/users — Créer un compte avec auto-username et mot de passe initial = date de naissance
 *
 * Body attendu (NOUVEAU FORMAT) :
 *   {
 *     role:        'patient' | 'investigator' | 'principal_admin',
 *     firstName:   'Jean',                  // requis pour générer le username
 *     lastName:    'Dupont',                // requis pour générer le username
 *     birth_date:  '1980-09-25',            // requis : sert de mot de passe initial (JJ/MM/AAAA)
 *     email:       'jean.dupont@bichat.fr', // requis
 *     phone, service, patient_id            // optionnels
 *   }
 *
 * Génère automatiquement :
 *   - name = "Jean Dupont"
 *   - username = "jean.dupont" (ou "jean.dupont2" si doublon)
 *   - mot de passe initial = "25/09/1980" (hashé, must_change_password = true)
 *
 * Compat ancien format : si name/password sont fournis directement, on les respecte.
 */
router.post('/', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    let {
      role, firstName, lastName, birth_date, email,
      phone, service, patient_id,
      // Compat ancien format :
      name, password
    } = req.body || {};

    // Validation des champs minimaux
    if (!role)  return res.status(400).json({ error: 'Champ role requis' });
    if (!email) return res.status(400).json({ error: 'Champ email requis' });

    // Vérification stricte de la permission (defense in depth)
    if (!canManageRole(req.user.role, role)) {
      return res.status(403).json({
        error: `Votre rôle (${req.user.role}) n'autorise pas la création d'un compte ${role}`
      });
    }

    // === Construction automatique des champs nom + username + mot de passe ===
    let mustChange = false;
    let username = null;

    if (firstName || lastName) {
      // Nouveau format : auto-génération
      if (!birth_date) return res.status(400).json({ error: 'birth_date requis (mot de passe initial = date de naissance JJ/MM/AAAA)' });
      if (!name) name = [firstName, lastName].filter(Boolean).join(' ').trim();
      const base = generateUsername(firstName, lastName);
      if (!base) return res.status(400).json({ error: 'firstName et/ou lastName invalides pour générer un username' });
      username = await findUniqueUsername(base);
      password = formatBirthDateAsPassword(birth_date);  // ex : "25/09/1980"
      mustChange = true;                                  // changement obligatoire à la 1re connexion
    } else {
      // Ancien format : name + password fournis directement (compat)
      if (!name)     return res.status(400).json({ error: 'name ou (firstName + lastName) requis' });
      if (!password) return res.status(400).json({ error: 'password ou birth_date requis' });
      // username par défaut : partie locale de l'email
      username = await findUniqueUsername(email.split('@')[0].toLowerCase());
    }

    // Email unique
    const exists = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email déjà utilisé' });

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Mot de passe trop court (min. 8 caractères). Vérifiez le format de birth_date.' });
    }

    const id = 'u-' + role.slice(0, 6) + '-' + Date.now().toString(36);
    const password_hash = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS, 10) || 10);

    const { rows } = await query(
      `INSERT INTO users (id, role, name, username, email, password_hash, phone, service,
                          birth_date, patient_id, created_by, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, role, name, username, email, phone, service, birth_date, patient_id,
                 created_at, must_change_password`,
      [id, role, name, username, email.toLowerCase(), password_hash,
       phone || null, service || null, birth_date || null, patient_id || null, req.user.id, mustChange]
    );
    await query(
      'INSERT INTO notification_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [req.user.id, 'create-user', JSON.stringify({ created: id, role, username }), req.ip]
    );

    // === SI compte patient : crée automatiquement SF-36 + GPAQ obligatoires ===
    if (role === 'patient' && (patient_id || rows[0].patient_id)) {
      const pid = patient_id || rows[0].patient_id;
      try {
        await query(
          `INSERT INTO questionnaire_responses (patient_id, questionnaire_type, sent_by, status, mandatory, notes)
           VALUES ($1, 'sf36', $2, 'pending', TRUE, 'Auto-créé à l''inclusion')`,
          [pid, req.user.id]
        );
        await query(
          `INSERT INTO questionnaire_responses (patient_id, questionnaire_type, sent_by, status, mandatory, notes)
           VALUES ($1, 'gpaq', $2, 'pending', TRUE, 'Auto-créé à l''inclusion')`,
          [pid, req.user.id]
        );
      } catch (e) { console.warn('[users] auto-questionnaires échoué :', e.message); }
    }

    // Réponse enrichie : on renvoie le user créé + le mot de passe initial EN CLAIR
    // (uniquement pour que le principal_admin puisse le communiquer à l'utilisateur).
    res.status(201).json({
      user: rows[0],
      initialPassword: mustChange ? password : undefined,
      message: mustChange
        ? `Compte créé. Username : ${username}. Mot de passe initial : ${password} (date de naissance). À changer obligatoirement à la 1re connexion.`
        : `Compte créé avec mot de passe fourni. Username : ${username}.`
    });
  } catch (err) { next(err); }
});

/**
 * PATCH /api/users/:id — Modifier un compte
 * - principal_admin : peut modifier n'importe quel compte
 * - investigator    : peut modifier uniquement les comptes patient
 */
router.patch('/:id', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const { name, phone, service, active } = req.body || {};
    const target = await query('SELECT role FROM users WHERE id = $1', [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });

    // Vérification stricte : peut-il toucher ce rôle ?
    if (!canManageRole(req.user.role, target.rows[0].role)) {
      return res.status(403).json({
        error: `Vous (${req.user.role}) ne pouvez pas modifier un compte de rôle ${target.rows[0].role}`
      });
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
    await query(
      'INSERT INTO notification_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
      [req.user.id, 'update-user', JSON.stringify({ target: req.params.id, fields: Object.keys(req.body || {}) }), req.ip]
    );
    res.json({ user: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
