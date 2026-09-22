/**
 * /api/audit — Consultation du journal des modifications
 * =======================================================
 *   GET /motifs             → liste des motifs normalisés
 *   GET /:patient_id        → historique des modifications d'un dossier
 *   GET /valeur/:table/:id/:champ → histoire d'une valeur précise
 *
 * Journal en LECTURE SEULE. Aucune route n'écrit ici : les écritures passent
 * par l'utilitaire d'audit, appelé depuis les routes qui modifient une
 * donnée. Un journal auquel on peut écrire directement ne prouve rien.
 *
 * Réservé au personnel soignant. Un patient n'a pas à voir l'historique des
 * corrections apportées à son dossier : il y verrait des valeurs erronées
 * retirées précisément parce qu'elles étaient fausses.
 */
const express = require('express');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');
const { MOTIFS, historique } = require('../utils/audit');

const router = express.Router();
const staff = requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR);

/** Déclarée avant /:patient_id, sinon « motifs » passerait pour un code patient */
router.get('/motifs', requireAuth, staff, (req, res) => {
  res.json({ motifs: MOTIFS });
});

/** Histoire d'une valeur précise : « qu'est devenue cette mesure ? » */
router.get('/valeur/:table/:id/:champ', requireAuth, staff, async (req, res, next) => {
  try {
    res.json({
      historique: await historique({
        table: req.params.table, id: req.params.id, champ: req.params.champ, limite: 100
      })
    });
  } catch (err) { next(err); }
});

/** Toutes les modifications d'un dossier, de la plus récente à la plus ancienne */
router.get('/:patient_id', requireAuth, staff, async (req, res, next) => {
  try {
    res.json({
      historique: await historique({ patientId: req.params.patient_id, limite: req.query.limite })
    });
  } catch (err) { next(err); }
});

module.exports = router;
