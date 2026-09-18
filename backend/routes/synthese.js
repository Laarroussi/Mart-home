/**
 * /api/synthese — Synthèse clinique du patient
 * =============================================
 *   GET  /:patient_id           → la synthèse enregistrée
 *   POST /:patient_id           → enregistre les rubriques (saisie humaine)
 *   POST /:patient_id/generer   → rassemble le dossier et fait rédiger l'IA
 *   GET  /:patient_id/donnees   → ce que verrait l'IA (contrôle avant génération)
 *
 * Principe de responsabilité : l'IA propose, le clinicien dispose. La
 * génération ne remplace jamais directement le texte affiché — elle renvoie
 * une proposition que l'investigateur relit, corrige, puis enregistre.
 * Chaque génération est archivée dans syntheses_versions, de sorte qu'on
 * puisse toujours distinguer ce qu'a écrit le modèle de ce qu'a validé
 * l'humain.
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');
const ia = require('../config/ai');

const router = express.Router();
const staff = requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR);

/** Le patient n'accède qu'à son propre dossier */
function verifierAcces(req, patientId) {
  if (req.user.role === ROLE.PATIENT && req.user.patient_id !== patientId) {
    const e = new Error('Accès refusé à ce dossier.');
    e.status = 403;
    throw e;
  }
}

