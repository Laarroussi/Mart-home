/**
 * Photographie d'identification du patient
 * ========================================
 *
 * L'image circule en base64 dans du JSON, et non par une adresse d'image
 * ordinaire. La raison tient en une ligne : une balise <img src="..."> ne sait
 * pas porter d'en-tête d'authentification. Servir la photo par une adresse
 * directe aurait supposé de glisser le jeton dans l'URL — où il finit dans les
 * journaux du serveur, dans l'historique du navigateur et dans le champ
 * « referer » de la requête suivante. Un visage de patient ne vaut pas ça.
 *
 * La page reconstruit donc une adresse « data: » à partir de la réponse JSON,
 * reçue avec le jeton dans les en-têtes, comme toutes les autres données.
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();
const soignants = requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR);

const FORMATS = ['image/jpeg', 'image/png', 'image/webp'];
const TAILLE_MAX = 2 * 1024 * 1024;

// ============================================================
// GET /api/photos/:patientId — lire la photo
// ------------------------------------------------------------
// 204 quand il n'y en a pas : c'est une absence, pas une erreur. Un 404
// ferait écrire un message d'échec pour un patient simplement sans photo.
// ============================================================
router.get('/:patientId', requireAuth, soignants, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT mime, donnees, ajoutee_le FROM patient_photos WHERE patient_id = $1',
      [req.params.patientId]
    );
    if (!rows.length) return res.status(204).end();
    res.json({
      mime: rows[0].mime,
      data: rows[0].donnees.toString('base64'),
      ajoutee_le: rows[0].ajoutee_le
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/photos/:patientId — verser ou remplacer
// ============================================================
router.post('/:patientId', requireAuth, soignants, async (req, res, next) => {
  try {
    const { data, mime, consentement } = req.body || {};
    if (!data || !mime) return res.status(400).json({ error: 'Image manquante.' });
    if (!FORMATS.includes(mime)) {
      return res.status(400).json({ error: 'Format non accepte : ' + mime + '. Attendu JPEG, PNG ou WebP.' });
    }
    // On exige l'attestation explicitement : verser le visage de quelqu'un
    // sans son accord n'est pas un oubli rattrapable après coup.
    if (consentement !== true) {
      return res.status(400).json({
        error: "Le consentement du patient doit etre atteste avant de verser sa photo."
      });
    }

    const p = await query('SELECT id FROM patients WHERE id = $1', [req.params.patientId]);
    if (!p.rows.length) return res.status(404).json({ error: 'Patient introuvable' });

    const binaire = Buffer.from(String(data).replace(/^data:[^,]+,/, ''), 'base64');
    if (!binaire.length) return res.status(400).json({ error: 'Image illisible.' });
    if (binaire.length > TAILLE_MAX) {
      return res.status(413).json({
        error: 'Image trop lourde (' + Math.round(binaire.length / 1024) + ' Ko). Maximum 2 Mo.'
      });
    }

    await query(
      `INSERT INTO patient_photos (patient_id, mime, donnees, octets, ajoutee_par, consentement)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       ON CONFLICT (patient_id) DO UPDATE
         SET mime = EXCLUDED.mime, donnees = EXCLUDED.donnees, octets = EXCLUDED.octets,
             ajoutee_par = EXCLUDED.ajoutee_par, ajoutee_le = NOW(), consentement = TRUE`,
      [req.params.patientId, mime, binaire, binaire.length, req.user.id]
    );
    res.status(201).json({ ok: true, octets: binaire.length });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /api/photos/:patientId — retirer la photo
// ------------------------------------------------------------
// Un patient qui retire son accord doit pouvoir être effacé de l'écran sans
// qu'on touche à son dossier médical. C'est tout l'intérêt d'une table à part.
// ============================================================
router.delete('/:patientId', requireAuth, soignants, async (req, res, next) => {
  try {
    await query('DELETE FROM patient_photos WHERE patient_id = $1', [req.params.patientId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
