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
const { analyserTexte, analyserEcho, analyserIdentite, ocrDocument, transcrireAudio,
        pseudonymiser, statutIA, CHAMPS_NUM_ECHO, CHAMPS_TXT_ECHO } = require('../config/ai');

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
    const { doc_id, fichier_base64, mime, avec_identite } = req.body || {};
    let texte = (req.body && req.body.texte) || '';
    let ocrInfo = null;

    // Enregistrement sonore : entretien, dictée. On le transcrit d'abord, puis
    // le texte obtenu suit exactement le même chemin qu'un compte rendu écrit.
    const estAudio = /^audio\//i.test(mime || '') ||
                     /\.(mp3|m4a|wav|ogg|opus|webm|aac|flac)$/i.test(req.body.nom_fichier || '');
    if (estAudio && fichier_base64) {
      try {
        const r = await transcrireAudio(fichier_base64, mime, req.body.nom_fichier);
        texte = r.texte || '';
        ocrInfo = { modele: r.modele, duree_ms: r.duree_ms, type: 'transcription',
                    secondes_audio: r.secondes_audio };
      } catch (e) {
        const code = e.code === 'NO_KEY' ? 503 : 502;
        return res.status(code).json({ error: 'Transcription impossible : ' + e.message });
      }
    }
    // Document scanné : aucun texte extractible côté navigateur.
    // On passe alors par l'OCR de Mistral, qui lit les PDF image et les photos.
    else if ((!texte || String(texte).trim().length < 20) && fichier_base64) {
      try {
        const r = await ocrDocument(fichier_base64, mime || 'application/pdf');
        texte = r.texte || '';
        ocrInfo = { pages: r.pages, modele: r.modele, duree_ms: r.duree_ms, type: 'ocr' };
      } catch (e) {
        const code = e.code === 'NO_KEY' ? 503 : 502;
        return res.status(code).json({ error: "Lecture OCR impossible : " + e.message });
      }
    }

    if (!texte || String(texte).trim().length < 20) {
      return res.status(400).json({ error: "Le document ne contient aucun texte exploitable, même après lecture optique." });
    }

    // Récupère l'identité pour pouvoir la masquer
    const p = await query('SELECT civil FROM patients WHERE id = $1', [req.params.patient_id]);
    const patient = p.rows.length ? { civil: p.rows[0].civil || {} } : { civil: {} };

    // Mode « création de fiche » : l'identité doit être lue pour pré-remplir le
    // formulaire, elle n'est donc pas masquée. Ce mode est explicitement demandé
    // par l'appelant et réservé à un patient pas encore enregistré.
    // Cette route n'écrit RIEN en base : elle renvoie une proposition. Refuser
    // de lire l'identité au motif que le code patient existe déjà n'protégeait
    // donc rien, et privait le clinicien du pré-remplissage à chaque fois qu'un
    // code était déjà pris. Le pré-remplissage ne touche de toute façon que les
    // champs restés vides.
    const modeIdentite = avec_identite === true;

    // La pseudonymisation reste appliquée à l'analyse chronologique dès lors que
    // le patient existe : c'est elle qui protège les dossiers déjà constitués.
    // Seule la lecture de l'en-tête travaille sur le texte d'origine, puisqu'il
    // s'agit précisément d'y trouver un nom.
    const texteMasque = (modeIdentite && !p.rows.length)
      ? texte
      : pseudonymiser(texte, patient);

    let identite = null;
    let identiteErreur = null;
    if (modeIdentite) {
      try {
        const ri = await analyserIdentite(texte);
        identite = ri.identite;
        // Une identité dont tous les champs sont vides n'est pas une identité :
        // autant le dire, plutôt que d'afficher « 0 champ prérempli » sans raison.
        const utiles = ['nom', 'prenom', 'ipp', 'date_naissance', 'sexe', 'age', 'centre', 'medecin'];
        if (!utiles.some(k => identite && identite[k] != null)) {
          identiteErreur = "L'en-tête du document n'a pas permis de lire le nom, le prénom ni la date de naissance.";
        }
      } catch (e) {
        console.warn('[identite] extraction échouée :', e.message);
        // Renvoyée à l'interface : jusqu'ici l'échec était silencieux, et le
        // clinicien concluait que la fonction ne marchait pas.
        identiteErreur = e.message;
      }
    }
    // Avertissement sans blocage : le code proposé est déjà pris, la
    // validation échouerait. Autant le signaler tout de suite.
    if (modeIdentite && p.rows.length) {
      identiteErreur = (identiteErreur ? identiteErreur + ' ' : '') +
        "Attention : le code patient " + req.params.patient_id +
        " est déjà utilisé. Changez-le avant d'enregistrer la fiche.";
    }

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

    // Si le document ressemble à une échocardiographie, on lance en plus
    // l'extraction structurée dédiée (une ligne de tableau par examen).
    let echo = null;
    const ressembleEtt = /échocardiograph|echocardiograph|\bETT\b|valsalva|FEVG|transthoracique/i.test(texte);
    if (ressembleEtt) {
      try {
        const r = await analyserEcho(texteMasque);
        if (r.est_echo) echo = r.echo;
      } catch (e) { console.warn('[echo] extraction structurée échouée :', e.message); }
    }

    // Génétique : recherche déterministe dans le TEXTE COMPLET du document.
    // Chercher dans les faits déjà extraits ne suffisait pas — le gène est
    // souvent cité dans une phrase d'antécédents que l'IA ne retient pas
    // comme un « fait » à part entière.
    const GENES = ['FBN1', 'TGFBR1', 'TGFBR2', 'SMAD3', 'TGFB2', 'TGFB3',
                   'ACTA2', 'MYH11', 'MYLK', 'LOX', 'COL3A1', 'PLOD1'];
    const genetique = { gene: null, variant: null };
    for (const g of GENES) {
      if (new RegExp('\\b' + g + '\\b', 'i').test(texte)) { genetique.gene = g; break; }
    }
    // Notation HGVS : c.2678G>A, p.Cys893Tyr…
    const mv = texte.match(/\b([cp]\.[A-Za-z0-9_>+*()-]{3,40})/);
    if (mv) genetique.variant = mv[1];

    res.json({
      faits: resultat.faits,
      echo,                               // non nul si compte-rendu d'ETT reconnu
      genetique,                          // gène et variant lus dans le document
      identite,                           // non nul en mode création de fiche
      identite_erreur: identiteErreur,    // raison lisible si l'identité n'a pas pu être lue
      modele: resultat.modele,
      duree_ms: resultat.duree_ms,
      pseudonymise: !modeIdentite,
      ocr: ocrInfo,                       // non nul si le document a dû être lu par OCR
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

// ============================================================
// === ÉCHOCARDIOGRAPHIE : une ligne de tableau par examen ====
// ============================================================

// GET /:patient_id/echo — tous les examens du patient
router.get('/:patient_id/echo', requireAuth, async (req, res, next) => {
  try {
    if (!peutLire(req.user, req.params.patient_id)) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    const { rows } = await query(
      `SELECT * FROM echo_reports WHERE patient_id = $1
        ORDER BY exam_date DESC NULLS LAST, id DESC`,
      [req.params.patient_id]
    );
    res.json({ examens: rows });
  } catch (err) { next(err); }
});

// POST /:patient_id/echo — enregistre un examen validé par le soignant
router.post('/:patient_id/echo', requireAuth, async (req, res, next) => {
  try {
    if (!peutEcrire(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const e = req.body && req.body.echo;
    if (!e) return res.status(400).json({ error: 'Aucune donnée à enregistrer' });

    const colonnes = ['exam_date'].concat(CHAMPS_NUM_ECHO.filter(c => c !== 'confiance'))
                                  .concat(CHAMPS_TXT_ECHO)
                                  .concat(['confiance', 'source_nom_fichier', 'source_doc_id']);
    const valeurs = colonnes.map(c => (e[c] === undefined || e[c] === '') ? null : e[c]);
    colonnes.push('patient_id'); valeurs.push(req.params.patient_id);
    colonnes.push('created_by');  valeurs.push(req.user.id);

    const params = valeurs.map((_, i) => '$' + (i + 1)).join(',');
    const { rows } = await query(
      `INSERT INTO echo_reports (${colonnes.join(',')}) VALUES (${params}) RETURNING *`,
      valeurs
    );

    // L'antécédent chirurgical aortique remonte sur la fiche patient,
    // car c'est une information à voir immédiatement à l'ouverture du dossier.
    if (e.aorte_operee === true) {
      await query(
        `UPDATE patients SET aorte_operee = TRUE,
            aorte_operee_date = COALESCE($2, aorte_operee_date),
            aorte_operee_type = COALESCE($3, aorte_operee_type)
          WHERE id = $1`,
        [req.params.patient_id, e.aorte_operee_date || null, e.aorte_operee_type || null]
      ).catch(() => {});
    }

    // Le diamètre des sinus alimente le suivi aortique « évaluation actuelle »
    if (e.sinus_valsalva_mm != null) {
      await query(
        `INSERT INTO medical_records (patient_id, aortic_followup)
         VALUES ($1, jsonb_build_object('current_value_mm', $2::numeric,
                                        'current_date', COALESCE($3::date, CURRENT_DATE),
                                        'current_site', 'Sinus de Valsalva'))
         ON CONFLICT (patient_id) DO UPDATE
           SET aortic_followup = COALESCE(medical_records.aortic_followup, '{}'::jsonb) ||
               jsonb_build_object('current_value_mm', $2::numeric,
                                  'current_date', COALESCE($3::date, CURRENT_DATE),
                                  'current_site', 'Sinus de Valsalva'),
               updated_at = NOW()`,
        [req.params.patient_id, e.sinus_valsalva_mm, e.exam_date || null]
      ).catch(err => console.warn('[echo] maj suivi aortique :', err.message));
    }

    res.status(201).json({ examen: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /:patient_id/echo/:id
router.delete('/:patient_id/echo/:id', requireAuth, async (req, res, next) => {
  try {
    if (!peutEcrire(req.user)) return res.status(403).json({ error: 'Accès interdit' });
    const r = await query('DELETE FROM echo_reports WHERE id=$1 AND patient_id=$2',
      [req.params.id, req.params.patient_id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Introuvable' });
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
