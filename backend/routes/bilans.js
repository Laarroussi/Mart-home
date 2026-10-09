/**
 * /api/bilans — Bilans datés du parcours en APA
 * =============================================
 *   GET  /:patient_id                → la liste chronologique des bilans
 *   GET  /:patient_id/donnees        → l'agrégat de la période à venir
 *   POST /:patient_id                → crée un bilan (rédigé par l'IA ou vide)
 *   PUT  /:id                        → enregistre les rubriques relues
 *   POST /:id/valider                → l'investigateur assume le bilan
 *   DELETE /:id                      → supprime un bilan non validé
 *
 * Le principe reste celui de la synthèse d'entrée : l'IA propose, le
 * clinicien dispose. Une différence toutefois — ici les chiffres ne viennent
 * pas du modèle. Le nombre de séances, les durées, les intensités et les
 * écarts entre évaluations sont calculés en SQL, transmis déjà faits, et
 * figés dans la colonne `donnees` au moment de la création. Un bilan validé
 * doit rester vérifiable même si les séances sont corrigées par la suite.
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');
const ia = require('../config/ai');

const router = express.Router();
const staff = requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR);

const TYPES = ['entree', 'intermediaire', 'sortie'];

function verifierAcces(req, patientId) {
  if (req.user.role === ROLE.PATIENT && req.user.patient_id !== patientId) {
    const e = new Error('Accès refusé à ce dossier.');
    e.status = 403;
    throw e;
  }
}

const nb = (v) => (v === null || v === undefined ? null : Number(v));

// ============================================================
// Agrégat d'une période
// ------------------------------------------------------------
// Tout ce que l'IA devra dire des séances, de l'éducation et des évaluations
// est calculé ici. C'est volontaire : un modèle de langage additionne mal, et
// un nombre de séances faux dans un bilan clinique n'est pas une coquille.
// ============================================================
async function agregerPeriode(patientId, debut, fin) {
  const d = {
    periode: { debut: debut || null, fin: fin },
    patient_id: patientId
  };

  // La borne basse peut être absente pour un premier bilan : on prend alors
  // tout l'historique, ce qui est exactement ce qu'on veut raconter.
  const bornes = [patientId, fin];
  const filtreDebut = debut ? ' AND started_at::date >= $3' : '';
  if (debut) bornes.push(debut);

  // --- Séances réalisées -----------------------------------------------
  const s = await query(
    `SELECT COUNT(*)::int                                 AS nb_seances,
            ROUND(AVG(duration_s) / 60.0)::int            AS duree_moyenne_min,
            ROUND(SUM(duration_s) / 60.0)::int            AS duree_totale_min,
            ROUND(AVG(hr_avg))::int                       AS fc_moyenne,
            MAX(hr_max)                                   AS fc_max_observee,
            MIN(hr_min)                                   AS fc_min_observee,
            ROUND(AVG(borg_cr10)::numeric, 1)             AS cr10_moyen,
            MIN(started_at)::date                         AS premiere_seance,
            MAX(started_at)::date                         AS derniere_seance
       FROM training_sessions
      WHERE patient_id = $1 AND status = 'completed'
        AND started_at::date <= $2` + filtreDebut, bornes);

  if (s.rows.length && s.rows[0].nb_seances > 0) {
    d.seances = s.rows[0];
    Object.keys(d.seances).forEach(k => { if (d.seances[k] == null) delete d.seances[k]; });

    // Régularité : une moyenne de séances par semaine se comprend mieux
    // qu'un total brut, parce qu'elle se compare d'une période à l'autre.
    const p = d.seances.premiere_seance, q = d.seances.derniere_seance;
    if (p && q) {
      const sem = Math.max(1, Math.round((new Date(q) - new Date(p)) / 604800000));
      d.seances.semaines_couvertes = sem;
      d.seances.seances_par_semaine = Math.round((d.seances.nb_seances / sem) * 10) / 10;
    }
  }

  const inter = await query(
    `SELECT COUNT(*)::int AS nb FROM training_sessions
      WHERE patient_id = $1 AND status = 'interrupted'
        AND started_at::date <= $2` + filtreDebut, bornes);
  if (inter.rows.length && inter.rows[0].nb > 0) d.seances_interrompues = inter.rows[0].nb;

  // --- Éducation thérapeutique suivie pendant la période ---------------
  const edu = await query(
    `SELECT c.title AS module, r.post_score AS score, r.validated AS valide,
            r.pre_score AS score_avant
       FROM education_records r
       JOIN education_capsules c ON c.id = r.capsule_id
      WHERE r.patient_id = $1
        AND (r.validated = TRUE OR r.post_status = 'completed')`,
    [patientId]).catch(() => ({ rows: [] }));
  if (edu.rows.length) d.education_therapeutique = edu.rows;

  // --- Évaluations : la dernière de la période, comparée à la précédente
  const ev = await query(
    `SELECT eval_date, label, vo2, sv1, sv2, watts, fc_max, force_kg,
            sf36, gpaq, ve_vco2_slope, thresholds
       FROM evaluations
      WHERE patient_id = $1 AND eval_date <= $2
      ORDER BY eval_date ASC`, [patientId, fin]).catch(() => ({ rows: [] }));

  if (ev.rows.length) {
    const simplifier = (e) => {
      const t = e.thresholds || {};
      const o = {
        date: e.eval_date, intitule: e.label,
        vo2_pic_ml_kg_min: nb(e.vo2), sv1_fc: t.sv1Fc || null, sv2_fc: t.sv2Fc || null,
        fc_pic: t.fcPeak || e.fc_max || null, watts_pic: e.watts,
        force_kg: nb(e.force_kg), sf36: nb(e.sf36), gpaq: e.gpaq,
        ve_vco2_pente: nb(e.ve_vco2_slope), oues_ml_min: t.oues || null
      };
      Object.keys(o).forEach(k => { if (o[k] == null) delete o[k]; });
      return o;
    };

    const toutes = ev.rows.map(simplifier);
    const derniere = toutes[toutes.length - 1];
    d.derniere_evaluation = derniere;

    // Écart avec l'évaluation précédente, puis avec la toute première : le
    // premier chiffre mesure la période, le second mesure le parcours. Un
    // écart sans sa durée ne veut rien dire, on la joint toujours.
    const ecart = (a, b) => {
      if (!a || !b) return null;
      const jours = Math.round((new Date(b.date) - new Date(a.date)) / 86400000);
      const r = { de: a.date, a: b.date, jours, mois: Math.round(jours / 30.4) };
      ['vo2_pic_ml_kg_min', 'watts_pic', 'force_kg', 'sf36', 'gpaq',
       'sv1_fc', 'sv2_fc', 'fc_pic', 've_vco2_pente', 'oues_ml_min'].forEach(k => {
        if (a[k] != null && b[k] != null) {
          r[k] = Math.round((b[k] - a[k]) * 100) / 100;
        }
      });
      return Object.keys(r).length > 4 ? r : null;
    };

    if (toutes.length >= 2) {
      const e1 = ecart(toutes[toutes.length - 2], derniere);
      if (e1) d.ecart_depuis_evaluation_precedente = e1;
      const e2 = ecart(toutes[0], derniere);
      if (e2 && toutes.length > 2) d.ecart_depuis_premiere_evaluation = e2;
    }
    // Une évaluation refaite PENDANT la période est l'événement qui justifie
    // d'en parler ; sinon on se contente de rappeler l'état connu.
    if (debut && derniere.date && String(derniere.date) >= String(debut)) {
      d.evaluation_refaite_pendant_la_periode = true;
    }
  }

  // --- Événements médicaux de la période --------------------------------
  const cons = await query(
    `SELECT consultation_date, aortic_value_mm, aortic_site, evolution, comment
       FROM consultations
      WHERE patient_id = $1 AND consultation_date <= $2` +
      (debut ? ' AND consultation_date >= $3' : '') +
    ` ORDER BY consultation_date ASC`, bornes).catch(() => ({ rows: [] }));
  if (cons.rows.length) {
    d.consultations_periode = cons.rows.map(c => ({
      date: c.consultation_date,
      diametre_mm: nb(c.aortic_value_mm), site: c.aortic_site,
      evolution: c.evolution, commentaire: c.comment
    }));
  }

  const faits = await query(
    `SELECT event_date, category, label, detail
       FROM medical_timeline
      WHERE patient_id = $1 AND statut <> 'rejete' AND event_date <= $2` +
      (debut ? ' AND event_date >= $3' : '') +
    ` ORDER BY event_date ASC LIMIT 40`, bornes).catch(() => ({ rows: [] }));
  if (faits.rows.length) {
    d.evenements_periode = faits.rows.map(f => ({
      date: f.event_date, categorie: f.category, libelle: f.label, detail: f.detail
    }));
  }

  return d;
}

// ============================================================
// GET /:patient_id — la liste des bilans, du plus ancien au plus récent
// ============================================================
router.get('/:patient_id', requireAuth, async (req, res, next) => {
  try {
    verifierAcces(req, req.params.patient_id);
    const r = await query(
      `SELECT id, patient_id, type, titre, date_bilan, periode_debut, periode_fin,
              contexte, activite, objectifs, bilan_entretien, donnees,
              generee_le, modele, validee, validee_le, validee_par_nom,
              cree_le, maj_le, maj_par
         FROM bilans WHERE patient_id = $1
        ORDER BY date_bilan ASC, id ASC`, [req.params.patient_id]);
    res.json({ bilans: r.rows });
  } catch (e) { next(e); }
});

// ============================================================
// GET /:patient_id/donnees — ce que verra l'IA, avant de lancer la rédaction
// ------------------------------------------------------------
// Pouvoir regarder l'agrégat avant de faire rédiger évite de découvrir dans
// le texte qu'il manquait la moitié des séances.
// ============================================================
router.get('/:patient_id/donnees', requireAuth, staff, async (req, res, next) => {
  try {
    const pid = req.params.patient_id;
    const fin = req.query.fin || new Date().toISOString().slice(0, 10);
    // `tout=1` : toute l'histoire depuis l'entrée, et non la seule période
    // depuis le dernier bilan. C'est ce que demande la vue « Activité
    // physique réalisée », qui raconte le parcours entier.
    const debut = req.query.tout === '1'
      ? null
      : (req.query.debut || await bornePrecedente(pid));
    res.json({ donnees: await agregerPeriode(pid, debut, fin), debut, fin });
  } catch (e) { next(e); }
});

/** Date du dernier bilan : point de départ naturel de la période suivante. */
async function bornePrecedente(patientId) {
  const r = await query(
    `SELECT MAX(date_bilan) AS d FROM bilans WHERE patient_id = $1`, [patientId]);
  return (r.rows.length && r.rows[0].d) ? String(r.rows[0].d).slice(0, 10) : null;
}

