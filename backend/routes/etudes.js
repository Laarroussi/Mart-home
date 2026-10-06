/**
 * /api/etudes — Études cliniques et cahier d'observation (eCRF)
 * =============================================================
 *   GET    /                      → la bibliothèque, avec le nombre d'inclus
 *   GET    /:id                   → la fiche et son cahier complet
 *   POST   /                      → crée une étude
 *   PUT    /:id                   → met à jour la fiche
 *   DELETE /:id                   → archive (ou supprime si aucun patient)
 *
 *   POST   /:id/sections          → ajoute un chapitre au cahier
 *   PUT    /sections/:sid         → renomme ou déplace un chapitre
 *   DELETE /sections/:sid         → supprime un chapitre et ses variables
 *   POST   /sections/:sid/variables → ajoute une variable
 *   PUT    /variables/:vid        → modifie une variable
 *   DELETE /variables/:vid        → supprime une variable
 *
 *   PUT    /patients/:patient_id  → rattache un patient à une étude (ou à aucune)
 *
 * Réservé au personnel : un patient n'a pas à parcourir la liste des
 * protocoles en cours, ni à savoir quels autres patients y sont inclus.
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();
const staff = requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR);

const STATUTS = ['preparation', 'en_cours', 'inclusions_closes', 'terminee', 'suspendue'];
const TYPES_VAR = ['texte', 'nombre', 'date', 'choix', 'choix_multiple', 'oui_non', 'fichier'];

const vide = (v) => v === undefined ? null : (v === '' ? null : v);

// ============================================================
// GET / — la bibliothèque
// ------------------------------------------------------------
// Le nombre d'inclus est joint ici plutôt que demandé étude par étude : la
// bibliothèque s'ouvre en un appel, et c'est le chiffre qu'on regarde en
// premier quand on arrive sur la page.
// ============================================================
router.get('/', requireAuth, staff, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT e.*,
              (SELECT COUNT(*)::int FROM patients p WHERE p.etude_id = e.id) AS nb_inclus,
              (SELECT COUNT(*)::int FROM ecrf_sections s WHERE s.etude_id = e.id) AS nb_sections,
              (SELECT COUNT(*)::int FROM ecrf_variables v
                 JOIN ecrf_sections s2 ON s2.id = v.section_id
                WHERE s2.etude_id = e.id) AS nb_variables
         FROM etudes e
        WHERE e.active = TRUE
        ORDER BY e.cree_le DESC`);
    res.json({ etudes: r.rows });
  } catch (e) { next(e); }
});

// ============================================================
// GET /:id — la fiche et son cahier
// ------------------------------------------------------------
// Deux requêtes plutôt qu'une jointure : un cahier de cent variables
// produirait, en jointure plate, cent lignes répétant la fiche d'étude. On
// recompose l'arbre côté serveur, une fois, au lieu de le faire côté client
// à chaque affichage.
// ============================================================
router.get('/:id(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    const e = await query(`SELECT * FROM etudes WHERE id = $1`, [req.params.id]);
    if (!e.rows.length) return res.status(404).json({ error: 'Étude introuvable.' });

    const s = await query(
      `SELECT * FROM ecrf_sections WHERE etude_id = $1 ORDER BY rang ASC, id ASC`,
      [req.params.id]);
    const v = await query(
      `SELECT v.* FROM ecrf_variables v
         JOIN ecrf_sections s ON s.id = v.section_id
        WHERE s.etude_id = $1
        ORDER BY v.rang ASC, v.id ASC`, [req.params.id]);

    const parSection = {};
    v.rows.forEach(x => { (parSection[x.section_id] = parSection[x.section_id] || []).push(x); });

    const inclus = await query(
      `SELECT id, sex, age, civil FROM patients WHERE etude_id = $1 ORDER BY id ASC`,
      [req.params.id]);

    res.json({
      etude: e.rows[0],
      sections: s.rows.map(x => Object.assign({}, x, { variables: parSection[x.id] || [] })),
      patients: inclus.rows
    });
  } catch (e) { next(e); }
});

// ============================================================
// POST / — crée une étude
// ============================================================
router.post('/', requireAuth, staff, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!String(b.intitule || '').trim()) {
      return res.status(400).json({ error: "L'intitulé de l'étude est requis." });
    }
    const statut = STATUTS.includes(b.statut) ? b.statut : 'preparation';
    const r = await query(
      `INSERT INTO etudes (intitule, acronyme, resume, numero_cpp, numero_nct, promoteur,
                           investigateur_principal, type_etude, statut, date_debut, date_fin,
                           objectif_inclusions, notes, cree_par, maj_par)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14) RETURNING *`,
      [b.intitule.trim(), vide(b.acronyme), vide(b.resume), vide(b.numero_cpp),
       vide(b.numero_nct), vide(b.promoteur), vide(b.investigateur_principal),
       vide(b.type_etude), statut, vide(b.date_debut), vide(b.date_fin),
       b.objectif_inclusions || null, vide(b.notes), req.user.id]);
    res.status(201).json({ etude: r.rows[0] });
  } catch (e) { next(erreurLisible(e)); }
});

// ============================================================
// PUT /:id — met à jour la fiche
// ============================================================
router.put('/:id(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    const b = req.body || {};
    const statut = STATUTS.includes(b.statut) ? b.statut : null;
    const r = await query(
      `UPDATE etudes SET
         intitule = COALESCE($2, intitule),
         acronyme = $3, resume = $4, numero_cpp = $5, numero_nct = $6,
         promoteur = $7, investigateur_principal = $8, type_etude = $9,
         statut = COALESCE($10, statut),
         date_debut = $11::date, date_fin = $12::date,
         objectif_inclusions = $13, notes = $14,
         maj_le = NOW(), maj_par = $15
       WHERE id = $1 RETURNING *`,
      [req.params.id, vide(b.intitule), vide(b.acronyme), vide(b.resume),
       vide(b.numero_cpp), vide(b.numero_nct), vide(b.promoteur),
       vide(b.investigateur_principal), vide(b.type_etude), statut,
       vide(b.date_debut), vide(b.date_fin), b.objectif_inclusions || null,
       vide(b.notes), req.user.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Étude introuvable.' });
    res.json({ etude: r.rows[0] });
  } catch (e) { next(erreurLisible(e)); }
});

// ============================================================
// DELETE /:id — supprime, ou archive si des patients y sont inclus
// ------------------------------------------------------------
// Une étude vide se supprime vraiment. Une étude qui a servi se range : son
// intitulé figure dans des dossiers, et faire disparaître la référence
// rendrait ces dossiers incompréhensibles.
// ============================================================
router.delete('/:id(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    const n = await query(
      `SELECT COUNT(*)::int AS n FROM patients WHERE etude_id = $1`, [req.params.id]);
    if (n.rows[0].n > 0) {
      const r = await query(
        `UPDATE etudes SET active = FALSE, maj_le = NOW(), maj_par = $2
          WHERE id = $1 RETURNING id`, [req.params.id, req.user.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'Étude introuvable.' });
      return res.json({ archivee: true, nb_inclus: n.rows[0].n });
    }
    const r = await query(`DELETE FROM etudes WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Étude introuvable.' });
    res.json({ supprimee: true });
  } catch (e) { next(e); }
});

// ============================================================
// CAHIER D'OBSERVATION — chapitres
// ============================================================
router.post('/:id(\\d+)/sections', requireAuth, staff, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!String(b.titre || '').trim()) {
      return res.status(400).json({ error: 'Le titre du chapitre est requis.' });
    }
    // Le nouveau chapitre se place à la fin : c'est l'ordre dans lequel on
    // construit un cahier, et le déplacement reste possible ensuite.
    const m = await query(
      `SELECT COALESCE(MAX(rang), -1) + 1 AS r FROM ecrf_sections WHERE etude_id = $1`,
      [req.params.id]);
    const r = await query(
      `INSERT INTO ecrf_sections (etude_id, titre, description, visite, rang)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, b.titre.trim(), vide(b.description), vide(b.visite),
       b.rang != null ? b.rang : m.rows[0].r]);
    res.status(201).json({ section: Object.assign({}, r.rows[0], { variables: [] }) });
  } catch (e) { next(e); }
});

router.put('/sections/:sid(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    const b = req.body || {};
    const r = await query(
      `UPDATE ecrf_sections SET titre = COALESCE($2, titre), description = $3,
              visite = $4, rang = COALESCE($5, rang)
        WHERE id = $1 RETURNING *`,
      [req.params.sid, vide(b.titre), vide(b.description), vide(b.visite),
       b.rang != null ? b.rang : null]);
    if (!r.rows.length) return res.status(404).json({ error: 'Chapitre introuvable.' });
    res.json({ section: r.rows[0] });
  } catch (e) { next(e); }
});

router.delete('/sections/:sid(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    const r = await query(`DELETE FROM ecrf_sections WHERE id = $1 RETURNING id`,
      [req.params.sid]);
    if (!r.rows.length) return res.status(404).json({ error: 'Chapitre introuvable.' });
    res.json({ supprime: true });
  } catch (e) { next(e); }
});

// ============================================================
// CAHIER D'OBSERVATION — variables
// ============================================================
router.post('/sections/:sid(\\d+)/variables', requireAuth, staff, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!String(b.libelle || '').trim()) {
      return res.status(400).json({ error: 'Le libellé de la variable est requis.' });
    }
    const type = TYPES_VAR.includes(b.type) ? b.type : 'texte';
    if ((type === 'choix' || type === 'choix_multiple') && !String(b.choix || '').trim()) {
      return res.status(400).json({
        error: "Une variable à choix doit lister ses valeurs possibles, séparées par des points-virgules."
      });
    }
    const m = await query(
      `SELECT COALESCE(MAX(rang), -1) + 1 AS r FROM ecrf_variables WHERE section_id = $1`,
      [req.params.sid]);
    const r = await query(
      `INSERT INTO ecrf_variables (section_id, code, libelle, type, unite, choix,
                                   obligatoire, valeur_min, valeur_max, aide, rang)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.sid, vide(b.code), b.libelle.trim(), type, vide(b.unite), vide(b.choix),
       !!b.obligatoire, b.valeur_min != null && b.valeur_min !== '' ? b.valeur_min : null,
       b.valeur_max != null && b.valeur_max !== '' ? b.valeur_max : null,
       vide(b.aide), b.rang != null ? b.rang : m.rows[0].r]);
    res.status(201).json({ variable: r.rows[0] });
  } catch (e) { next(e); }
});

router.put('/variables/:vid(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    const b = req.body || {};
    const type = TYPES_VAR.includes(b.type) ? b.type : null;
    const r = await query(
      `UPDATE ecrf_variables SET
         code = $2, libelle = COALESCE($3, libelle), type = COALESCE($4, type),
         unite = $5, choix = $6, obligatoire = COALESCE($7, obligatoire),
         valeur_min = $8, valeur_max = $9, aide = $10, rang = COALESCE($11, rang)
       WHERE id = $1 RETURNING *`,
      [req.params.vid, vide(b.code), vide(b.libelle), type, vide(b.unite), vide(b.choix),
       b.obligatoire === undefined ? null : !!b.obligatoire,
       b.valeur_min != null && b.valeur_min !== '' ? b.valeur_min : null,
       b.valeur_max != null && b.valeur_max !== '' ? b.valeur_max : null,
       vide(b.aide), b.rang != null ? b.rang : null]);
    if (!r.rows.length) return res.status(404).json({ error: 'Variable introuvable.' });
    res.json({ variable: r.rows[0] });
  } catch (e) { next(e); }
});

router.delete('/variables/:vid(\\d+)', requireAuth, staff, async (req, res, next) => {
  try {
    const r = await query(`DELETE FROM ecrf_variables WHERE id = $1 RETURNING id`,
      [req.params.vid]);
    if (!r.rows.length) return res.status(404).json({ error: 'Variable introuvable.' });
    res.json({ supprimee: true });
  } catch (e) { next(e); }
});

// ============================================================
// PUT /patients/:patient_id — rattache un patient, ou l'en détache
// ------------------------------------------------------------
// `etude_id: null` signifie « aucune étude » et doit rester possible : un
// patient peut sortir d'un protocole sans sortir de la prise en charge.
// ============================================================
router.put('/patients/:patient_id', requireAuth, staff, async (req, res, next) => {
  try {
    const id = req.body && req.body.etude_id;
    const valeur = (id === null || id === undefined || id === '') ? null : Number(id);
    if (valeur !== null && !Number.isInteger(valeur)) {
      return res.status(400).json({ error: "Identifiant d'étude invalide." });
    }
    if (valeur !== null) {
      const e = await query(`SELECT id FROM etudes WHERE id = $1 AND active = TRUE`, [valeur]);
      if (!e.rows.length) return res.status(404).json({ error: 'Étude introuvable ou archivée.' });
    }
    const r = await query(
      `UPDATE patients SET etude_id = $2 WHERE id = $1 RETURNING id, etude_id`,
      [req.params.patient_id, valeur]);
    if (!r.rows.length) return res.status(404).json({ error: 'Patient introuvable.' });
    res.json({ patient: r.rows[0] });
  } catch (e) { next(e); }
});

/** Traduit les violations d'unicité en message compréhensible : « duplicate
 *  key value violates unique constraint uq_etudes_nct » n'aide personne. */
function erreurLisible(e) {
  if (e && e.code === '23505') {
    const m = String(e.constraint || '');
    if (m.includes('nct')) {
      const x = new Error('Ce numéro NCT est déjà utilisé par une autre étude.');
      x.status = 409; return x;
    }
    if (m.includes('cpp')) {
      const x = new Error('Ce numéro CPP est déjà utilisé par une autre étude.');
      x.status = 409; return x;
    }
  }
  return e;
}

module.exports = router;
