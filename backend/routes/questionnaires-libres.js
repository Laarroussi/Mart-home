/**
 * /api/questionnaires-libres — Questionnaires composés et diffusés librement
 * ==========================================================================
 *
 * Partie privée, pour le propriétaire :
 *   GET    /                        → ses questionnaires, avec le compte des réponses
 *   GET    /:id                     → le questionnaire, ses questions, ses envois
 *   POST   /                        → crée un questionnaire
 *   PUT    /:id                     → modifie l'en-tête
 *   DELETE /:id                     → supprime (questions, envois et réponses suivent)
 *   POST   /:id/questions           → ajoute une question
 *   PUT    /questions/:qid          → modifie une question
 *   DELETE /questions/:qid          → supprime une question
 *   POST   /:id/envoyer             → envoie un lien personnel par courriel
 *   POST   /envois/:eid/relancer    → renvoie le même lien
 *   DELETE /envois/:eid             → annule une invitation non honorée
 *   GET    /:id/reponses            → le tableau des réponses
 *   GET    /:id/export              → le même, en CSV
 *
 * Partie publique, pour la personne interrogée — sans compte ni mot de passe :
 *   GET    /public/:jeton           → le questionnaire à remplir
 *   POST   /public/:jeton           → enregistre les réponses
 *
 * ---- Cloisonnement ----
 * Un questionnaire n'appartient qu'à son créateur. Toutes les requêtes
 * privées passent par `posseder()`, qui vérifie la propriété avant de rendre
 * quoi que ce soit. L'administrateur principal fait exception : il est
 * responsable des données de la plateforme, et un questionnaire dont le
 * créateur a quitté l'équipe doit rester récupérable.
 *
 * ---- Pourquoi aucune donnée patient ici ----
 * Ces réponses ne sont rattachées à aucun dossier, par construction : il n'y
 * a pas de colonne patient_id dans ces tables. Ce n'est pas un oubli. Un
 * questionnaire libre peut être adressé à un témoin, à un collègue, à
 * quelqu'un qui n'est pas suivi — et une colonne facultative finit toujours
 * par être remplie à moitié, puis utilisée comme si elle l'était toujours.
 */
const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');
const { sendMail } = require('../config/mailer');

const router = express.Router();
const staff = requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR);

const TYPES = ['texte', 'texte_long', 'nombre', 'date', 'choix',
               'choix_multiple', 'oui_non', 'echelle'];

const vide = (v) => v === undefined ? null : (v === '' ? null : v);

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://marfan-sport-sante.fr').replace(/\/$/, '');
}

/**
 * Charge un questionnaire en vérifiant que l'appelant a le droit de le voir.
 * Lève une 404 plutôt qu'une 403 quand il ne lui appartient pas : répondre
 * « interdit » confirmerait l'existence du questionnaire à quelqu'un qui n'a
 * pas à le savoir.
 */
async function posseder(req, id) {
  const r = await query(`SELECT * FROM ql_questionnaires WHERE id = $1`, [id]);
  if (!r.rows.length) { const e = new Error('Questionnaire introuvable.'); e.status = 404; throw e; }
  const q = r.rows[0];
  if (q.proprietaire !== req.user.id && req.user.role !== ROLE.PRINCIPAL_ADMIN) {
    const e = new Error('Questionnaire introuvable.'); e.status = 404; throw e;
  }
  return q;
}

/** Comme ci-dessus, en partant d'une question ou d'un envoi. */
async function possederVia(req, table, colonne, valeur) {
  const r = await query(
    `SELECT questionnaire_id FROM ${table} WHERE ${colonne} = $1`, [valeur]);
  if (!r.rows.length) { const e = new Error('Élément introuvable.'); e.status = 404; throw e; }
  await posseder(req, r.rows[0].questionnaire_id);
  return r.rows[0].questionnaire_id;
}

// ============================================================
// PARTIE PUBLIQUE — déclarée en premier, sinon /:id la capture
// ============================================================

