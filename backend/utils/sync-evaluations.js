/**
 * sync-evaluations.js — Les documents versés alimentent les courbes
 * ==================================================================
 *
 * Une mesure datée lue dans un compte rendu doit apparaître sur les courbes
 * longitudinales, au même titre qu'une valeur saisie à la main. Sans cela,
 * on se retrouvait avec un diamètre aortique à jour dans la fiche et une
 * courbe interrompue deux ans plus tôt — et toute analyse d'évolution
 * devenait fausse par omission.
 *
 * Quatre sources datées sont rassemblées :
 *   • echo_reports      : échocardiographies structurées
 *   • medical_timeline  : faits extraits des documents par l'IA, validés
 *   • consultations     : mesures aortiques relevées en consultation
 *   • medical_records   : diagnostic initial et évaluation actuelle
 *
 * TROIS RÈGLES, qui sont des garde-fous et non des détails d'implémentation.
 *
 * 1. On ne touche JAMAIS aux évaluations saisies à la main ni aux épreuves
 *    d'effort importées. Une synchronisation automatique qui écrase le
 *    travail du clinicien serait inacceptable dans un dossier de recherche.
 *
 * 2. Une seule évaluation documentaire par date. L'index unique de la
 *    migration 020 le garantit : relancer la synchronisation dix fois ne
 *    crée pas dix lignes.
 *
 * 3. Si une évaluation manuelle existe déjà à cette date, on ne crée rien.
 *    La saisie humaine fait foi.
 */
const { query } = require('../config/database');

/** Normalise une date en 'AAAA-MM-JJ', ou null si inexploitable */
function jour(v) {
  if (!v) return null;
  try {
    const d = v instanceof Date ? v : new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  } catch (_) { return null; }
}

/**
 * Niveau de preuve déduit de l'origine de la valeur.
 *
 * Seul le compte rendu d'échocardiographie est le document de référence pour
 * l'aorte. Une consultation retranscrit une mesure, elle ne la produit pas ;
 * un formulaire encore moins. Les deux restent affichés — ils permettent de
 * travailler avant l'arrivée des examens — mais distingués.
 */
function niveauDepuisDetail(detail) {
  return /échocardiographie/i.test(String(detail || '')) ? 'mesure' : 'declaree';
}

