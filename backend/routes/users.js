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
const crypto = require('crypto');
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
      phone, service, specialty, patient_id,
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
    // true quand le compte s'active par courriel plutôt que par un mot de
    // passe initial : détermine ce qu'on renvoie à l'interface.
    let parLien = false;

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
      // Plus de mot de passe imposé : sans mot de passe fourni, on en tire un
      // au hasard qui ne sera jamais communiqué, et la personne choisit le
      // sien depuis le lien reçu par courriel. C'est le même principe que pour
      // les comptes patients — et c'est plus sûr qu'un mot de passe initial
      // transmis de la main à la main.
      if (!password) {
        password = crypto.randomBytes(24).toString('base64url');
        parLien = true;
        mustChange = true;
      }
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
                          specialty, birth_date, patient_id, created_by, must_change_password)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, role, name, username, email, phone, service, specialty, birth_date, patient_id,
                 created_at, must_change_password`,
      [id, role, name, username, email.toLowerCase(), password_hash,
       phone || null, service || null, specialty || null,
       birth_date || null, patient_id || null, req.user.id, mustChange]
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

    // === Activation par courriel ===
    // Le mot de passe tiré au hasard n'est communiqué à personne : la personne
    // reçoit un lien et choisit le sien. Un mot de passe qu'on transmet est un
    // mot de passe qui circule.
    let activation = null;
    if (parLien) {
      try {
        const { creerEtEnvoyerLien } = require('./activation');
        activation = await creerEtEnvoyerLien({
          userId: id,
          patientId: null,
          email: email.toLowerCase(),
          prenom: firstName || (name || '').split(' ')[0] || null,
          createdBy: req.user.id
        });
      } catch (e) {
        console.warn('[users] envoi du lien d\'activation échoué :', e.message);
        activation = { ok: false, error: e.message };
      }
    }

    res.status(201).json({
      user: rows[0],
      activation,
      // Le mot de passe n'est renvoyé que dans l'ancien mode « date de
      // naissance », où l'administrateur doit effectivement le communiquer.
      initialPassword: (mustChange && !parLien) ? password : undefined,
      message: parLien
        ? (activation && activation.ok
            ? `Compte créé. Un lien de création de mot de passe a été envoyé à ${activation.email_masque || email}.`
            : `Compte créé, mais l'envoi du courriel a échoué${activation && activation.error ? ' : ' + activation.error : ''}. Renvoyez le lien depuis la gestion des comptes.`)
        : (mustChange
            ? `Compte créé. Identifiant : ${username}. Mot de passe initial : ${password} (date de naissance). À changer obligatoirement à la 1re connexion.`
            : `Compte créé avec le mot de passe fourni. Identifiant : ${username}.`)
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

// ============================================================
// ADMINISTRATION DES COMPTES — réservée à l'administrateur principal
// ------------------------------------------------------------
// Ces trois opérations sortent de la gestion courante : elles touchent à
// l'accès d'autrui. Un investigateur crée et désactive des comptes patients,
// c'est son travail ; réinitialiser le mot de passe d'un collègue ou
// supprimer un compte n'en fait pas partie.
//
// Sur les mots de passe : l'administrateur ne peut pas en choisir un.
// Pouvoir fixer le mot de passe de quelqu'un, c'est pouvoir se connecter à sa
// place sans que rien ne le distingue de lui — et tout ce que ce compte fera
// ensuite lui sera attribué. On propose donc deux chemins où l'administrateur
// n'apprend jamais le mot de passe qui finira par être utilisé :
//   • un lien de réinitialisation, que la personne suit elle-même ;
//   • un mot de passe provisoire, tiré au hasard, affiché une seule fois et
//     qui doit être changé à la première connexion.
// ============================================================
const adminSeul = requireRole(ROLE.PRINCIPAL_ADMIN);

/** Mot de passe provisoire lisible à l'oral : on le dicte souvent au téléphone. */
function motDePasseProvisoire() {
  // Ni I, ni l, ni O, ni 0 : confondus à la lecture comme à la dictée.
  const lettres = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  const chiffres = '23456789';
  const tirer = (jeu, n) => Array.from(crypto.randomBytes(n))
    .map(o => jeu[o % jeu.length]).join('');
  // Format fixe : 4 lettres, tiret, 4 chiffres, tiret, 4 lettres.
  return tirer(lettres, 4) + '-' + tirer(chiffres, 4) + '-' + tirer(lettres, 4);
}