/** GET /public/:jeton — le formulaire à remplir */
router.get('/public/:jeton', async (req, res, next) => {
  try {
    const e = await query(
      `SELECT e.id, e.nom, e.expire_le, e.repondu_le, q.id AS qid, q.titre,
              q.description, q.consigne, q.message_fin, q.actif
         FROM ql_envois e
         JOIN ql_questionnaires q ON q.id = e.questionnaire_id
        WHERE e.jeton = $1`, [req.params.jeton]);

    // Un jeton inconnu, expiré ou déjà consommé donne la même forme de
    // réponse : on ne dit jamais à un visiteur anonyme pourquoi un lien ne
    // marche pas, sinon on l'aide à deviner les jetons valides.
    if (!e.rows.length) return res.status(404).json({ etat: 'invalide' });
    const env = e.rows[0];
    if (!env.actif) return res.status(410).json({ etat: 'ferme' });
    if (env.repondu_le) return res.status(409).json({ etat: 'deja_repondu', message_fin: env.message_fin });
    if (new Date(env.expire_le) < new Date()) return res.status(410).json({ etat: 'expire' });

    const q = await query(
      `SELECT id, libelle, type, choix, obligatoire, valeur_min, valeur_max, aide, rang
         FROM ql_questions WHERE questionnaire_id = $1 ORDER BY rang ASC, id ASC`,
      [env.qid]);

    res.json({
      etat: 'ouvert',
      titre: env.titre,
      description: env.description,
      consigne: env.consigne,
      destinataire: env.nom,
      expire_le: env.expire_le,
      questions: q.rows
    });
  } catch (err) { next(err); }
});

/** POST /public/:jeton — enregistre les réponses */
router.post('/public/:jeton', async (req, res, next) => {
  try {
    const e = await query(
      `SELECT e.id, e.questionnaire_id, e.expire_le, e.repondu_le, q.actif, q.message_fin
         FROM ql_envois e
         JOIN ql_questionnaires q ON q.id = e.questionnaire_id
        WHERE e.jeton = $1`, [req.params.jeton]);
    if (!e.rows.length) return res.status(404).json({ etat: 'invalide' });
    const env = e.rows[0];
    if (!env.actif) return res.status(410).json({ etat: 'ferme' });
    if (env.repondu_le) return res.status(409).json({ etat: 'deja_repondu' });
    if (new Date(env.expire_le) < new Date()) return res.status(410).json({ etat: 'expire' });

    const recues = (req.body && req.body.reponses) || {};
    const questions = await query(
      `SELECT id, libelle, type, obligatoire FROM ql_questions
        WHERE questionnaire_id = $1`, [env.questionnaire_id]);

    // Les champs obligatoires sont vérifiés ici et pas seulement dans le
    // navigateur : un formulaire renvoyé directement contournerait toute
    // vérification faite côté client.
    const manquantes = questions.rows
      .filter(q => q.obligatoire)
      .filter(q => {
        const v = recues[String(q.id)];
        return v === undefined || v === null || String(v).trim() === '';
      })
      .map(q => q.libelle);
    if (manquantes.length) {
      return res.status(400).json({
        etat: 'incomplet',
        manquantes,
        error: 'Réponse attendue pour : ' + manquantes.join(', ')
      });
    }

    const connues = new Set(questions.rows.map(q => q.id));
    for (const [qid, valeur] of Object.entries(recues)) {
      const id = Number(qid);
      if (!connues.has(id)) continue;   // question d'un autre questionnaire : ignorée
      const v = Array.isArray(valeur) ? valeur.join(' ; ') : String(valeur == null ? '' : valeur);
      await query(
        `INSERT INTO ql_reponses (envoi_id, question_id, valeur)
         VALUES ($1,$2,$3)
         ON CONFLICT (envoi_id, question_id) DO UPDATE SET valeur = EXCLUDED.valeur`,
        [env.id, id, v.slice(0, 10000)]);
    }

    await query(`UPDATE ql_envois SET repondu_le = NOW() WHERE id = $1`, [env.id]);
    res.json({ etat: 'enregistre', message_fin: env.message_fin });
  } catch (err) { next(err); }
});

