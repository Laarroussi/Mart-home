/**
 * audit.js — Journal des modifications de données cliniques
 * ==========================================================
 *
 * Toute correction d'une donnée clinique passe par ici : la valeur d'origine
 * est conservée, l'auteur et l'horodatage sont enregistrés, et un motif est
 * exigé. C'est l'exigence de l'ICH-GCP E6 §4.9.3 — une correction doit être
 * datée, attribuée, expliquée, et ne pas effacer l'entrée d'origine.
 *
 * Deux principes de mise en œuvre.
 *
 * LE MOTIF EST BLOQUANT, pas décoratif. Une modification sans motif est
 * refusée avant d'atteindre la base. Un motif facultatif n'est jamais rempli,
 * et un journal sans motifs ne répond pas à la question qu'on lui posera :
 * pourquoi cette valeur a-t-elle changé ?
 *
 * ON NE JOURNALISE QUE LES CHAMPS RÉELLEMENT MODIFIÉS. Enregistrer les
 * quarante champs d'un formulaire à chaque validation noierait les trois
 * corrections qui comptent. Les valeurs sont comparées après normalisation,
 * pour qu'un 38 et un « 38.0 » ne comptent pas comme un changement.
 */
const { query } = require('../config/database');

/**
 * Motifs normalisés. La liste est courte à dessein : un menu de vingt
 * entrées pousse à choisir la première. Ceux-ci couvrent les situations
 * réelles d'une étude clinique.
 */
const MOTIFS = {
  saisie:       "Erreur de saisie",
  lecture_doc:  "Erreur de lecture du document",
  extraction_ia:"Correction d'une extraction automatique",
  source:       "Valeur corrigée par le centre ou le document source",
  aberrante:    "Valeur aberrante écartée",
  complement:   "Complément d'information reçu",
  protocole:    "Mise en conformité au protocole",
  autre:        "Autre (préciser)"
};

class AuditError extends Error {
  constructor(message) { super(message); this.status = 400; this.name = 'AuditError'; }
}

/**
 * Vérifie le motif transmis par l'appelant.
 * @returns {{code: string, texte: string|null}}
 */
function exigerMotif(corps) {
  const c = (corps && (corps.motif_code || corps.motifCode)) || '';
  const t = ((corps && (corps.motif_texte || corps.motifTexte)) || '').trim();
  if (!c || !MOTIFS[c]) {
    throw new AuditError(
      "Motif de modification requis. Valeurs acceptées : " + Object.keys(MOTIFS).join(', '));
  }
  // « Autre » sans explication ne renseigne sur rien.
  if (c === 'autre' && t.length < 5) {
    throw new AuditError("Le motif « Autre » demande une précision d'au moins cinq caractères.");
  }
  return { code: c, texte: t || null };
}

/** Normalise une valeur pour comparaison : 38 et "38.0" sont identiques */
function normaliser(v) {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch (_) { return String(v); }
  }
  const s = String(v).trim();
  if (s === '') return null;
  // La virgule décimale doit être convertie AVANT la conversion numérique :
  // « 38,5 » saisi à la française et 38.5 venu de la base sont la même
  // valeur. Sans cela, rouvrir un formulaire sans rien changer produisait
  // une ligne d'audit — et un journal qui consigne de fausses corrections
  // devient vite illisible.
  const normalise = s.replace(',', '.');
  const n = Number(normalise);
  // Les nombres sont comparés en tant que nombres, pas en tant que texte.
  if (Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(normalise)) {
    return String(n);
  }
  return s;
}

/**
 * Compare deux états et journalise les différences.
 *
 * @param {object} p
 * @param {string} p.table        nom de la table
 * @param {string|number} p.id    identifiant de l'enregistrement
 * @param {string} p.patientId
 * @param {object} p.avant        état avant modification
 * @param {object} p.apres        champs proposés
 * @param {object} p.motif        { code, texte }
 * @param {object} p.user         req.user
 * @param {string} p.ip
 * @param {string[]} [p.ignorer]  champs techniques à ne pas journaliser
 * @returns {Promise<string[]>}   liste des champs journalisés
 */
async function journaliser({ table, id, patientId, avant, apres, motif, user, ip, ignorer, operation }) {
  const exclus = new Set(['updated_at', 'created_at', 'maj_le', 'id', ...(ignorer || [])]);
  const champs = [];

  for (const champ of Object.keys(apres || {})) {
    if (exclus.has(champ)) continue;
    const a = normaliser(avant ? avant[champ] : null);
    const b = normaliser(apres[champ]);
    if (a === b) continue;   // rien n'a changé : rien à consigner
    champs.push({ champ, a, b });
  }
  if (!champs.length) return [];

  for (const { champ, a, b } of champs) {
    await query(
      `INSERT INTO audit_donnees
         (table_cible, enregistrement, patient_id, champ,
          ancienne_valeur, nouvelle_valeur, motif_code, motif_texte,
          auteur_id, auteur_nom, auteur_role, adresse_ip, operation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [table, String(id), patientId || null, champ,
       a, b, motif.code, motif.texte,
       user && user.id, user && user.name, user && user.role,
       ip || null, operation || 'modification']
    );
  }
  return champs.map(c => c.champ);
}

/**
 * Historique d'un dossier, ou d'une valeur précise.
 * Ordonné du plus récent au plus ancien : on cherche d'abord ce qui vient
 * de changer.
 */
async function historique({ patientId, table, id, champ, limite }) {
  const conditions = [];
  const params = [];
  if (patientId) { params.push(patientId); conditions.push('patient_id = $' + params.length); }
  if (table)     { params.push(table);     conditions.push('table_cible = $' + params.length); }
  if (id != null){ params.push(String(id));conditions.push('enregistrement = $' + params.length); }
  if (champ)     { params.push(champ);     conditions.push('champ = $' + params.length); }
  params.push(Math.min(parseInt(limite, 10) || 200, 1000));

  const { rows } = await query(
    `SELECT id, table_cible, enregistrement, patient_id, champ,
            ancienne_valeur, nouvelle_valeur, motif_code, motif_texte,
            auteur_id, auteur_nom, auteur_role, fait_le, operation
       FROM audit_donnees
      ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY fait_le DESC, id DESC
      LIMIT $${params.length}`,
    params
  );
  return rows.map(r => Object.assign({}, r, { motif_libelle: MOTIFS[r.motif_code] || r.motif_code }));
}

module.exports = { MOTIFS, AuditError, exigerMotif, journaliser, historique, normaliser };