// ============================================================
// GET /:patient_id — synthèse enregistrée
// ============================================================
router.get('/:patient_id', requireAuth, async (req, res, next) => {
  try {
    verifierAcces(req, req.params.patient_id);
    const r = await query(
      `SELECT patient_id, entree, objectifs, suivi_activite, bilan_entretien,
              generee_le, maj_le, maj_par
         FROM syntheses WHERE patient_id = $1`,
      [req.params.patient_id]
    );
    res.json(r.rows[0] || {
      patient_id: req.params.patient_id,
      entree: '', objectifs: '', suivi_activite: '', bilan_entretien: ''
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /:patient_id — enregistrement (texte validé par le clinicien)
// ============================================================
router.post('/:patient_id', requireAuth, staff, async (req, res, next) => {
  try {
    const { entree, objectifs, suivi_activite, bilan_entretien } = req.body || {};
    const r = await query(
      `INSERT INTO syntheses (patient_id, entree, objectifs, suivi_activite, bilan_entretien, maj_le, maj_par)
            VALUES ($1, $2, $3, $4, $5, NOW(), $6)
       ON CONFLICT (patient_id) DO UPDATE
          SET entree          = EXCLUDED.entree,
              objectifs       = EXCLUDED.objectifs,
              suivi_activite  = EXCLUDED.suivi_activite,
              bilan_entretien = EXCLUDED.bilan_entretien,
              maj_le          = NOW(),
              maj_par         = EXCLUDED.maj_par
      RETURNING *`,
      [req.params.patient_id, entree || '', objectifs || '', suivi_activite || '',
       bilan_entretien || '', req.user.id]
    );
    await query(
      `INSERT INTO syntheses_versions (patient_id, entree, objectifs, suivi_activite, origine, cree_par)
       VALUES ($1, $2, $3, $4, 'manuel', $5)`,
      [req.params.patient_id, entree || '', objectifs || '', suivi_activite || '', req.user.id]
    ).catch(() => {});
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// ============================================================
// Assemblage du dossier transmis à l'IA
// ------------------------------------------------------------
// On ne transmet que ce qui sert la synthèse. Chaque bloc absent est
// simplement omis : la consigne interdit au modèle de commenter les
// manques, encore faut-il ne pas les lui signaler.
// ============================================================
async function assemblerDossier(patientId) {
  const d = { patient_id: patientId };

  // --- Identité, pathologie, profession -------------------------------
  const p = await query(
    `SELECT id, sex, age, gene, aorta, status, civil, medical, study
       FROM patients WHERE id = $1`, [patientId]);
  if (p.rows.length) {
    const pat = p.rows[0];
    const civil = pat.civil || {};
    const med = pat.medical || {};
    d.identite = {
      code_etude: pat.id,
      nom: civil.lastName || civil.nom || null,
      prenom: civil.firstName || civil.prenom || null,
      sexe: pat.sex || null,
      age: pat.age || null,
      profession: civil.profession || civil.metier || null,
      pathologie: med.pathologie || 'Syndrome de Marfan',
      gene: pat.gene || med.gene || null,
      mutation: med.mutation || null
    };
    // On retire les clés vides : rien ne doit ressembler à un trou à combler.
    Object.keys(d.identite).forEach(k => { if (d.identite[k] == null) delete d.identite[k]; });
  }

  // --- Suivi aortique : diagnostic initial + valeur courante ----------
  const mr = await query(
    `SELECT aortic_followup, antecedents, history, patient_goals, clinician_goals
       FROM medical_records WHERE patient_id = $1`, [patientId]);
  if (mr.rows.length) {
    const m = mr.rows[0];
    if (m.aortic_followup && Object.keys(m.aortic_followup).length) d.aorte = m.aortic_followup;
    if (m.antecedents && Object.keys(m.antecedents).length) d.antecedents = m.antecedents;
    if (m.history && Object.keys(m.history).length) d.histoire = m.history;
    if (m.patient_goals && Object.keys(m.patient_goals).length) d.objectifs_patient = m.patient_goals;
    if (m.clinician_goals && Object.keys(m.clinician_goals).length) d.objectifs_clinicien = m.clinician_goals;
  }

  // --- Consultations : c'est là que se lit l'évolution du diamètre -----
  const cons = await query(
    `SELECT consultation_date, aortic_value_mm, aortic_site, aortic_method,
            evolution, evolution_detail, apa_adaptation, comment
       FROM consultations
      WHERE patient_id = $1 AND aortic_value_mm IS NOT NULL
      ORDER BY consultation_date ASC`, [patientId]);
  if (cons.rows.length) {
    d.mesures_aortiques = cons.rows.map(c => ({
      date: c.consultation_date,
      valeur_mm: c.aortic_value_mm != null ? Number(c.aortic_value_mm) : null,
      site: c.aortic_site, methode: c.aortic_method,
      evolution: c.evolution, detail: c.evolution_detail
    }));
    // Comparaison explicite : le modèle calcule mal, on lui mâche le travail.
    const n = d.mesures_aortiques.length;
    if (n >= 2) {
      const a = d.mesures_aortiques[n - 2], b = d.mesures_aortiques[n - 1];
      if (a.valeur_mm != null && b.valeur_mm != null) {
        const jours = Math.round((new Date(b.date) - new Date(a.date)) / 86400000);
        d.evolution_derniere = {
          avant_derniere: { date: a.date, valeur_mm: a.valeur_mm },
          derniere:       { date: b.date, valeur_mm: b.valeur_mm },
          variation_mm:   Math.round((b.valeur_mm - a.valeur_mm) * 100) / 100,
          intervalle_jours: jours
        };
      }
    }
  }

  // --- Interventions chirurgicales, extraites des documents ------------
  const ops = await query(
    `SELECT event_date, label, detail
       FROM medical_timeline
      WHERE patient_id = $1 AND category = 'operation' AND statut <> 'rejete'
      ORDER BY event_date ASC NULLS LAST`, [patientId]).catch(() => ({ rows: [] }));
  if (ops.rows.length) {
    d.operations = ops.rows.map(o => ({ date: o.event_date, intitule: o.label, detail: o.detail }));
  }

  // --- Échocardiographies : sites aortiques mesurés --------------------
  const echo = await query(
    `SELECT exam_date, sinus_valsalva_mm, aorte_ascendante_mm, aorte_max_mm, aorte_site_max, fevg_bp_pct
       FROM echo_reports WHERE patient_id = $1
      ORDER BY exam_date DESC NULLS LAST LIMIT 3`, [patientId]).catch(() => ({ rows: [] }));
  if (echo.rows.length) d.echocardiographies = echo.rows;

  // --- Activité physique réalisée : moyennes, jamais le détail ---------
  const s = await query(
    `SELECT COUNT(*)::int                                   AS nb_seances,
            ROUND(AVG(duration_s) / 60.0)::int              AS duree_moyenne_min,
            ROUND(SUM(duration_s) / 60.0)::int              AS duree_totale_min,
            ROUND(AVG(hr_avg))::int                         AS fc_moyenne,
            MAX(hr_max)                                     AS fc_max_observee,
            ROUND(AVG(borg_cr10)::numeric, 1)               AS cr10_moyen,
            MIN(started_at)::date                           AS premiere_seance,
            MAX(started_at)::date                           AS derniere_seance
       FROM training_sessions
      WHERE patient_id = $1 AND status = 'completed'`, [patientId]);
  if (s.rows.length && s.rows[0].nb_seances > 0) {
    d.activite_physique = s.rows[0];
    Object.keys(d.activite_physique).forEach(k => {
      if (d.activite_physique[k] == null) delete d.activite_physique[k];
    });
  }

  // --- Seuils ventilatoires, pour situer les intensités ----------------
  const ev = await query(
    `SELECT eval_date, vo2, sv1, sv2, fc_max, thresholds
       FROM evaluations WHERE patient_id = $1
      ORDER BY eval_date DESC NULLS LAST LIMIT 1`, [patientId]).catch(() => ({ rows: [] }));
  if (ev.rows.length) {
    const e = ev.rows[0];
    const t = e.thresholds || {};
    const seuils = {};
    if (e.eval_date) seuils.date_epreuve = e.eval_date;
    if (t.sv1Fc) seuils.sv1_fc = t.sv1Fc;
    if (t.sv2Fc) seuils.sv2_fc = t.sv2Fc;
    if (t.fcPeak || e.fc_max) seuils.fc_pic = t.fcPeak || e.fc_max;
    if (e.vo2 != null) seuils.vo2_pic = Number(e.vo2);
    if (e.sv1 != null) seuils.sv1_vo2 = Number(e.sv1);
    if (e.sv2 != null) seuils.sv2_vo2 = Number(e.sv2);
    // Une seule date ne constitue pas un seuil : on n'envoie le bloc que s'il
    // contient au moins une mesure exploitable.
    if (Object.keys(seuils).filter(k => k !== 'date_epreuve').length) {
      d.seuils_ventilatoires = seuils;
    }
  }

  // --- Éducation thérapeutique suivie ----------------------------------
  const edu = await query(
    `SELECT c.title, r.post_status, r.post_score, r.validated
       FROM education_records r
       JOIN education_capsules c ON c.id = r.capsule_id
      WHERE r.patient_id = $1 AND (r.validated = TRUE OR r.post_status = 'completed')`,
    [patientId]).catch(() => ({ rows: [] }));
  if (edu.rows.length) {
    d.education_therapeutique = edu.rows.map(e => ({
      module: e.title, score: e.post_score, valide: e.validated
    }));
  }

  // --- Notes d'entretien de l'investigateur ----------------------------
  const sy = await query(
    `SELECT bilan_entretien FROM syntheses WHERE patient_id = $1`, [patientId]);
  if (sy.rows.length && sy.rows[0].bilan_entretien) {
    d.bilan_entretien = sy.rows[0].bilan_entretien;
  }

  return d;
}

// ============================================================
// GET /:patient_id/donnees — ce que verra l'IA
// ============================================================
router.get('/:patient_id/donnees', requireAuth, staff, async (req, res, next) => {
  try {
    res.json(await assemblerDossier(req.params.patient_id));
  } catch (err) { next(err); }
});

// ============================================================
// POST /:patient_id/generer — rédaction par l'IA
// ============================================================
router.post('/:patient_id/generer', requireAuth, staff, async (req, res, next) => {
  try {
    if (!ia.cleActive()) {
      return res.status(503).json({
        error: "L'analyse par IA n'est pas configurée sur le serveur (MISTRAL_API_KEY absente)."
      });
    }
    const patientId = req.params.patient_id;

    // Le bilan d'entretien saisi à l'instant est pris en compte immédiatement,
    // sans exiger un enregistrement préalable.
    if (req.body && typeof req.body.bilan_entretien === 'string') {
      await query(
        `INSERT INTO syntheses (patient_id, bilan_entretien, maj_le, maj_par)
              VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (patient_id) DO UPDATE
            SET bilan_entretien = EXCLUDED.bilan_entretien, maj_le = NOW()`,
        [patientId, req.body.bilan_entretien, req.user.id]
      );
    }

    const dossier = await assemblerDossier(patientId);
    const out = await ia.genererSynthese(dossier);

    await query(
      `INSERT INTO syntheses_versions (patient_id, entree, objectifs, suivi_activite, origine, modele, cree_par)
       VALUES ($1, $2, $3, $4, 'ia', $5, $6)`,
      [patientId, out.entree, out.objectifs, out.suivi_activite, out.modele, req.user.id]
    ).catch(() => {});

    await query(
      `UPDATE syntheses SET generee_le = NOW() WHERE patient_id = $1`, [patientId]
    ).catch(() => {});

    res.json({
      entree: out.entree,
      objectifs: out.objectifs,
      suivi_activite: out.suivi_activite,
      modele: out.modele,
      duree_ms: out.duree_ms,
      // Transmis pour que l'interface puisse dire au clinicien sur quoi la
      // rédaction s'appuie — et donc ce qui manque au dossier.
      blocs_disponibles: Object.keys(dossier).filter(k => k !== 'patient_id')
    });
  } catch (err) { next(err); }
});

module.exports = router;