function nombre(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Rassemble toutes les mesures datées d'un patient.
 * @returns {Map<string, {aorta, vo2, source_detail}>} clé = date
 */
async function collecter(patientId) {
  const parDate = new Map();
  const poser = (date, champ, valeur, detail) => {
    const d = jour(date);
    if (!d || valeur == null) return;
    if (!parDate.has(d)) parDate.set(d, { details: [] });
    const e = parDate.get(d);
    // Première valeur rencontrée conservée : les sources sont parcourues de
    // la plus fiable à la moins fiable.
    if (e[champ] == null) {
      e[champ] = valeur;
      if (detail) e.details.push(detail);
    }
  };

  // --- 1. Échocardiographies : la source la plus précise pour l'aorte ---
  const echo = await query(
    `SELECT exam_date, sinus_valsalva_mm, aorte_max_mm, aorte_site_max
       FROM echo_reports WHERE patient_id = $1 AND exam_date IS NOT NULL
      ORDER BY exam_date ASC`, [patientId]).catch(() => ({ rows: [] }));
  echo.rows.forEach(r => {
    const v = nombre(r.sinus_valsalva_mm) ?? nombre(r.aorte_max_mm);
    poser(r.exam_date, 'aorta', v, 'échocardiographie');
  });

  // --- 2. Consultations : mesure relevée et validée par le clinicien ---
  const cons = await query(
    `SELECT consultation_date, aortic_value_mm, aortic_site
       FROM consultations WHERE patient_id = $1 AND aortic_value_mm IS NOT NULL
      ORDER BY consultation_date ASC`, [patientId]).catch(() => ({ rows: [] }));
  cons.rows.forEach(r => poser(r.consultation_date, 'aorta', nombre(r.aortic_value_mm), 'consultation'));

  // --- 3. Chronologie extraite des documents ---
  // Seuls les faits non rejetés, et seulement les mesures aortiques :
  // reprendre toutes les catégories remplirait les courbes de bruit.
  const faits = await query(
    `SELECT event_date, label, value_num, unit, date_precision
       FROM medical_timeline
      WHERE patient_id = $1 AND statut <> 'rejete'
        AND category = 'mesure' AND value_num IS NOT NULL
        AND event_date IS NOT NULL
        AND (label ILIKE '%aort%' OR label ILIKE '%valsalva%' OR label ILIKE '%racine%')
      ORDER BY event_date ASC`, [patientId]).catch(() => ({ rows: [] }));
  faits.rows.forEach(r => {
    // Une date au mois ou à l'année près ne doit pas devenir un point de
    // courbe : elle donnerait une fausse précision à l'analyse d'évolution.
    if (r.date_precision && r.date_precision !== 'jour') return;
    const v = nombre(r.value_num);
    // Filtre de vraisemblance : un diamètre aortique hors de 10–90 mm est
    // une erreur de lecture, pas une mesure.
    if (v == null || v < 10 || v > 90) return;
    poser(r.event_date, 'aorta', v, 'document');
  });

  // --- 4. Suivi aortique du dossier : diagnostic initial et valeur actuelle ---
  const mr = await query(
    `SELECT aortic_followup FROM medical_records WHERE patient_id = $1`,
    [patientId]).catch(() => ({ rows: [] }));
  if (mr.rows.length && mr.rows[0].aortic_followup) {
    const a = mr.rows[0].aortic_followup;
    poser(a.first_diagnosis_date, 'aorta', nombre(a.first_value_mm), 'diagnostic initial');
    // `current_*` n'est plus une origine : c'était une recopie de l'écho ou
    // de la consultation, relue ici comme si elle venait d'ailleurs. Seule
    // la valeur de DÉPART reste, et elle est explicitement déclarée.
    // (migration 034)
  }

  return parDate;
}

/**
 * Crée ou met à jour les évaluations d'origine documentaire.
 * Ne lève jamais : renvoie un compte rendu.
 */
async function synchroniser(patientId, parQui) {
  const resume = { creees: 0, majs: 0, ignorees: 0, supprimees: 0, erreurs: [] };
  if (!patientId) return resume;

  let parDate;
  try { parDate = await collecter(patientId); }
  catch (e) { resume.erreurs.push(e.message); return resume; }

  // --- La projection se nettoie d'elle-même ----------------------------
  //
  // Jusqu'ici cette fonction ne savait qu'ajouter. Une évaluation dérivée
  // survivait donc à la disparition de son origine : on corrigeait la
  // valeur fautive à la source, et le point restait sur la courbe. C'est ce
  // qui s'est produit avec un diamètre de 45 mm — il a fallu un script pour
  // l'effacer à la main, alors qu'une synchronisation aurait dû suffire.
  //
  // On supprime donc les évaluations d'origine documentaire dont la date
  // n'est plus produite par aucune origine. Jamais les autres : une
  // évaluation saisie à la main appartient au soignant, et une évaluation
  // portant un VO2 vient d'une épreuve d'effort analysée, pas d'ici.
  try {
    const dates = [...parDate.keys()];
    const r = dates.length
      ? await query(
          `DELETE FROM evaluations
            WHERE patient_id = $1 AND source = 'document'
              AND vo2 IS NULL AND force_kg IS NULL AND sf36 IS NULL AND gpaq IS NULL
              AND eval_date <> ALL ($2::date[])`, [patientId, dates])
      : await query(
          `DELETE FROM evaluations
            WHERE patient_id = $1 AND source = 'document'
              AND vo2 IS NULL AND force_kg IS NULL AND sf36 IS NULL AND gpaq IS NULL`,
          [patientId]);
    resume.supprimees = r.rowCount || 0;
    if (resume.supprimees) {
      console.log('[sync-eval] ' + patientId + ' : ' + resume.supprimees +
                  ' évaluation(s) dérivée(s) sans origine, supprimée(s).');
    }
  } catch (e) { resume.erreurs.push('nettoyage : ' + e.message); }

  if (!parDate.size) return resume;

  // Dates déjà couvertes par une évaluation saisie à la main ou importée :
  // la synchronisation ne doit surtout pas les doubler.
  let manuelles = new Set();
  try {
    const r = await query(
      `SELECT eval_date FROM evaluations
        WHERE patient_id = $1 AND COALESCE(source, 'manuel') <> 'document'
          AND eval_date IS NOT NULL`, [patientId]);
    manuelles = new Set(r.rows.map(x => jour(x.eval_date)).filter(Boolean));
  } catch (e) { resume.erreurs.push(e.message); }

  for (const [date, mesures] of [...parDate.entries()].sort()) {
    if (manuelles.has(date)) { resume.ignorees++; continue; }
    if (mesures.aorta == null && mesures.vo2 == null) { resume.ignorees++; continue; }

    const detail = [...new Set(mesures.details)].join(', ');
    try {
      // eval_id : on prolonge la numérotation existante du patient.
      const max = await query(
        'SELECT COALESCE(MAX(eval_id), 0) AS m FROM evaluations WHERE patient_id = $1',
        [patientId]);
      const prochain = Number(max.rows[0].m) + 1;

      const r = await query(
        `INSERT INTO evaluations (patient_id, eval_id, label, eval_date, aorta, vo2,
                                  validated, note, source, source_detail,
                                  niveau_preuve, maj_le)
              VALUES ($1, $2, $3, $4, $5, $6, FALSE, $7, 'document', $8, $9, NOW())
         ON CONFLICT (patient_id, eval_date) WHERE source = 'document'
         DO UPDATE SET aorta = COALESCE(EXCLUDED.aorta, evaluations.aorta),
                       vo2   = COALESCE(EXCLUDED.vo2,   evaluations.vo2),
                       source_detail = EXCLUDED.source_detail,
                       -- Une mesure ne redevient jamais déclarée : le jour où
                       -- l'échocardiographie arrive, elle prend la place du
                       -- chiffre saisi, et ce niveau ne redescend pas.
                       niveau_preuve = CASE
                         WHEN EXCLUDED.niveau_preuve = 'mesure' THEN 'mesure'
                         ELSE evaluations.niveau_preuve END,
                       maj_le = NOW()
         RETURNING (xmax = 0) AS creee`,
        [patientId, prochain,
         'Document — ' + new Date(date).toLocaleDateString('fr-FR'),
         date, mesures.aorta, mesures.vo2,
         'Déduite d\'une pièce versée (' + (detail || 'document') + '). À valider.',
         detail || null,
         niveauDepuisDetail(detail)]
      );
      if (r.rows[0] && r.rows[0].creee) resume.creees++; else resume.majs++;
    } catch (e) {
      resume.erreurs.push(date + ' : ' + e.message);
    }
  }

  if (resume.creees || resume.majs || resume.supprimees) {
    console.log('[sync-eval] ' + patientId + ' : ' + resume.creees + ' créée(s), ' +
                resume.majs + ' mise(s) à jour, ' + resume.supprimees +
                ' supprimée(s), par ' + (parQui || 'système'));
  }
  return resume;
}

module.exports = { synchroniser, collecter };
