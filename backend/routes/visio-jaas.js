/**
 * /api/visio-jaas — Jetons d'accès à la visioconférence (Jitsi as a Service)
 * ==========================================================================
 *   GET /token          → jeton signé pour l'utilisateur connecté
 *   GET /config         → App ID et état de la configuration (staff)
 *
 * Principe : le navigateur ne peut pas entrer dans une salle sans un jeton
 * signé par le serveur. Trois conséquences utiles :
 *
 *   1. Seules les personnes connectées à la plateforme accèdent aux séances.
 *      Connaître l'adresse de la salle ne suffit plus.
 *   2. Le soignant est déclaré modérateur, le patient non. C'est le serveur
 *      qui le décide, pas le navigateur — donc impossible à contourner.
 *   3. Chaque participant porte un identifiant stable (nom du soignant,
 *      code MRF du patient), ce qui rend le comptage des utilisateurs
 *      mensuels fiable et évite de payer plusieurs fois la même personne.
 *
 * Confidentialité : les patients se voient entre eux en séance de groupe.
 * On ne transmet donc QUE le code patient, jamais le nom civil.
 *
 * La clé privée reste sur le serveur et n'est jamais exposée au navigateur.
 */
const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { requireAuth, ROLE } = require('../middleware/auth');

const router = express.Router();

const APP_ID = process.env.JAAS_APP_ID || '';
const KID = process.env.JAAS_KID || '';
const CHEMIN_CLE = process.env.JAAS_PRIVATE_KEY_PATH || './jaas-private-key.pk';
const DUREE_H = parseInt(process.env.JAAS_TOKEN_TTL_HOURS, 10) || 4;

let _cle = null;
let _erreurCle = null;

/** Lit la clé privée une seule fois, puis la garde en mémoire */
function clePrivee() {
  if (_cle) return _cle;
  if (_erreurCle) throw new Error(_erreurCle);
  try {
    _cle = fs.readFileSync(CHEMIN_CLE, 'utf8');
    if (!/BEGIN [A-Z ]*PRIVATE KEY/.test(_cle)) {
      _cle = null;
      _erreurCle = "Le fichier de clé JaaS ne contient pas une clé privée valide (" + CHEMIN_CLE + ")";
      throw new Error(_erreurCle);
    }
    return _cle;
  } catch (e) {
    _erreurCle = _erreurCle || ("Clé privée JaaS illisible : " + e.message);
    throw new Error(_erreurCle);
  }
}

function configure() {
  return !!(APP_ID && KID);
}

// ============================================================
// GET /config — diagnostic, sans jamais exposer la clé
// ============================================================
router.get('/config', requireAuth, (req, res) => {
  let cleOk = false, cleErr = null;
  try { clePrivee(); cleOk = true; } catch (e) { cleErr = e.message; }
  res.json({
    app_id: APP_ID || null,
    kid_configure: !!KID,
    cle_privee_ok: cleOk,
    cle_privee_erreur: cleErr,
    pret: configure() && cleOk,
    duree_jeton_h: DUREE_H
  });
});

// ============================================================
// GET /token — jeton d'accès pour l'utilisateur connecté
// ============================================================
router.get('/token', requireAuth, (req, res, next) => {
  try {
    if (!configure()) {
      return res.status(503).json({
        error: "Visioconférence non configurée sur le serveur (JAAS_APP_ID ou JAAS_KID absent)."
      });
    }
    let cle;
    try { cle = clePrivee(); }
    catch (e) { return res.status(503).json({ error: e.message }); }

    const estPatient = req.user.role === ROLE.PATIENT;
    const moderateur = !estPatient;

    // Identité affichée aux autres participants :
    //  - soignant : son nom, pour que les patients sachent qui les accompagne
    //  - patient  : son code d'étude uniquement, jamais son nom civil
    const identifiant = estPatient
      ? (req.user.patient_id || req.user.id)
      : req.user.id;
    const nomAffiche = estPatient
      ? (req.user.patient_id || 'Patient')
      : (req.user.name || 'Soignant');

    const maintenant = Math.floor(Date.now() / 1000);
    const charge = {
      aud: 'jitsi',
      iss: 'chat',
      sub: APP_ID,
      room: '*',                       // toutes les salles de cette application
      exp: maintenant + DUREE_H * 3600,
      nbf: maintenant - 10,
      iat: maintenant,
      context: {
        user: {
          id: identifiant,
          name: nomAffiche,
          moderator: moderateur ? 'true' : 'false',
          'hidden-from-recorder': 'false'
        },
        features: {
          livestreaming: 'false',
          recording: moderateur ? 'true' : 'false',
          transcription: 'false',
          'outbound-call': 'false'
        }
      }
    };

    const jeton = jwt.sign(charge, cle, {
      algorithm: 'RS256',
      header: { kid: KID, typ: 'JWT' }
    });

    res.json({
      token: jeton,
      app_id: APP_ID,
      moderateur,
      nom_affiche: nomAffiche,
      expire_dans_s: DUREE_H * 3600
    });
  } catch (err) { next(err); }
});

module.exports = router;
