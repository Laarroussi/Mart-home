/**
 * Portrait du patient — tout ce qui compte, en un seul appel
 * ==========================================================
 *
 * Une page qui tient sur un écran ne peut pas se remplir par six requêtes qui
 * arrivent les unes après les autres : on verrait les blocs apparaître dans le
 * désordre, et la page sauterait sous les yeux pendant qu'on la lit. Tout est
 * donc rassemblé ici, en une réponse.
 *
 * Les règles de provenance du dépôt s'appliquent sans exception :
 *
 *   - le diamètre aortique vient de `echo_reports`, jamais de la colonne
 *     `aorta` de la fiche, qui peut avoir été saisie à la main ;
 *   - une donnée absente est renvoyée nulle, et s'affichera « non renseigné ».
 *     Jamais un zéro, jamais une estimation.
 *
 * Ce portrait est une vue de lecture. Il ne calcule aucun score et ne porte
 * aucun jugement : il met côte à côte ce qui est enregistré, pour que le
 * clinicien ait tout sous les yeux au moment de décider.
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();
const soignants = requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR);

router.get('/:id', requireAuth, soignants, async (req, res, next) => {
  try {
    const id = req.params.id;

    const pr = await query(
      `SELECT id, sex, age, gene, status, status_class, risk_factor, risk_comment,
              alterations, incidents, civil, medical, study,
              aorte_operee, aorte_operee_date, aorte_operee_type
         FROM patients WHERE id = $1`, [id]);
    if (!pr.rows.length) return res.status(404).json({ error: 'Patient introuvable' });
    const p = pr.rows[0];
    const civil = p.civil || {}, medical = p.medical || {}, study = p.study || {};

    // Les deux dernières mesures des sinus : la valeur du jour ne dit rien
    // sans celle d'avant. C'est l'évolution qui décide, pas le chiffre seul.
    const echo = await query(
      `SELECT sinus_valsalva_mm, exam_date
         FROM echo_reports
        WHERE patient_id = $1 AND sinus_valsalva_mm IS NOT NULL
        ORDER BY exam_date DESC NULLS LAST LIMIT 2`, [id]);

    // Activité réalisée. On ne compte que les séances terminées : une séance
    // ouverte et jamais refermée gonflerait le total sans qu'on ait pédalé.
    const act = await query(
      `SELECT count(*)::int                        AS seances,
              COALESCE(sum(duration_s), 0)::int    AS duree_totale_s,
              max(started_at)                      AS derniere,
              round(avg(borg_cr10)::numeric, 1)    AS borg_moyen,
              round(avg(NULLIF(hr_avg, 0))::numeric, 0) AS fc_moyenne
         FROM training_sessions
        WHERE patient_id = $1 AND ended_at IS NOT NULL`, [id]);

    const sess = await query(
      `SELECT started_at, duration_s, borg_cr10, modalite
         FROM training_sessions
        WHERE patient_id = $1 AND ended_at IS NOT NULL
        ORDER BY started_at DESC LIMIT 5`, [id]);

    // Dernière épreuve d'effort, pour situer la capacité.
    //
    // Les colonnes s'appellent `vo2` et `eval_date`, pas `vo2_max` et
    // `test_date` : première version écrite de mémoire, que le schéma a
    // démentie. Pas de `catch` silencieux ici — une requête fausse qui renvoie
    // un tableau vide fait disparaître la VO₂ de l'écran sans que personne
    // sache pourquoi, et c'est précisément le genre d'absence qu'on prend
    // ensuite pour une absence de mesure.
    const vo2 = await query(
      `SELECT vo2, eval_date FROM evaluations
        WHERE patient_id = $1 AND vo2 IS NOT NULL
        ORDER BY eval_date DESC NULLS LAST LIMIT 1`, [id]);

    const photo = await query(
      'SELECT mime, donnees FROM patient_photos WHERE patient_id = $1', [id]);

    res.json({
      identite: {
        id: p.id,
        prenom: civil.firstName || null,
        nom: civil.lastName || null,
        ipp: civil.ipp || null,
        age: p.age,
        sexe: p.sex,
        profession: civil.profession || null,
        centre: civil.center || null,
        photo: photo.rows.length
          ? { mime: photo.rows[0].mime, data: photo.rows[0].donnees.toString('base64') }
          : null
      },
      pathologie: {
        gene: p.gene || medical.variant || null,
        date_diagnostic: medical.dxDate || null,
        statut: p.status || null,
        statut_classe: p.status_class || null,
        alterations: p.alterations || [],
        incidents: p.incidents || [],
        facteur_risque: p.risk_factor || null,
        commentaire_risque: p.risk_comment || null
      },
      aorte: {
        sinus_mm: echo.rows[0] ? echo.rows[0].sinus_valsalva_mm : null,
        sinus_date: echo.rows[0] ? echo.rows[0].exam_date : null,
        sinus_precedent_mm: echo.rows[1] ? echo.rows[1].sinus_valsalva_mm : null,
        sinus_precedent_date: echo.rows[1] ? echo.rows[1].exam_date : null,
        operee: p.aorte_operee,
        operee_date: p.aorte_operee_date,
        operee_type: p.aorte_operee_type
      },
      antecedents: {
        histoire: medical.history || null,
        traitements: medical.treatments || null,
        allergies: medical.allergies || null,
        tabac: medical.smoking || null,
        pa_repos: medical.baselinePA || null
      },
      apa: {
        debut: study.apaStart || null,
        inclusion: study.inclusionDate || null,
        modalites: study.modalites || null,
        objectifs: study.notes || null,
        vo2_max: vo2.rows[0] ? vo2.rows[0].vo2 : null,
        vo2_date: vo2.rows[0] ? vo2.rows[0].eval_date : null
      },
      activite: {
        seances: act.rows[0].seances,
        duree_totale_s: act.rows[0].duree_totale_s,
        derniere: act.rows[0].derniere,
        borg_moyen: act.rows[0].borg_moyen,
        fc_moyenne: act.rows[0].fc_moyenne,
        recentes: sess.rows
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;
