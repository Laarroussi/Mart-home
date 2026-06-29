/**
 * /api/questionnaires — Gestion des questionnaires validés (SF-36, GPAQ)
 *
 * Workflow :
 *   - À la création d'un compte patient, 2 réponses pending mandatory sont créées
 *     automatiquement (1 SF-36 + 1 GPAQ) — voir migration 008
 *   - Le staff peut envoyer un nouveau questionnaire (POST /send)
 *   - Le patient récupère ses pending (GET /mine) et les soumet (POST /:id/submit)
 *   - Au submit, le scoring officiel est calculé côté serveur (sécurité)
 *
 * Permissions :
 *   - patient : voit ses propres réponses, soumet, ne peut pas créer
 *   - staff   : envoie, voit tout (de ses patients pour investigator)
 */
const express = require('express');
const { query } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();

// ============================================================
// Scoring côté serveur (en dur, pour ne pas faire confiance au client)
// ============================================================
function scoreSF36(answers) {
  if (!answers) return null;
  const r = {};
  const t3 = { 1: 0, 2: 50, 3: 100 };
  const t2 = { 1: 0, 2: 100 };
  const fiveUp = { 1: 100, 2: 75, 3: 50, 4: 25, 5: 0 };
  const fiveDown = { 1: 0, 2: 25, 3: 50, 4: 75, 5: 100 };
  const sixUp = { 1: 100, 2: 80, 3: 60, 4: 40, 5: 20, 6: 0 };
  const sixDown = { 1: 0, 2: 20, 3: 40, 4: 60, 5: 80, 6: 100 };
  ['q3','q4','q5','q6','q7','q8','q9','q10','q11','q12'].forEach(q => r[q] = t3[answers[q]]);
  ['q13','q14','q15','q16','q17','q18','q19'].forEach(q => r[q] = t2[answers[q]]);
  r.q20 = fiveDown[answers.q20];
  r.q32 = fiveDown[answers.q32];
  r.q21 = sixUp[answers.q21];
  r.q22 = fiveUp[answers.q22];
  r.q1  = fiveUp[answers.q1];
  r.q33 = fiveDown[answers.q33];
  r.q34 = fiveUp[answers.q34];
  r.q35 = fiveDown[answers.q35];
  r.q36 = fiveUp[answers.q36];
  r.q23 = sixUp[answers.q23];
  r.q27 = sixUp[answers.q27];
  r.q29 = sixDown[answers.q29];
  r.q31 = sixDown[answers.q31];
  r.q24 = sixDown[answers.q24];
  r.q25 = sixDown[answers.q25];
  r.q26 = sixUp[answers.q26];
  r.q28 = sixDown[answers.q28];
  r.q30 = sixUp[answers.q30];

  function avg(items) {
    const vals = items.map(q => r[q]).filter(v => v != null && !isNaN(v));
    if (!vals.length) return null;
    return Math.round(vals.reduce((a,b) => a+b, 0) / vals.length * 10) / 10;
  }
  return {
    PF: avg(['q3','q4','q5','q6','q7','q8','q9','q10','q11','q12']),
    RP: avg(['q13','q14','q15','q16']),
    BP: avg(['q21','q22']),
    GH: avg(['q1','q33','q34','q35','q36']),
    VT: avg(['q23','q27','q29','q31']),
    SF: avg(['q20','q32']),
    RE: avg(['q17','q18','q19']),
    MH: avg(['q24','q25','q26','q28','q30']),
    transition: answers.q2 || null
  };
}

function scoreGPAQ(a) {
  if (!a) return null;
  const work_vig = (a.g1 == 1) ? 8 * (parseInt(a.g2,10)||0) * (parseInt(a.g3,10)||0) : 0;
  const work_mod = (a.g4 == 1) ? 4 * (parseInt(a.g5,10)||0) * (parseInt(a.g6,10)||0) : 0;
  const work_metmin = work_vig + work_mod;
  const transport_metmin = (a.g7 == 1) ? 4 * (parseInt(a.g8,10)||0) * (parseInt(a.g9,10)||0) : 0;
  const leisure_vig = (a.g10 == 1) ? 8 * (parseInt(a.g11,10)||0) * (parseInt(a.g12,10)||0) : 0;
  const leisure_mod = (a.g13 == 1) ? 4 * (parseInt(a.g14,10)||0) * (parseInt(a.g15,10)||0) : 0;
  const leisure_metmin = leisure_vig + leisure_mod;
  const total_metmin = work_metmin + transport_metmin + leisure_metmin;
  const sedentary_min_per_day = parseInt(a.g16, 10) || 0;
  let activity_level = 'low';
  if (total_metmin >= 3000) activity_level = 'high';
  else if (total_metmin >= 600) activity_level = 'moderate';
  return { work_metmin, transport_metmin, leisure_metmin, total_metmin,
           sedentary_min_per_day, activity_level };
}