// ============================================================
// PARTIE PRIVÉE
// ============================================================

router.get('/', requireAuth, staff, async (req, res, next) => {
  try {
    const admin = req.user.role === ROLE.PRINCIPAL_ADMIN;
    const r = await query(
      `SELECT q.*,
              (SELECT COUNT(*)::int FROM ql_questions x WHERE x.questionnaire_id = q.id) AS nb_questions,
              (SELECT COUNT(*)::int FROM ql_envois e WHERE e.questionnaire_id = q.id) AS nb_envois,
              (SELECT COUNT(*)::int FROM ql_envois e
                WHERE e.questionnaire_id = q.id AND e.repondu_le IS NOT NULL) AS nb_reponses
         FROM ql_questionnaires q
        WHERE ($1::boolean OR q.proprietaire = $2)
        ORDER BY q.cree_le DESC`, [admin, req.user.id]);
    res.json({ questionnaires: r.rows });
  } catch (e) { next(e); }
});

router.get('/:id(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    const q = await posseder(req, req.params.id);
    const questions = await query(
      `SELECT * FROM ql_questions WHERE questionnaire_id = $1 ORDER BY rang ASC, id ASC`,
      [q.id]);
    const envois = await query(
      `SELECT id, email, nom, envoye_le, expire_le, repondu_le, relances,
              derniere_relance, mail_statut
         FROM ql_envois WHERE questionnaire_id = $1 ORDER BY envoye_le DESC`, [q.id]);
    res.json({ questionnaire: q, questions: questions.rows, envois: envois.rows });
  } catch (e) { next(e); }
});

router.post('/', requireAuth, staff, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!String(b.titre || '').trim()) {
      return res.status(400).json({ error: 'Le titre est requis.' });
    }
    const r = await query(
      `INSERT INTO ql_questionnaires (proprietaire, titre, description, consigne,
                                      message_fin, validite_jours)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, b.titre.trim(), vide(b.description), vide(b.consigne),
       vide(b.message_fin), Number(b.validite_jours) > 0 ? Number(b.validite_jours) : 30]);
    res.status(201).json({ questionnaire: r.rows[0] });
  } catch (e) { next(e); }
});

router.put('/:id(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    await posseder(req, req.params.id);
    const b = req.body || {};
    const r = await query(
      `UPDATE ql_questionnaires SET
         titre = COALESCE($2, titre), description = $3, consigne = $4,
         message_fin = $5, validite_jours = COALESCE($6, validite_jours),
         actif = COALESCE($7, actif), maj_le = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id, vide(b.titre), vide(b.description), vide(b.consigne),
       vide(b.message_fin), Number(b.validite_jours) > 0 ? Number(b.validite_jours) : null,
       b.actif === undefined ? null : !!b.actif]);
    res.json({ questionnaire: r.rows[0] });
  } catch (e) { next(e); }
});

router.delete('/:id(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    await posseder(req, req.params.id);
    const n = await query(
      `SELECT COUNT(*)::int AS n FROM ql_envois
        WHERE questionnaire_id = $1 AND repondu_le IS NOT NULL`, [req.params.id]);
    // Supprimer un questionnaire déjà rempli efface des réponses que personne
    // ne pourra redemander. On exige une confirmation explicite.
    if (n.rows[0].n > 0 && req.query.confirmer !== 'oui') {
      return res.status(409).json({
        error: n.rows[0].n + ' réponse(s) seront définitivement perdues. ' +
               'Exportez-les avant, puis confirmez.',
        nb_reponses: n.rows[0].n
      });
    }
    await query(`DELETE FROM ql_questionnaires WHERE id = $1`, [req.params.id]);
    res.json({ supprime: true });
  } catch (e) { next(e); }
});

