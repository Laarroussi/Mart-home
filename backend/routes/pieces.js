/**
 * /api/pieces — Pièces versées par les patients
 * ==============================================
 *   POST /mes-documents       → le patient dépose une pièce (patient)
 *   GET  /mes-documents       → ce qu'il a déposé et où cela en est (patient)
 *   GET  /a-valider           → file d'attente du soignant (staff)
 *   GET  /:id                 → détail d'une pièce et de son analyse (staff)
 *   POST /:id/valider         → retient les faits cochés (staff)
 *   POST /:id/rejeter         → écarte la pièce, avec motif (staff)
 *
 * PRINCIPE : rien de ce qu'un patient dépose n'entre dans la base avant
 * relecture. La pièce est lue immédiatement — pour que le travail soit fait
 * quand le soignant l'ouvre — mais ses données restent en attente.
 *
 * Ce n'est pas de la défiance envers le patient. C'est que la lecture est
 * automatique : elle se trompe, et une erreur devenue donnée d'étude ne se
 * rattrape plus. S'ajoute le cas banal du compte rendu d'un proche déposé
 * par inadvertance.
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');
const ia = require('../config/ai');
const { synchroniser } = require('../utils/sync-evaluations');

const router = express.Router();
const staff = requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR);

const TAILLE_MAX_KO = 10 * 1024;

// ============================================================
// POST /mes-documents — dépôt par le patient
// ============================================================
router.post('/mes-documents', requireAuth, async (req, res, next) => {
  try {
    const pid = req.user.patient_id;
    if (req.user.role !== ROLE.PATIENT || !pid) {
      return res.status(403).json({ error: 'Réservé aux participants.' });
    }
    const { fichier_base64, mime, nom, texte, commentaire } = req.body || {};
    if (!fichier_base64 && !texte) {
      return res.status(400).json({ error: 'Aucun document reçu.' });
    }
    const tailleKo = fichier_base64
      ? Math.round(Buffer.byteLength(fichier_base64, 'base64') / 1024) : 0;
    if (tailleKo > TAILLE_MAX_KO) {
      return res.status(413).json({
        error: 'Document trop volumineux (' + Math.round(tailleKo / 1024) + ' Mo). Maximum 10 Mo.'
      });
    }

    // La pièce est enregistrée AVANT l'analyse : si la lecture échoue, le
    // dépôt du patient n'est pas perdu et le soignant voit qu'il a essayé.
    const ins = await query(
      `INSERT INTO pieces_patients (patient_id, nom_fichier, mime, taille_ko, commentaire, statut)
       VALUES ($1,$2,$3,$4,$5,'en_attente') RETURNING id, deposee_le`,
      [pid, nom || null, mime || null, tailleKo || null,
       (commentaire || '').slice(0, 1000) || null]
    );
    const pieceId = ins.rows[0].id;

    // --- Lecture ---
    let texteFinal = (texte || '').trim();
    let erreur = null;
    try {
      if ((!texteFinal || texteFinal.length < 20) && fichier_base64) {
        const r = await ia.ocrDocument(fichier_base64, mime || 'application/pdf');
        texteFinal = r.texte || '';
      }
      if (!texteFinal || texteFinal.trim().length < 20) {
        erreur = "Aucun texte exploitable n'a pu être lu dans ce document.";
      }
    } catch (e) {
      erreur = 'Lecture impossible : ' + e.message;
    }

    // --- Analyse ---
    let analyse = { faits: [], echo: null };
    if (!erreur) {
      try {
        // Identité masquée : le patient est connu, inutile de transmettre son
        // nom à un service externe pour analyser son propre compte rendu.
        const p = await query('SELECT civil FROM patients WHERE id = $1', [pid]);
        const masque = ia.pseudonymiser(texteFinal,
          { civil: (p.rows[0] && p.rows[0].civil) || {} });

        const r = await ia.analyserTexte(masque);
        analyse.faits = r.faits || [];

        if (/échocardiograph|echocardiograph|\bETT\b|valsalva|FEVG/i.test(texteFinal)) {
          try {
            const e = await ia.analyserEcho(masque);
            if (e.est_echo) analyse.echo = e.echo;
          } catch (_) { /* l'échec de l'écho ne doit pas perdre les faits */ }
        }
      } catch (e) {
        erreur = "Analyse impossible : " + e.message;
      }
    }

    await query(
      `UPDATE pieces_patients
          SET texte_source = $2, analyse = $3, nb_faits = $4,
              erreur_lecture = $5, statut = $6
        WHERE id = $1`,
      [pieceId, texteFinal || null, JSON.stringify(analyse),
       (analyse.faits || []).length, erreur, erreur ? 'erreur' : 'en_attente']
    );

    // Le patient n'a pas à connaître le détail de ce qui a été extrait : ce
    // sont des données cliniques non vérifiées, et les lui montrer
    // reviendrait à lui restituer une interprétation automatique de son
    // dossier. On confirme la réception, rien de plus.
    res.status(201).json({
      id: pieceId,
      depose_le: ins.rows[0].deposee_le,
      statut: erreur ? 'erreur' : 'en_attente',
      message: erreur
        ? "Document reçu, mais sa lecture automatique a échoué. Votre référent le consultera."
        : "Document bien reçu. Votre référent le relira et l'intégrera à votre dossier."
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /mes-documents — suivi par le patient
// ============================================================
router.get('/mes-documents', requireAuth, async (req, res, next) => {
  try {
    const pid = req.user.patient_id;
    if (req.user.role !== ROLE.PATIENT || !pid) {
      return res.status(403).json({ error: 'Réservé aux participants.' });
    }
    const { rows } = await query(
      `SELECT id, nom_fichier, commentaire, statut, deposee_le, traitee_le
         FROM pieces_patients WHERE patient_id = $1
        ORDER BY deposee_le DESC LIMIT 50`, [pid]);
    // Vocabulaire tourné vers le patient : « en attente » n'a pas le même
    // sens pour lui que pour le soignant.
    const LISIBLE = {
      en_attente: 'Reçu — en attente de relecture par votre référent',
      validee:    'Intégré à votre dossier',
      rejetee:    'Non retenu — votre référent vous expliquera',
      erreur:     'Reçu, mais illisible automatiquement'
    };
    res.json({
      pieces: rows.map(r => Object.assign({}, r, { statut_libelle: LISIBLE[r.statut] || r.statut }))
    });
  } catch (err) { next(err); }
});

// ============================================================
// GET /a-valider — file d'attente du soignant
// ============================================================
router.get('/a-valider', requireAuth, staff, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT p.id, p.patient_id, p.nom_fichier, p.commentaire, p.statut,
              p.nb_faits, p.erreur_lecture, p.deposee_le,
              pa.civil->>'lastName' AS nom, pa.civil->>'firstName' AS prenom
         FROM pieces_patients p
         LEFT JOIN patients pa ON pa.id = p.patient_id
        WHERE p.statut IN ('en_attente', 'erreur')
        ORDER BY p.deposee_le ASC`);
    res.json({ pieces: rows, total: rows.length });
  } catch (err) { next(err); }
});

// ============================================================
// GET /:id — détail et analyse, pour relecture
// ============================================================
router.get('/:id', requireAuth, staff, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM pieces_patients WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Pièce introuvable' });
    res.json({ piece: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /:id/valider — retient les faits cochés par le soignant
// Body : { faits: [...], echo: {...}|null }
// ============================================================
router.post('/:id/valider', requireAuth, staff, async (req, res, next) => {
  try {
    const p = await query('SELECT * FROM pieces_patients WHERE id = $1', [req.params.id]);
    if (!p.rows.length) return res.status(404).json({ error: 'Pièce introuvable' });
    const piece = p.rows[0];
    if (piece.statut === 'validee') {
      return res.status(409).json({ error: 'Cette pièce a déjà été traitée.' });
    }

    const faits = Array.isArray(req.body && req.body.faits) ? req.body.faits : [];
    let enregistres = 0;

    for (const f of faits) {
      if (!f || !f.label) continue;
      await query(
        `INSERT INTO medical_timeline
           (patient_id, event_date, date_precision, category, label, value_num,
            value_text, unit, detail, source_extrait, confiance, statut,
            created_by, source_role, piece_patient_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'valide',$12,'patient',$13)`,
        [piece.patient_id,
         /^\d{4}-\d{2}-\d{2}$/.test(f.event_date || '') ? f.event_date : null,
         ['jour','mois','annee','inconnue'].includes(f.date_precision) ? f.date_precision : 'inconnue',
         ['mesure','biologie','traitement','operation','examen','diagnostic','autre']
           .includes(f.category) ? f.category : 'autre',
         String(f.label).slice(0, 200),
         f.value_num != null && Number.isFinite(Number(f.value_num)) ? Number(f.value_num) : null,
         f.value_text != null ? String(f.value_text).slice(0, 500) : null,
         f.unit != null ? String(f.unit).slice(0, 30) : null,
         f.detail != null ? String(f.detail).slice(0, 800) : null,
         f.source_extrait != null ? String(f.source_extrait).slice(0, 800) : null,
         f.confiance != null ? Number(f.confiance) : null,
         req.user.id, piece.id]
      );
      enregistres++;
    }

    await query(
      `UPDATE pieces_patients
          SET statut = 'validee', traitee_le = NOW(), traitee_par = $2, nb_faits_retenus = $3
        WHERE id = $1`,
      [piece.id, req.user.id, enregistres]);

    // Les mesures datées retenues alimentent les courbes, comme une pièce
    // versée par le soignant lui-même.
    let sync = null;
    try { sync = await synchroniser(piece.patient_id, req.user.id); }
    catch (e) { console.warn('[pieces] synchronisation :', e.message); }

    res.json({ enregistres, sync });
  } catch (err) { next(err); }
});

// ============================================================
// POST /:id/rejeter — écarte la pièce
// ============================================================
router.post('/:id/rejeter', requireAuth, staff, async (req, res, next) => {
  try {
    const motif = ((req.body && req.body.motif) || '').trim();
    // Un rejet sans motif est inexploitable : le patient a fait une démarche,
    // et le dossier doit garder trace de la raison du refus.
    if (motif.length < 5) {
      return res.status(400).json({ error: 'Motif du rejet requis (cinq caractères au minimum).' });
    }
    const r = await query(
      `UPDATE pieces_patients
          SET statut = 'rejetee', traitee_le = NOW(), traitee_par = $2, motif_rejet = $3
        WHERE id = $1 AND statut <> 'validee' RETURNING id`,
      [req.params.id, req.user.id, motif.slice(0, 500)]);
    if (!r.rows.length) {
      return res.status(404).json({ error: 'Pièce introuvable ou déjà validée.' });
    }
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