/**
 * POST /api/users/:id/reinitialiser
 * body : { mode: 'lien' | 'provisoire' }
 */
router.post('/:id/reinitialiser', requireAuth, adminSeul, async (req, res, next) => {
  try {
    const t = await query(
      'SELECT id, role, name, email, patient_id FROM users WHERE id = $1', [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Compte introuvable.' });
    const cible = t.rows[0];
    const mode = (req.body && req.body.mode) === 'provisoire' ? 'provisoire' : 'lien';

    if (mode === 'lien') {
      if (!cible.email) {
        return res.status(400).json({
          error: "Ce compte n'a pas d'adresse électronique : utilisez un mot de passe provisoire."
        });
      }
      const activation = require('./activation');
      const r = await activation.creerEtEnvoyerLien({
        userId: cible.id, patientId: cible.patient_id || null,
        email: cible.email, prenom: (cible.name || '').split(' ')[0] || null,
        createdBy: req.user.id, heures: 24
      });
      await journaliserAdmin(req, 'reset-lien', cible.id);
      if (!r || r.ok === false) {
        // Le lien reste valable même si l'envoi a échoué : on le remonte
        // plutôt que de laisser l'administrateur recommencer dans le vide.
        return res.status(207).json({
          mode: 'lien', envoye: false,
          avertissement: (r && r.error) || "L'envoi du courriel a échoué.",
          lien_secours: r && r.lien
        });
      }
      return res.json({ mode: 'lien', envoye: true, email_masque: r.email_masque || null });
    }

    const clair = motDePasseProvisoire();
    const hash = await bcrypt.hash(clair, 10);
    await query(
      'UPDATE users SET password_hash = $2, must_change_password = TRUE WHERE id = $1',
      [cible.id, hash]);
    await journaliserAdmin(req, 'reset-provisoire', cible.id);
    // Affiché une seule fois : il n'est stocké nulle part en clair, et le
    // relire exigerait d'en générer un nouveau.
    res.json({ mode: 'provisoire', mot_de_passe: clair });
  } catch (err) { next(err); }
});

/**
 * DELETE /api/users/:id
 *
 * Trois refus, et ils comptent plus que la fonction elle-même :
 *   • son propre compte — on se verrouillerait dehors en un clic ;
 *   • le dernier administrateur actif — plus personne ne pourrait administrer ;
 *   • un compte patient rattaché à un dossier — le dossier perdrait son accès
 *     sans que rien ne le signale. On le désactive à la place.
 */
router.delete('/:id', requireAuth, adminSeul, async (req, res, next) => {
  try {
    if (req.params.id === req.user.id) {
      return res.status(409).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }
    const t = await query('SELECT id, role, name, email, patient_id FROM users WHERE id = $1',
      [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: 'Compte introuvable.' });
    const cible = t.rows[0];

    if (cible.role === ROLE.PRINCIPAL_ADMIN) {
      const n = await query(
        `SELECT COUNT(*)::int AS n FROM users WHERE role = $1 AND active = TRUE AND id <> $2`,
        [ROLE.PRINCIPAL_ADMIN, cible.id]);
      if (!n.rows[0].n) {
        return res.status(409).json({
          error: "C'est le dernier compte administrateur actif. Créez-en un autre avant de supprimer celui-ci."
        });
      }
    }

    if (cible.patient_id && req.query.confirmer !== 'oui') {
      return res.status(409).json({
        error: 'Ce compte donne accès au dossier ' + cible.patient_id +
               '. Le supprimer prive le patient de son espace sans effacer son dossier. ' +
               'Désactivez-le plutôt, ou confirmez la suppression.',
        patient_id: cible.patient_id
      });
    }

    await journaliserAdmin(req, 'delete-user', cible.id, {
      role: cible.role, email: cible.email, patient_id: cible.patient_id
    });
    await query('DELETE FROM users WHERE id = $1', [cible.id]);
    res.json({ supprime: true });
  } catch (err) { next(err); }
});

/** Trace systématique : une action d'administration sur un compte doit
 *  laisser une ligne, même quand elle échoue plus loin. */
async function journaliserAdmin(req, action, cibleId, extra) {
  try {
    await query(
      'INSERT INTO notification_log (user_id, action, details, ip_address) VALUES ($1,$2,$3,$4)',
      [req.user.id, action,
       JSON.stringify(Object.assign({ target: cibleId }, extra || {})), req.ip]);
  } catch (e) { console.warn('[users] journalisation :', e.message); }
}

module.exports = router;
