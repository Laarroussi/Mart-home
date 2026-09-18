/**
 * /api/entretien — Entretiens patients enregistrés et transcrits
 * ===============================================================
 *   POST /transcrire            → audio → texte → champs extraits (sans patient)
 *   POST /:patient_id/transcrire → idem, et archive l'entretien
 *   GET  /:patient_id            → les entretiens du patient
 *   POST /:patient_id            → enregistre un entretien relu et validé
 *
 * Deux principes gouvernent ce fichier.
 *
 * L'AUDIO N'EST JAMAIS STOCKÉ. Il transite, il est transcrit, il est oublié.
 * La voix est une donnée biométrique ; la conserver imposerait des
 * obligations lourdes pour un bénéfice nul, seul le texte servant ensuite.
 *
 * LA TRANSCRIPTION, ELLE, EST CONSERVÉE. C'est la source vérifiable de ce
 * que l'IA a porté au dossier. Sans elle, impossible de contrôler ce qu'elle
 * a retenu, omis ou déformé — et un dossier clinique doit rester auditable.
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');
const ia = require('../config/ai');

const router = express.Router();
const staff = requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR);

/** Transcrit puis analyse. Renvoie la transcription ET les champs extraits. */
async function traiter(audioBase64, mime, nom) {
  if (!ia.cleActive()) {
    const e = new Error("La transcription n'est pas configurée sur le serveur (MISTRAL_API_KEY absente).");
    e.status = 503;
    throw e;
  }
  const t = await ia.transcrireAudio(audioBase64, mime, nom);
  const a = await ia.analyserEntretien(t.texte);
  return {
    transcription: t.texte,
    champs: a.champs,
    duree_audio_s: t.secondes_audio || null,
    modele_transcription: t.modele,
    modele_analyse: a.modele,
    duree_ms: (t.duree_ms || 0) + (a.duree_ms || 0)
  };
}

// ============================================================
// POST /transcrire — pendant la création, quand la fiche n'existe pas encore
// Déclarée AVANT /:patient_id, sinon capturée par lui.
// ============================================================
router.post('/transcrire', requireAuth, staff, async (req, res, next) => {
  try {
    const { audio_base64, mime, nom } = req.body || {};
    if (!audio_base64) return res.status(400).json({ error: 'Aucun enregistrement reçu.' });
    res.json(await traiter(audio_base64, mime, nom));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// POST /:patient_id/transcrire — transcrit ET archive
// ============================================================
router.post('/:patient_id/transcrire', requireAuth, staff, async (req, res, next) => {
  try {
    const { audio_base64, mime, nom, duree_s, source } = req.body || {};
    if (!audio_base64) return res.status(400).json({ error: 'Aucun enregistrement reçu.' });

    const out = await traiter(audio_base64, mime, nom);

    const enr = await query(
      `INSERT INTO entretiens (patient_id, duree_s, source, transcription, champs, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, date_entretien, cree_le`,
      [req.params.patient_id, duree_s || null, source || 'enregistrement',
       out.transcription, JSON.stringify(out.champs), req.user.id]
    ).catch(e => { console.warn('[entretien] archivage échoué :', e.message); return { rows: [{}] }; });

    res.json(Object.assign({ id: enr.rows[0] && enr.rows[0].id }, out));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

// ============================================================
// GET /:patient_id — historique des entretiens
// ============================================================
router.get('/:patient_id', requireAuth, staff, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, date_entretien, duree_s, source, transcription, champs, valide, cree_le, cree_par
         FROM entretiens WHERE patient_id = $1
        ORDER BY date_entretien DESC, id DESC LIMIT 30`,
      [req.params.patient_id]
    );
    res.json({ entretiens: rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /:patient_id — enregistre un entretien relu (ou saisi à la main)
// ============================================================
router.post('/:patient_id', requireAuth, staff, async (req, res, next) => {
  try {
    const { transcription, champs, duree_s, source, valide } = req.body || {};
    const { rows } = await query(
      `INSERT INTO entretiens (patient_id, duree_s, source, transcription, champs, valide, cree_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.patient_id, duree_s || null, source || 'saisie',
       transcription || '', JSON.stringify(champs || {}), valide !== false, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
