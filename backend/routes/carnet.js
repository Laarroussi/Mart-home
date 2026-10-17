/**
 * Carnet de suivi — les actions à ne pas oublier
 * ==============================================
 *
 * Partagé entre investigateurs : chacun voit tout, et chaque ligne porte le
 * nom de qui l'a demandée. Dans une équipe, « qui a décidé ça » fait partie de
 * l'information ; une liste anonyme produit des actions que personne ne
 * s'approprie.
 *
 * Le regroupement temporel est calculé ICI, côté serveur, et pas dans la page.
 * Deux raisons : la date du jour du serveur est la même pour tout le monde,
 * alors que celle d'un poste peut être fausse ; et une action en retard doit
 * se voir en retard quel que soit l'écran qui l'affiche.
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();

// Toutes les routes du carnet sont réservées à l'équipe soignante.
const soignants = requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR);

/**
 * Où ranger une action selon son échéance.
 * Les bornes sont calculées en jours entiers : une action due aujourd'hui
 * reste « aujourd'hui » jusqu'à minuit, et ne bascule pas « en retard » à midi.
 */
/**
 * Ramène une échéance à un jour de calendrier, à minuit, heure locale.
 *
 * Une échéance arrive sous deux formes : un objet Date, quand elle vient de
 * PostgreSQL, et une chaîne « 2026-10-14 », quand elle vient du formulaire.
 * Les traiter pareil est une faute classique : `new Date('2026-10-14')` est
 * interprété en UTC, si bien qu'à l'ouest de Greenwich il désigne la VEILLE au
 * soir. Une action due le 14 s'afficherait « en retard » le 14 au matin.
 *
 * On lit donc une date écrite comme une date — trois nombres — et un objet
 * Date par ses composantes locales. Aucun calcul d'écart horaire n'intervient.
 */