// ============================================================
// POST /:patient_id — crée un bilan
// ------------------------------------------------------------
// Par défaut le texte est rédigé par l'IA à partir de l'agrégat. Avec
// `rediger: false`, le bilan est créé vide : certains préfèrent écrire
// eux-mêmes, et rien n'oblige à passer par le modèle.
// ============================================================
router.post('/:patient_id', requireAuth, staff, async (req, res, next) => {
  try {
    const pid = req.params.patient_id;
    const { type, titre, date_bilan, periode_debut, bilan_entretien } = req.body || {};
    const t = TYPES.includes(type) ? type : 'intermediaire';
    const fin = (date_bilan || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const debut = periode_debut || await bornePrecedente(pid);

    const donnees = await agregerPeriode(pid, debut, fin);
    if (bilan_entretien) donnees.bilan_entretien = bilan_entretien;
    donnees.type_de_bilan = t;

    let texte = { contexte: '', activite: '', objectifs: '', modele: null };
    const rediger = req.body && req.body.rediger !== false;
    if (rediger) {
      if (!ia.cleActive()) {
        return res.status(503).json({
          error: "La rédaction assistée n'est pas configurée sur le serveur (MISTRAL_API_KEY absente)."
        });
      }
      texte = await ia.genererBilan(donnees, t);
    }

    const libelle = titre || (t === 'sortie' ? 'Bilan de sortie'
                   : t === 'entree' ? "Bilan d'entrée" : 'Bilan intermédiaire');

    const r = await query(
      `INSERT INTO bilans (patient_id, type, titre, date_bilan, periode_debut, periode_fin,
                           contexte, activite, objectifs, bilan_entretien, donnees,
                           generee_le, modele, cree_par, maj_par)
       VALUES ($1,$2,$3,$4,$5,$4,$6,$7,$8,$9,$10,
               CASE WHEN $11::text IS NULL THEN NULL ELSE NOW() END, $11, $12, $12)
       RETURNING *`,
      [pid, t, libelle, fin, debut, texte.contexte, texte.activite, texte.objectifs,
       bilan_entretien || null, JSON.stringify(donnees), texte.modele || null, req.user.id]);

    res.status(201).json({ bilan: r.rows[0] });
  } catch (e) { next(e); }
});

// ============================================================
// PUT /:id — enregistre le texte relu
// ------------------------------------------------------------
// Toute modification ramène le bilan à l'état de brouillon : une validation
// porte sur un texte précis, pas sur un document qui continue de changer.
// ============================================================
router.put('/:id', requireAuth, staff, async (req, res, next) => {
  try {
    const { contexte, activite, objectifs, bilan_entretien, titre, date_bilan } = req.body || {};
    const r = await query(
      `UPDATE bilans
          SET contexte = COALESCE($2, contexte),
              activite = COALESCE($3, activite),
              objectifs = COALESCE($4, objectifs),
              bilan_entretien = COALESCE($5, bilan_entretien),
              titre = COALESCE($6, titre),
              date_bilan = COALESCE($7::date, date_bilan),
              validee = FALSE, validee_le = NULL, validee_par = NULL, validee_par_nom = NULL,
              maj_le = NOW(), maj_par = $8
        WHERE id = $1 RETURNING *`,
      [req.params.id, contexte, activite, objectifs, bilan_entretien,
       titre, date_bilan || null, req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Bilan introuvable.' });
    res.json({ bilan: r.rows[0] });
  } catch (e) { next(e); }
});

// ============================================================
// POST /:id/valider — l'investigateur assume le bilan
// ------------------------------------------------------------
// Le texte validé est celui qui était à l'écran : on le réenregistre dans la
// même opération, sans quoi on pourrait valider une version et en afficher
// une autre.
// ============================================================
router.post('/:id/valider', requireAuth, staff, async (req, res, next) => {
  try {
    const { contexte, activite, objectifs } = req.body || {};
    if (!String(contexte || '').trim() && !String(activite || '').trim()
        && !String(objectifs || '').trim()) {
      return res.status(400).json({ error: 'Un bilan vide ne peut pas être validé.' });
    }
    const r = await query(
      `UPDATE bilans
          SET contexte = $2, activite = $3, objectifs = $4,
              validee = TRUE, validee_le = NOW(),
              validee_par = $5, validee_par_nom = $6,
              maj_le = NOW(), maj_par = $5
        WHERE id = $1 RETURNING *`,
      [req.params.id, contexte || '', activite || '', objectifs || '',
       req.user.id, req.user.name || req.user.email || null]);
    if (!r.rows.length) return res.status(404).json({ error: 'Bilan introuvable.' });
    res.json({ bilan: r.rows[0] });
  } catch (e) { next(e); }
});

// ============================================================
// DELETE /:id — seulement tant que le bilan n'est pas validé
// ------------------------------------------------------------
// Un bilan validé fait partie du dossier : il se corrige, il ne s'efface pas.
// ============================================================
router.delete('/:id', requireAuth, staff, async (req, res, next) => {
  try {
    const r = await query(
      `DELETE FROM bilans WHERE id = $1 AND validee = FALSE RETURNING id`,
      [req.params.id]);
    if (!r.rows.length) {
      return res.status(409).json({
        error: "Ce bilan est validé : il fait partie du dossier et ne peut plus être supprimé. Corrigez-le plutôt."
      });
    }
    res.json({ supprime: true });
  } catch (e) { next(e); }
});

module.exports = router;
