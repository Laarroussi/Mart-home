/**
 * /api/timeline — Chronologie médicale extraite des documents
 * ===========================================================
 *   GET    /:patient_id            → tous les faits, du plus récent au plus ancien
 *   POST   /:patient_id/analyser   → { texte, doc_id? } : pseudonymise puis analyse par IA
 *                                     (ne stocke rien — renvoie une proposition à valider)
 *   POST   /:patient_id            → { faits: [...] } : enregistre les faits validés
 *   PATCH  /:patient_id/:id        → corrige un fait
 *   DELETE /:patient_id/:id        → supprime un fait
 *   GET    /statut/ia              → diagnostic de configuration IA (staff)
 *
 * Principe : l'IA PROPOSE, le soignant VALIDE. Rien n'entre en base sans
 * relecture humaine — indispensable pour des données d'étude clinique.
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');
const { analyserTexte, pseudonymiser, statutIA } = require('../config/ai');

const router = express.Router();

function peutEcrire(user) {
  return user.role === ROLE.INVESTIGATOR || user.role === ROLE.PRINCIPAL_ADMIN;
}
function peutLire(user, patientId) {
  if (user.role === ROLE.PATIENT) return user.patient_id === patientId;
  return true;
}

// ============================================================
// GET /statut/ia — déclaré AVANT /:patient_id (sinon capturé par lui)
// ============================================================
router.get('/statut/ia', requireAuth,
  requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), (req, res) => {
    res.json(statutIA());
  });

// ============================================================
// GET /:patient_id — chronologie complète
// ============================================================
router.get('/:patient_id', requireAuth, async (req, res, next) => {
  try {
    if (!peutLire(req.user, req.params.patient_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const { rows } = await query(
      `SELECT * FROM medical_timeline
        WHERE patient_id = $1 AND statut <> 'rejete'
        ORDER BY event_date DESC NULLS LAST, id DESC`,
      [req.params.patient_id]
    );
    res.json({ faits: rows });
  } catch (err) { next(err); }
});

// ============================================================
// POST /:patient_id/analyser — pseudonymise puis fait analyser par l'IA
// Body : { texte, doc_id? }
// Ne stocke AUCUN fait : renvoie une proposition à valider par le soignant.
// ============================================================
router.post('/:patient_id/analyser', requireAuth, async (req, res, next) => {
  const debut = Date.now();
  try {
    if (!peutEcrire(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const { texte, doc_id } = req.body || {};
    if (!texte || String(texte).trim().length < 20) {
      return res.status(400).json({ error: "Le document ne contient pas de texte exploitable. S'il s'agit d'un scan, l'extraction automatique n'est pas possible." });
    }

    // Récupère l'identité pour pouvoir la masquer
    const p = await query('SELECT civil FROM patients WHERE id = $1', [req.params.patient_id]);
    const patient = p.rows.length ? { civil: p.rows[0].civil || {} } : { civil: {} };

    const texteMasque = pseudonymiser(texte, patient);

    let resultat;
    try {
      resultat = await analyserTexte(texteMasque);
    } catch (e) {
      await query(
        `INSERT INTO ai_extraction_log (patient_id, doc_id, modele, nb_faits, pseudonymise, duree_ms, erreur, par)
         VALUES ($1,$2,$3,0,TRUE,$4,$5,$6)`,
        [req.params.patient_id, doc_id || null, process.env.OPENAI_MODEL || 'gpt-4o-mini',
         Date.now() - debut, e.message, req.user.id]
      ).catch(() => {});
      const code = e.code === 'NO_KEY' ? 503 : 502;
      return res.status(code).json({ error: e.message });
    }

    await query(
      `INSERT INTO ai_extraction_log (patient_id, doc_id, modele, nb_faits, pseudonymise, duree_ms, par)
       VALUES ($1,$2,$3,$4,TRUE,$5,$6)`,
      [req.params.patient_id, doc_id || null, resultat.modele,
       resultat.faits.length, resultat.duree_ms, req.user.id]
    ).catch(() => {});

    res.json({
      faits: resultat.faits,
      modele: resultat.modele,
      duree_ms: resultat.duree_ms,
      pseudonymise: true,
      apercu_masque: texteMasque.slice(0, 600)
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /:patient_id — enregistre les faits validés par le soignant
// Body : { faits: [ {...}, ... ], doc_id? }
// ============================================================
router.post('/:patient_id', requireAuth, async (req, res, next) => {
  try {
    if (!peutEcrire(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const { faits, doc_id } = req.body || {};
    if (!Array.isArray(faits) || !faits.length) {
      return res.status(400).json({ error: 'Aucun fait à enregistrer' });
    }
    const enregistres = [];
    for (const f of faits) {
      if (!f || !f.label) continue;
      const { rows } = await query(
        `INSERT INTO medical_timeline
           (patient_id, event_date, date_precision, category, label, value_num, value_text,
            unit, detail, source_doc_id, source_extrait, confiance, statut, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [req.params.patient_id,
         f.event_date || null,
         f.date_precision || 'inconnue',
         f.category || 'autre',
         f.label,
         f.value_num != null ? f.value_num : null,
         f.value_text || null,
         f.unit || null,
         f.detail || null,
         doc_id || f.source_doc_id || null,
         f.source_extrait || null,
         f.confiance != null ? f.confiance : null,
         f.statut === 'a_verifier' ? 'a_verifier' : 'valide',
         req.user.id]
      );
      enregistres.push(rows[0]);
    }
    res.status(201).json({ enregistres: enregistres.length, faits: enregistres });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /:patient_id/:id — correction manuelle d'un fait
// ============================================================
router.patch('/:patient_id/:id', requireAuth, async (req, res, next) => {
  try {
    if (!peutEcrire(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const permis = ['event_date','date_precision','category','label','value_num',
                    'value_text','unit','detail','statut'];
    const sets = [], params = [];
    permis.forEach(k => {
      if (req.body[k] !== undefined) { params.push(req.body[k]); sets.push(`${k} = $${params.length}`); }
    });
    if (!sets.length) return res.status(400).json({ error: 'Rien à modifier' });
    params.push(req.params.id, req.params.patient_id);
    const { rows } = await query(
      `UPDATE medical_timeline SET ${sets.join(', ')}
        WHERE id = $${params.length - 1} AND patient_id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Fait introuvable' });
    res.json({ fait: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// DELETE /:patient_id/:id
// ============================================================
router.delete('/:patient_id/:id', requireAuth, async (req, res, next) => {
  try {
    if (!peutEcrire(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const r = await query('DELETE FROM medical_timeline WHERE id=$1 AND patient_id=$2',
      [req.params.id, req.params.patient_id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Introuvable' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