// ============================================================
// GET /api/questionnaires/mine — Réponses du patient connecté
// ============================================================
router.get('/mine', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== ROLE.PATIENT || !req.user.patient_id) {
      return res.status(403).json({ error: 'Réservé aux patients' });
    }
    const { rows } = await query(
      `SELECT id, questionnaire_type, sent_at, sent_by, due_date, completed_at, status, mandatory, scores, notes
         FROM questionnaire_responses
        WHERE patient_id = $1
        ORDER BY sent_at DESC`,
      [req.user.patient_id]
    );
    res.json({ responses: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/questionnaires/pending — Réponses pending du patient (à remplir)
// ============================================================
router.get('/pending', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== ROLE.PATIENT || !req.user.patient_id) {
      return res.status(403).json({ error: 'Réservé aux patients' });
    }
    const { rows } = await query(
      `SELECT id, questionnaire_type, sent_at, due_date, mandatory, notes
         FROM questionnaire_responses
        WHERE patient_id = $1 AND status = 'pending'
        ORDER BY mandatory DESC, sent_at ASC`,
      [req.user.patient_id]
    );
    res.json({ pending: rows });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/questionnaires/:id — Détail (avec raw_answers si complété)
// ============================================================
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query('SELECT * FROM questionnaire_responses WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Questionnaire introuvable' });
    const resp = rows[0];
    if (req.user.role === ROLE.PATIENT && resp.patient_id !== req.user.patient_id) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    res.json({ response: resp });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/questionnaires/send — Staff envoie un questionnaire à un patient
// Body : { patient_id, questionnaire_type ('sf36'|'gpaq'), due_date?, notes?, mandatory? }
// ============================================================
router.post('/send', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    const { patient_id, questionnaire_type, due_date, notes, mandatory } = req.body || {};
    if (!patient_id) return res.status(400).json({ error: 'patient_id requis' });
    if (!['sf36','gpaq'].includes(questionnaire_type)) {
      return res.status(400).json({ error: 'questionnaire_type doit être sf36 ou gpaq' });
    }
    const { rows } = await query(
      `INSERT INTO questionnaire_responses
         (patient_id, questionnaire_type, sent_by, due_date, status, mandatory, notes)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       RETURNING *`,
      [patient_id, questionnaire_type, req.user.id, due_date || null, !!mandatory, notes || null]
    );
    res.status(201).json({ response: rows[0] });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/questionnaires/:id/submit — Patient soumet ses réponses
// Body : { answers: { qN: valeur, ... } }
// Le serveur recalcule les scores selon les barèmes officiels (sécurité)
// ============================================================
router.post('/:id/submit', requireAuth, async (req, res, next) => {
  try {
    const { answers } = req.body || {};
    if (!answers || typeof answers !== 'object') return res.status(400).json({ error: 'answers requis' });

    // Vérifie ownership
    const r0 = await query('SELECT * FROM questionnaire_responses WHERE id = $1', [req.params.id]);
    if (!r0.rows.length) return res.status(404).json({ error: 'Questionnaire introuvable' });
    const q = r0.rows[0];
    if (req.user.role === ROLE.PATIENT && q.patient_id !== req.user.patient_id) {
      return res.status(403).json({ error: 'Accès interdit' });
    }
    if (q.status === 'completed') return res.status(409).json({ error: 'Déjà complété' });

    // Scoring
    let scores;
    if (q.questionnaire_type === 'sf36') scores = scoreSF36(answers);
    else if (q.questionnaire_type === 'gpaq') scores = scoreGPAQ(answers);

    const { rows } = await query(
      `UPDATE questionnaire_responses
          SET raw_answers = $1, scores = $2, status = 'completed', completed_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [JSON.stringify(answers), JSON.stringify(scores), req.params.id]
    );
    res.json({ response: rows[0], scores });
  } catch (err) { next(err); }
});

// ============================================================
// GET /api/questionnaires — Staff : liste filtrable
// Filtres : ?patient_id=..., ?type=sf36|gpaq, ?status=...
// ============================================================
router.get('/', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN, ROLE.INVESTIGATOR), async (req, res, next) => {
  try {
    let sql = `SELECT id, patient_id, questionnaire_type, sent_at, sent_by, due_date,
                      completed_at, status, mandatory, scores
                 FROM questionnaire_responses WHERE 1=1`;
    const params = [];
    if (req.query.patient_id) { params.push(req.query.patient_id); sql += ` AND patient_id = $${params.length}`; }
    if (req.query.type)       { params.push(req.query.type); sql += ` AND questionnaire_type = $${params.length}`; }
    if (req.query.status)     { params.push(req.query.status); sql += ` AND status = $${params.length}`; }
    sql += ' ORDER BY sent_at DESC LIMIT 500';
    const { rows } = await query(sql, params);
    res.json({ responses: rows });
  } catch (err) { next(err); }
});

module.exports = router;