// ---- Questions ----
router.post('/:id(\\d+)/questions', requireAuth, staff, async (req, res, next) => {
  try {
    await posseder(req, req.params.id);
    const b = req.body || {};
    if (!String(b.libelle || '').trim()) {
      return res.status(400).json({ error: 'Le libellé de la question est requis.' });
    }
    const type = TYPES.indexOf(b.type) >= 0 ? b.type : 'texte';
    if ((type === 'choix' || type === 'choix_multiple') && !String(b.choix || '').trim()) {
      return res.status(400).json({
        error: 'Une question à choix doit lister ses réponses possibles, séparées par des points-virgules.'
      });
    }
    const m = await query(
      `SELECT COALESCE(MAX(rang), -1) + 1 AS r FROM ql_questions WHERE questionnaire_id = $1`,
      [req.params.id]);
    const r = await query(
      `INSERT INTO ql_questions (questionnaire_id, code, libelle, type, choix,
                                 obligatoire, valeur_min, valeur_max, aide, rang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, vide(b.code), b.libelle.trim(), type, vide(b.choix),
       !!b.obligatoire, vide(b.valeur_min), vide(b.valeur_max), vide(b.aide),
       b.rang != null ? b.rang : m.rows[0].r]);
    res.status(201).json({ question: r.rows[0] });
  } catch (e) { next(e); }
});

router.put('/questions/:qid(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    await possederVia(req, 'ql_questions', 'id', req.params.qid);
    const b = req.body || {};
    const type = TYPES.indexOf(b.type) >= 0 ? b.type : null;
    const r = await query(
      `UPDATE ql_questions SET
         code = $2, libelle = COALESCE($3, libelle), type = COALESCE($4, type),
         choix = $5, obligatoire = COALESCE($6, obligatoire),
         valeur_min = $7, valeur_max = $8, aide = $9, rang = COALESCE($10, rang)
       WHERE id = $1 RETURNING *`,
      [req.params.qid, vide(b.code), vide(b.libelle), type, vide(b.choix),
       b.obligatoire === undefined ? null : !!b.obligatoire,
       vide(b.valeur_min), vide(b.valeur_max), vide(b.aide),
       b.rang != null ? b.rang : null]);
    res.json({ question: r.rows[0] });
  } catch (e) { next(e); }
});

router.delete('/questions/:qid(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    await possederVia(req, 'ql_questions', 'id', req.params.qid);
    await query(`DELETE FROM ql_questions WHERE id = $1`, [req.params.qid]);
    res.json({ supprimee: true });
  } catch (e) { next(e); }
});

// ---- Envois ----
function gabaritInvitation({ nom, titre, consigne, lien, jours }) {
  const bonjour = nom ? 'Bonjour ' + nom + ',' : 'Bonjour,';
  const texte = [
    bonjour, '',
    'Vous êtes invité à répondre au questionnaire « ' + titre + ' ».',
    consigne ? '\n' + consigne : '',
    '', 'Le lien ci-dessous vous est personnel. Il est valable ' + jours +
    ' jours et ne peut être utilisé qu\'une fois :', '', lien, '',
    'Vous n\'avez ni compte ni mot de passe à créer.', '',
    'Si ce message ne vous concerne pas, ignorez-le : aucune réponse ne sera enregistrée.'
  ].join('\n');

  const html = '<div style="font-family:-apple-system,Segoe UI,system-ui,sans-serif; font-size:14px; line-height:1.6; color:#10233f;">' +
    '<p>' + bonjour + '</p>' +
    '<p>Vous êtes invité à répondre au questionnaire <strong>' +
      String(titre).replace(/</g, '&lt;') + '</strong>.</p>' +
    (consigne ? '<p style="color:#475569;">' + String(consigne).replace(/</g, '&lt;') + '</p>' : '') +
    '<p style="margin:22px 0;"><a href="' + lien + '" style="display:inline-block; padding:12px 22px; ' +
      'background:#0f766e; color:#fff; text-decoration:none; border-radius:9px; font-weight:700;">' +
      'Répondre au questionnaire</a></p>' +
    '<p style="font-size:12.5px; color:#64748b;">Ce lien vous est personnel, valable ' + jours +
      ' jours, et ne peut être utilisé qu\'une fois. Vous n\'avez ni compte ni mot de passe à créer.</p>' +
    '<p style="font-size:12.5px; color:#94a3b8;">Si ce message ne vous concerne pas, ignorez-le : ' +
      'aucune réponse ne sera enregistrée.</p>' +
    '</div>';

  return { subject: 'Questionnaire : ' + titre, text: texte, html };
}

router.post('/:id(\\d+)/envoyer', requireAuth, staff, async (req, res, next) => {
  try {
    const q = await posseder(req, req.params.id);
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Adresse électronique invalide.' });
    }
    const nbQ = await query(
      `SELECT COUNT(*)::int AS n FROM ql_questions WHERE questionnaire_id = $1`, [q.id]);
    if (!nbQ.rows[0].n) {
      return res.status(400).json({ error: 'Ajoutez au moins une question avant d\'envoyer.' });
    }

    const jeton = crypto.randomBytes(32).toString('hex');
    const jours = q.validite_jours || 30;

    let envoi;
    try {
      const r = await query(
        `INSERT INTO ql_envois (questionnaire_id, email, nom, jeton, expire_le, cree_par)
         VALUES ($1,$2,$3,$4, NOW() + ($5 || ' days')::interval, $6) RETURNING *`,
        [q.id, email, vide(b.nom), jeton, String(jours), req.user.id]);
      envoi = r.rows[0];
    } catch (e) {
      if (e && e.code === '23505') {
        return res.status(409).json({
          error: 'Une invitation est déjà en attente pour cette adresse. Utilisez « Relancer ».'
        });
      }
      throw e;
    }

    const lien = baseUrl() + '/repondre.html?j=' + jeton;
    const { subject, text, html } = gabaritInvitation({
      nom: b.nom, titre: q.titre, consigne: q.consigne, lien, jours
    });

    try {
      await sendMail({ to: email, subject, text, html });
      await query(`UPDATE ql_envois SET mail_statut = 'envoye' WHERE id = $1`, [envoi.id]);
      res.status(201).json({ envoi: Object.assign({}, envoi, { mail_statut: 'envoye' }) });
    } catch (e) {
      // L'invitation reste valide : le lien peut être transmis autrement.
      // L'effacer parce que le courriel a échoué obligerait à tout refaire.
      await query(`UPDATE ql_envois SET mail_statut = $2 WHERE id = $1`,
        [envoi.id, 'echec : ' + String(e.message).slice(0, 180)]);
      res.status(207).json({
        envoi: Object.assign({}, envoi, { mail_statut: 'echec' }),
        avertissement: "Le courriel n'a pas pu être envoyé : " + e.message,
        lien_secours: lien
      });
    }
  } catch (e) { next(e); }
});

router.post('/envois/:eid(\\d+)/relancer', requireAuth, staff, async (req, res, next) => {
  try {
    await possederVia(req, 'ql_envois', 'id', req.params.eid);
    const r = await query(
      `SELECT e.*, q.titre, q.consigne, q.validite_jours
         FROM ql_envois e JOIN ql_questionnaires q ON q.id = e.questionnaire_id
        WHERE e.id = $1`, [req.params.eid]);
    const e0 = r.rows[0];
    if (e0.repondu_le) return res.status(409).json({ error: 'Cette personne a déjà répondu.' });

    // La relance prolonge la validité : relancer avec un lien périmé le jour
    // même est le meilleur moyen de n'obtenir aucune réponse.
    const jours = e0.validite_jours || 30;
    await query(
      `UPDATE ql_envois SET relances = relances + 1, derniere_relance = NOW(),
              expire_le = NOW() + ($2 || ' days')::interval
        WHERE id = $1`, [e0.id, String(jours)]);

    const lien = baseUrl() + '/repondre.html?j=' + e0.jeton;
    const { subject, text, html } = gabaritInvitation({
      nom: e0.nom, titre: e0.titre, consigne: e0.consigne, lien, jours
    });
    try {
      await sendMail({ to: e0.email, subject: 'Rappel — ' + subject, text, html });
      await query(`UPDATE ql_envois SET mail_statut = 'envoye' WHERE id = $1`, [e0.id]);
      res.json({ relance: true });
    } catch (err) {
      res.status(207).json({ relance: false, avertissement: err.message, lien_secours: lien });
    }
  } catch (e) { next(e); }
});

router.delete('/envois/:eid(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    await possederVia(req, 'ql_envois', 'id', req.params.eid);
    const r = await query(
      `DELETE FROM ql_envois WHERE id = $1 AND repondu_le IS NULL RETURNING id`,
      [req.params.eid]);
    if (!r.rows.length) {
      return res.status(409).json({
        error: 'Cette personne a répondu : sa réponse fait partie des données. ' +
               'Supprimez le questionnaire entier si vous voulez tout effacer.'
      });
    }
    res.json({ supprime: true });
  } catch (e) { next(e); }
});

// ---- Résultats ----
async function tableauReponses(questionnaireId) {
  const questions = await query(
    `SELECT id, code, libelle FROM ql_questions
      WHERE questionnaire_id = $1 ORDER BY rang ASC, id ASC`, [questionnaireId]);
  const envois = await query(
    `SELECT id, email, nom, envoye_le, repondu_le FROM ql_envois
      WHERE questionnaire_id = $1 AND repondu_le IS NOT NULL
      ORDER BY repondu_le ASC`, [questionnaireId]);
  const reponses = await query(
    `SELECT r.envoi_id, r.question_id, r.valeur
       FROM ql_reponses r JOIN ql_envois e ON e.id = r.envoi_id
      WHERE e.questionnaire_id = $1`, [questionnaireId]);

  const parEnvoi = {};
  reponses.rows.forEach(r => {
    (parEnvoi[r.envoi_id] = parEnvoi[r.envoi_id] || {})[r.question_id] = r.valeur;
  });

  return {
    questions: questions.rows,
    lignes: envois.rows.map(e => ({
      envoi_id: e.id, email: e.email, nom: e.nom,
      envoye_le: e.envoye_le, repondu_le: e.repondu_le,
      valeurs: parEnvoi[e.id] || {}
    }))
  };
}

router.get('/:id(\\d+)/reponses', requireAuth, staff, async (req, res, next) => {
  try {
    await posseder(req, req.params.id);
    res.json(await tableauReponses(req.params.id));
  } catch (e) { next(e); }
});

/**
 * Export CSV.
 *
 * Les colonnes de questions sont préfixées « Libre · <titre> · ». C'est verbeux,
 * et c'est voulu : un export ouvert à côté d'un export SF-36 dans un tableur
 * ne doit laisser aucune colonne ambiguë. Une colonne « Douleur » sans
 * préfixe pourrait appartenir à l'un comme à l'autre, et personne ne s'en
 * apercevrait avant l'analyse.
 */
router.get('/:id(\\d+)/export', requireAuth, staff, async (req, res, next) => {
  try {
    const q = await posseder(req, req.params.id);
    const { questions, lignes } = await tableauReponses(q.id);

    const prefixe = 'Libre · ' + q.titre + ' · ';
    const ech = (v) => {
      const s = String(v == null ? '' : v);
      return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const entetes = ['Destinataire', 'Adresse', 'Envoyé le', 'Répondu le']
      .concat(questions.map(x => prefixe + (x.code ? x.code + ' — ' : '') + x.libelle));

    const corps = lignes.map(l => [
      l.nom || '', l.email,
      l.envoye_le ? new Date(l.envoye_le).toISOString().slice(0, 10) : '',
      l.repondu_le ? new Date(l.repondu_le).toISOString().slice(0, 10) : ''
    ].concat(questions.map(x => l.valeurs[x.id] || '')).map(ech).join(';'));

    // Point-virgule et BOM : c'est ce qu'attend Excel en configuration
    // française. Sans le BOM, les accents sortent illisibles.
    const csv = '﻿' + [entetes.map(ech).join(';')].concat(corps).join('\r\n');
    const nom = 'questionnaire-libre-' +
      q.titre.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 50) +
      '-' + new Date().toISOString().slice(0, 10) + '.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + nom + '"');
    res.send(csv);
  } catch (e) { next(e); }
});

module.exports = router;