function jourLocal(valeur) {
  if (valeur instanceof Date) {
    if (isNaN(valeur.getTime())) return null;
    return new Date(valeur.getFullYear(), valeur.getMonth(), valeur.getDate());
  }
  const m = String(valeur).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(valeur);
  return isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function rubrique(echeance, aujourdhui) {
  if (!echeance) return 'sans_echeance';
  const jour = jourLocal(echeance);
  if (!jour) return 'sans_echeance';
  const j = Math.round((jour - aujourdhui) / 86400000);
  if (j < 0) return 'en_retard';
  if (j === 0) return 'aujourdhui';
  if (j <= 7) return 'cette_semaine';
  return 'plus_tard';
}

// ============================================================
// GET /api/carnet — tout ce qui est à faire, rangé par échéance
// ============================================================
router.get('/', requireAuth, soignants, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.id, a.patient_id, a.texte, a.note, a.echeance, a.statut,
              a.type, a.heure, a.lieu,
              a.cree_le, a.faite_le, a.motif,
              c.name AS cree_par_nom, a.cree_par,
              f.name AS faite_par_nom
         FROM carnet_actions a
         JOIN users c ON c.id = a.cree_par
         LEFT JOIN users f ON f.id = a.faite_par
        WHERE a.statut = 'a_faire'
           OR a.faite_le > NOW() - INTERVAL '14 days'
        ORDER BY a.echeance NULLS LAST, a.heure NULLS LAST, a.cree_le`
    );

    // Minuit, heure du serveur : la frontière entre « en retard » et « pour
    // aujourd'hui » doit être une date, pas un instant.
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);

    const groupes = {
      en_retard: [], aujourdhui: [], cette_semaine: [],
      plus_tard: [], sans_echeance: [], faites: []
    };
    for (const a of rows) {
      if (a.statut === 'faite' || a.statut === 'annulee') groupes.faites.push(a);
      else groupes[rubrique(a.echeance, aujourdhui)].push(a);
    }

    // Compte par patient : alimente la colonne de gauche, où l'on voit d'un
    // coup d'œil qui réclame quelque chose. Seul ce qui est encore à faire
    // est compté — une liste où les actions terminées gonflent le chiffre ne
    // sert à rien.
    const parPatient = {};
    for (const a of rows) {
      if (a.statut !== 'a_faire' || !a.patient_id) continue;
      const p = parPatient[a.patient_id] || (parPatient[a.patient_id] = { total: 0, en_retard: 0 });
      p.total++;
      if (rubrique(a.echeance, aujourdhui) === 'en_retard') p.en_retard++;
    }

    res.json({
      groupes,
      par_patient: parPatient,
      // Le compte de ce qui réclame une décision aujourd'hui : c'est ce
      // chiffre qu'on regarde en premier.
      a_traiter: groupes.en_retard.length + groupes.aujourdhui.length
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/carnet — ajouter une action
// ============================================================
router.post('/', requireAuth, soignants, async (req, res, next) => {
  try {
    const { patient_id, texte, note, echeance, type, heure, lieu } = req.body || {};
    if (!texte || !String(texte).trim()) {
      return res.status(400).json({ error: "Ecrivez ce qu'il y a a faire." });
    }
    const TYPES = ['tache', 'rendez_vous', 'prevu'];
    const nature = TYPES.includes(type) ? type : 'tache';
    // Une heure sans date ne situe rien : on la refuse plutôt que de
    // l'enregistrer orpheline, où elle n'apparaîtrait nulle part.
    if (heure && !echeance) {
      return res.status(400).json({ error: "Une heure demande une date : precisez le jour." });
    }
    if (heure && !/^\d{1,2}:\d{2}$/.test(String(heure))) {
      return res.status(400).json({ error: 'Heure incomprehensible. Format attendu : 14:30' });
    }
    if (patient_id) {
      const p = await query('SELECT id FROM patients WHERE id = $1', [patient_id]);
      if (!p.rows.length) return res.status(404).json({ error: 'Patient introuvable : ' + patient_id });
    }
    // Une date illisible vaut mieux refusée qu'enregistrée de travers : une
    // échéance fausse fait sonner l'action au mauvais moment, ou jamais.
    if (echeance && isNaN(new Date(echeance).getTime())) {
      return res.status(400).json({ error: 'Date d echeance incomprehensible.' });
    }

    const { rows } = await query(
      `INSERT INTO carnet_actions (patient_id, texte, note, echeance, cree_par, type, heure, lieu)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [patient_id || null, String(texte).trim(), (note || '').trim() || null,
       echeance || null, req.user.id, nature, heure || null, (lieu || '').trim() || null]
    );
    res.status(201).json({ action: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// PATCH /api/carnet/:id — faite, rouverte, annulée, ou corrigée
// ------------------------------------------------------------
// Rien n'est supprimé. Une action annulée garde son motif : savoir qu'on a
// renoncé, et pourquoi, vaut mieux qu'une ligne disparue sans trace.
// ============================================================
router.patch('/:id', requireAuth, soignants, async (req, res, next) => {
  try {
    const { statut, texte, note, echeance, motif } = req.body || {};
    const actuelle = await query('SELECT * FROM carnet_actions WHERE id = $1', [req.params.id]);
    if (!actuelle.rows.length) return res.status(404).json({ error: 'Action introuvable' });

    if (statut && !['a_faire', 'faite', 'annulee'].includes(statut)) {
      return res.status(400).json({ error: 'Statut inconnu : ' + statut });
    }
    if (statut === 'annulee' && !(motif && String(motif).trim())) {
      return res.status(400).json({ error: "Dites pourquoi vous renoncez a cette action." });
    }

    const champs = [], val = [];
    const set = (col, v) => { val.push(v); champs.push(col + ' = $' + val.length); };

    if (statut === 'faite') {
      set('statut', 'faite'); set('faite_par', req.user.id); set('faite_le', new Date());
    } else if (statut === 'a_faire') {
      // Rouvrir efface la signature de clôture : laisser « faite par X » sur
      // une action à refaire serait un faux témoignage.
      set('statut', 'a_faire'); set('faite_par', null); set('faite_le', null); set('motif', null);
    } else if (statut === 'annulee') {
      set('statut', 'annulee'); set('faite_par', req.user.id);
      set('faite_le', new Date()); set('motif', String(motif).trim());
    }
    if (texte !== undefined && String(texte).trim()) set('texte', String(texte).trim());
    if (note !== undefined) set('note', (note || '').trim() || null);
    if (echeance !== undefined) {
      if (echeance && isNaN(new Date(echeance).getTime())) {
        return res.status(400).json({ error: 'Date d echeance incomprehensible.' });
      }
      set('echeance', echeance || null);
    }
    if (!champs.length) return res.status(400).json({ error: 'Rien a modifier.' });

    val.push(req.params.id);
    const { rows } = await query(
      `UPDATE carnet_actions SET ${champs.join(', ')} WHERE id = $${val.length} RETURNING *`, val);
    res.json({ action: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/carnet/patient/:id — les actions d'un patient
// ============================================================
router.get('/patient/:id', requireAuth, soignants, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT a.*, c.name AS cree_par_nom, f.name AS faite_par_nom
         FROM carnet_actions a
         JOIN users c ON c.id = a.cree_par
         LEFT JOIN users f ON f.id = a.faite_par
        WHERE a.patient_id = $1
        ORDER BY a.statut, a.echeance NULLS LAST, a.cree_le DESC`,
      [req.params.id]
    );
    res.json({ actions: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/carnet/apercu/:id — le strict nécessaire sur un patient
// ------------------------------------------------------------
// Alimente le bandeau latéral. On ne renvoie que ce qui sert à reconnaître la
// personne et à savoir où elle en est : identité, âge, et le dernier diamètre
// des sinus de Valsalva.
//
// Ce diamètre est lu dans `echo_reports`, et nulle part ailleurs. La table
// `patients` porte une colonne `aorta` qui a pu être remplie à la main lors
// de la création du dossier : c'est une valeur rapportée, pas une mesure, et
// les règles du dépôt interdisent qu'elle prenne la place du compte rendu
// d'échocardiographie. En l'absence d'examen, on renvoie null — et le bandeau
// affichera « non mesuré », jamais un chiffre d'origine incertaine.
// ============================================================
router.get('/apercu/:id', requireAuth, soignants, async (req, res, next) => {
  try {
    const p = await query(
      'SELECT id, age, sex, civil FROM patients WHERE id = $1', [req.params.id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Patient introuvable' });

    const echo = await query(
      `SELECT sinus_valsalva_mm, exam_date
         FROM echo_reports
        WHERE patient_id = $1 AND sinus_valsalva_mm IS NOT NULL
        ORDER BY exam_date DESC NULLS LAST
        LIMIT 1`,
      [req.params.id]
    );

    const civil = p.rows[0].civil || {};
    res.json({
      apercu: {
        id: p.rows[0].id,
        age: p.rows[0].age,
        sexe: p.rows[0].sex,
        prenom: civil.firstName || null,
        nom: civil.lastName || null,
        ipp: civil.ipp || null,
        sinus_valsalva_mm: echo.rows.length ? echo.rows[0].sinus_valsalva_mm : null,
        sinus_date: echo.rows.length ? echo.rows[0].exam_date : null
      }
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/carnet/affiche/:id — tout ce qui concerne un patient
// ------------------------------------------------------------
// Ce que le soignant veut voir en cliquant sur une vignette : où en est cette
// personne, et qu'est-ce qui l'attend.
//
// Quatre questions, quatre requêtes, une seule réponse :
//   • a-t-elle une séance EN COURS, maintenant ?
//   • qu'a-t-elle réellement fait ?
//   • les séances qu'on lui a prescrites, les a-t-elle faites ?
//   • que reste-t-il à faire la concernant ?
//
// La troisième est la plus utile et la plus absente ailleurs : prescrire une
// séance et ne jamais savoir si elle a été suivie, c'est prescrire dans le
// vide.
// ============================================================
router.get('/affiche/:id', requireAuth, soignants, async (req, res, next) => {
  try {
    const id = req.params.id;

    // Une séance ouverte et non refermée. Si elle date d'hier, ce n'est pas
    // une séance en cours : c'est une séance que personne n'a close.
    const enCours = await query(
      `SELECT id, started_at, session_type,
              EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER AS depuis_s
         FROM training_sessions
        WHERE patient_id = $1 AND ended_at IS NULL
        ORDER BY started_at DESC LIMIT 1`, [id]);

    const bilan = await query(
      `SELECT count(*)::int AS seances,
              COALESCE(sum(duration_s), 0)::int AS duree_totale_s,
              max(started_at) AS derniere,
              round(avg(borg_cr10)::numeric, 1) AS borg_moyen,
              count(*) FILTER (WHERE started_at > NOW() - INTERVAL '28 days')::int AS seances_4_semaines
         FROM training_sessions
        WHERE patient_id = $1 AND ended_at IS NOT NULL`, [id]);

    // Séances prescrites, et ce qui en a été fait. Une prescription compte
    // comme suivie dès qu'une séance terminée s'y rattache.
    const prescrites = await query(
      `SELECT p.id, p.title, tpp.assigned_at,
              (SELECT count(*)::int FROM training_sessions s
                WHERE s.patient_id = tpp.patient_id
                  AND s.training_program_id = p.id
                  AND s.ended_at IS NOT NULL) AS realisees,
              (SELECT max(s.started_at) FROM training_sessions s
                WHERE s.patient_id = tpp.patient_id
                  AND s.training_program_id = p.id
                  AND s.ended_at IS NOT NULL) AS derniere_fois
         FROM training_program_patients tpp
         JOIN training_programs p ON p.id = tpp.program_id
        WHERE tpp.patient_id = $1 AND p.archived IS NOT TRUE
        ORDER BY tpp.assigned_at DESC
        LIMIT 20`, [id]);

    // Ce qui reste à faire : les entrées du carnet, rangées par nature.
    const actions = await query(
      `SELECT a.id, a.texte, a.note, a.echeance, a.statut, a.type, a.heure, a.lieu,
              a.cree_le, c.name AS cree_par_nom
         FROM carnet_actions a
         JOIN users c ON c.id = a.cree_par
        WHERE a.patient_id = $1 AND a.statut = 'a_faire'
        ORDER BY a.echeance NULLS LAST, a.heure NULLS LAST`, [id]);

    const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
    const parNature = { tache: [], rendez_vous: [], prevu: [] };
    let enRetard = 0;
    for (const a of actions.rows) {
      a.urgence = rubrique(a.echeance, aujourdhui);
      if (a.urgence === 'en_retard') enRetard++;
      (parNature[a.type] || parNature.tache).push(a);
    }

    res.json({
      en_cours: enCours.rows[0] || null,
      bilan: bilan.rows[0],
      prescrites: prescrites.rows,
      actions: parNature,
      en_retard: enRetard
    });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.rubrique = rubrique;
module.exports.jourLocal = jourLocal;
