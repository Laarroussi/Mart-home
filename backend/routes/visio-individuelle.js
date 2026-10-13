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
    `SELECT s.*, si.name AS soignant_nom
       FROM seances_individuelles s
       JOIN users si ON si.id = s.soignant_id
      WHERE s.jeton = $1`,
    [jeton]
  );
  const seance = rows[0];
  if (!seance) return null;

  // Les invités vivent dans leur propre table depuis la migration 038 : une
  // séance peut en compter plusieurs. La colonne invite_id subsiste mais
  // n'est plus lue — elle sera retirée une fois la bascule constatée.
  const inv = await query(
    `SELECT u.id, u.name, u.role, u.patient_id
       FROM seances_individuelles_invites i
       JOIN users u ON u.id = i.user_id
      WHERE i.seance_id = $1
      ORDER BY i.ajoute_le`,
    [seance.id]
  );
  seance.invites = inv.rows;
  return seance;
}

function estAutorise(seance, user) {
  if (!seance || !user) return false;
  if (user.id === seance.soignant_id) return true;
  return (seance.invites || []).some(i => i.id === user.id);
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
      // `invites` est la forme courante ; `invite_id` reste accepté pour ne
      // pas casser un appel plus ancien. Le cas normal reste une personne.
      const { invites, invite_id, titre } = req.body || {};
      const demandes = Array.from(new Set(
        (Array.isArray(invites) ? invites : (invite_id ? [invite_id] : []))
          .map(x => String(x || '').trim()).filter(Boolean)
      ));

      if (!demandes.length) {
        return res.status(400).json({ error: 'Choisissez au moins une personne a inviter.' });
      }
      if (demandes.includes(req.user.id)) {
        return res.status(400).json({ error: 'Vous ne pouvez pas vous inviter vous-meme.' });
      }

      // On vérifie TOUTES les personnes avant de créer quoi que ce soit : une
      // séance à moitié peuplée serait pire qu'un refus net, le soignant
      // croirait avoir invité quelqu'un qui n'y est pas.
      const { rows: trouves } = await query(
        'SELECT id, name, role, active, patient_id FROM users WHERE id = ANY($1::varchar[])',
        [demandes]
      );
      if (trouves.length !== demandes.length) {
        const connus = trouves.map(u => u.id);
        return res.status(404).json({
          error: 'Personne introuvable : ' + demandes.filter(d => !connus.includes(d)).join(', ')
        });
      }
      const inactifs = trouves.filter(u => u.active === false);
      if (inactifs.length) {
        return res.status(400).json({
          error: 'Compte desactive, il ne pourra pas se connecter : ' +
                 inactifs.map(u => u.name || u.id).join(', ')
        });
      }

      const jeton = crypto.randomBytes(32).toString('base64url');
      const salle = salleDepuisJeton(jeton);

      const { rows } = await query(
        `INSERT INTO seances_individuelles (jeton, salle, soignant_id, titre, expire_le)
         VALUES ($1, $2, $3, $4, NOW() + ($5 || ' hours')::INTERVAL)
         RETURNING id, jeton, salle, titre, cree_le, expire_le, statut`,
        [jeton, salle, req.user.id, titre || null, String(VALIDITE_H)]
      );
      const seance = rows[0];

      for (const u of trouves) {
        await query(
          'INSERT INTO seances_individuelles_invites (seance_id, user_id) VALUES ($1, $2)',
          [seance.id, u.id]
        );
      }

      res.status(201).json({
        seance,
        invites: trouves.map(u => ({
          id: u.id, role: u.role,
          // Code d'étude pour un patient, nom professionnel pour un soignant.
          nom: u.role === ROLE.PATIENT ? (u.patient_id || 'Patient') : u.name
        })),
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
      invites: (seance.invites || []).map(u => ({
        id: u.id, role: u.role,
        nom: u.role === ROLE.PATIENT ? (u.patient_id || 'Patient') : u.name
      })),
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
                (SELECT count(*) FROM seances_individuelles_invites i WHERE i.seance_id = s.id)
                  AS nb_invites
           FROM seances_individuelles s
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
