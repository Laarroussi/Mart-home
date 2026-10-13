/**
 * Séances individuelles — une salle par entretien, un lien à transmettre
 * =====================================================================
 *
 * La séance de groupe se tient dans une salle unique, connue de toute la
 * plateforme. Un entretien individuel ne peut pas s'y tenir : ce serait un
 * entretien en public.
 *
 * Chaque séance individuelle reçoit donc sa propre salle, dérivée d'un jeton
 * tiré au hasard sur 32 octets. Deux barrières, et il faut les deux :
 *
 *   1. le nom de la salle n'est pas devinable — qui n'a pas le lien ne sait
 *      pas où aller ;
 *   2. le serveur ne délivre un jeton de visioconférence pour cette salle
 *      qu'au soignant et à l'invité — avoir le lien ne suffit pas.
 *
 * La seconde barrière est la vraie. Un lien se transfère, s'oublie dans un
 * historique, se retrouve dans une capture d'écran.
 */
const express = require('express');
const crypto = require('crypto');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();

// Durée de validité d'un lien. Assez long pour une séance qui démarre en
// retard, assez court pour qu'un lien oublié ne reste pas une porte ouverte.
const VALIDITE_H = 12;

/** Le nom de salle est dérivé du jeton : une seule valeur à transporter. */
function salleDepuisJeton(jeton) {
  return 'indiv-' + jeton.slice(0, 24);
}

/**
 * Lit une séance et dit si l'appelant a le droit d'y entrer.
 * Utilisé ici et par la route qui délivre les jetons de visioconférence.
 */
async function lireSeance(jeton) {
  const { rows } = await query(
    `SELECT s.*,
            si.name AS soignant_nom,
            ui.name AS invite_nom, ui.role AS invite_role, ui.patient_id AS invite_patient_id
       FROM seances_individuelles s
       JOIN users si ON si.id = s.soignant_id
       JOIN users ui ON ui.id = s.invite_id
      WHERE s.jeton = $1`,
    [jeton]
  );
  return rows[0] || null;
}

function estAutorise(seance, user) {
  if (!seance || !user) return false;
  return user.id === seance.soignant_id || user.id === seance.invite_id;
}

function estPerimee(seance) {
  if (!seance) return true;
  if (seance.statut === 'terminee') return true;
  return new Date(seance.expire_le).getTime() < Date.now();
}

// ============================================================
// POST /api/visio-individuelle — ouvrir une séance
// Réservé aux soignants. L'invité peut être un patient OU un investigateur.
// ============================================================
router.post('/', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR),
  async (req, res, next) => {
    try {
      const { invite_id, titre } = req.body || {};
      if (!invite_id) return res.status(400).json({ error: 'invite_id requis' });
      if (invite_id === req.user.id) {
        return res.status(400).json({ error: 'Vous ne pouvez pas vous inviter vous-meme.' });
      }

      const inv = await query('SELECT id, name, role, active FROM users WHERE id = $1', [invite_id]);
      if (!inv.rows.length) return res.status(404).json({ error: 'Personne introuvable' });
      if (inv.rows[0].active === false) {
        return res.status(400).json({ error: 'Ce compte est desactive : il ne pourra pas se connecter.' });
      }

      const jeton = crypto.randomBytes(32).toString('base64url');
      const salle = salleDepuisJeton(jeton);

      const { rows } = await query(
        `INSERT INTO seances_individuelles (jeton, salle, soignant_id, invite_id, titre, expire_le)
         VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::INTERVAL)
         RETURNING id, jeton, salle, titre, cree_le, expire_le, statut`,
        [jeton, salle, req.user.id, invite_id, titre || null, String(VALIDITE_H)]
      );

      res.status(201).json({
        seance: rows[0],
        invite: { id: inv.rows[0].id, nom: inv.rows[0].name, role: inv.rows[0].role },
        validite_h: VALIDITE_H
      });
    } catch (err) { next(err); }
  });

// ============================================================
// GET /api/visio-individuelle/:jeton — ouvrir le lien reçu
// ------------------------------------------------------------
// Répond 403 à qui n'est ni le soignant ni l'invité, et 410 si le lien a
// expiré ou si la séance est terminée. On distingue les deux : « vous n'avez
// pas accès » et « c'est fini » n'appellent pas la même réaction.
// ============================================================
router.get('/:jeton', requireAuth, async (req, res, next) => {
  try {
    const seance = await lireSeance(req.params.jeton);
    if (!seance) return res.status(404).json({ error: 'Seance introuvable' });
    if (!estAutorise(seance, req.user)) {
      return res.status(403).json({ error: "Cette seance ne vous est pas destinee." });
    }
    if (estPerimee(seance)) {
      return res.status(410).json({
        error: seance.statut === 'terminee'
          ? 'Cette seance est terminee.'
          : 'Ce lien a expire. Demandez-en un nouveau au soignant.'
      });
    }

    // Première entrée : on horodate l'ouverture.
    if (!seance.ouverte_le) {
      await query('UPDATE seances_individuelles SET ouverte_le = NOW() WHERE id = $1', [seance.id]);
    }

    res.json({
      seance: {
        id: seance.id, jeton: seance.jeton, salle: seance.salle,
        titre: seance.titre, expire_le: seance.expire_le, statut: seance.statut
      },
      soignant: { nom: seance.soignant_nom },
      // Le code d'étude, jamais le nom civil, quand l'invité est un patient.
      invite: {
        nom: seance.invite_role === ROLE.PATIENT
          ? (seance.invite_patient_id || 'Patient')
          : seance.invite_nom,
        role: seance.invite_role
      },
      vous_etes: req.user.id === seance.soignant_id ? 'soignant' : 'invite'
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/visio-individuelle/:jeton/terminer — fermer la salle
// Le soignant seul referme : l'invité qui quitte ne clôt pas l'entretien.
// ============================================================
router.post('/:jeton/terminer', requireAuth,
  requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
    try {
      const seance = await lireSeance(req.params.jeton);
      if (!seance) return res.status(404).json({ error: 'Seance introuvable' });
      if (seance.soignant_id !== req.user.id && req.user.role !== ROLE.PRINCIPAL_ADMIN) {
        return res.status(403).json({ error: "Seul le soignant qui a ouvert la seance peut la fermer." });
      }
      await query(
        `UPDATE seances_individuelles SET statut = 'terminee', close_le = NOW() WHERE id = $1`,
        [seance.id]
      );
      res.json({ ok: true });
    } catch (err) { next(err); }
  });

// ============================================================
// GET /api/visio-individuelle — mes séances récentes (soignant)
// ============================================================
router.get('/', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR),
  async (req, res, next) => {
    try {
      const { rows } = await query(
        `SELECT s.id, s.jeton, s.salle, s.titre, s.cree_le, s.expire_le, s.statut,
                u.name AS invite_nom, u.role AS invite_role, u.patient_id AS invite_patient_id
           FROM seances_individuelles s
           JOIN users u ON u.id = s.invite_id
          WHERE s.soignant_id = $1
          ORDER BY s.cree_le DESC
          LIMIT 30`,
        [req.user.id]
      );
      res.json({ seances: rows });
    } catch (err) { next(err); }
  });

module.exports = router;
module.exports.lireSeance = lireSeance;
module.exports.estAutorise = estAutorise;
module.exports.estPerimee = estPerimee;
