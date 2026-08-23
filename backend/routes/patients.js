/**
 * /api/patients — CRUD patients (avec auto-création du compte patient associé)
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const { query, transaction } = require('../config/database');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

/** GET /api/patients — Liste tous les patients (avec dernière évaluation) */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    // Si patient, il ne voit que lui-même
    let sql = `
      SELECT p.*,
        (SELECT json_agg(e ORDER BY e.eval_id) FROM evaluations e WHERE e.patient_id = p.id) AS evaluations
      FROM patients p`;
    const params = [];
    const conds = [];
    if (req.user.role === 'patient' && req.user.patient_id) {
      params.push(req.user.patient_id);
      conds.push(`p.id = $${params.length}`);
    }
    // Phase 12.2 : filtre ?demo=true | false | all (défaut : all)
    const demoFilter = (req.query.demo || 'all').toLowerCase();
    if (demoFilter === 'true') {
      conds.push('p.is_demo = TRUE');
    } else if (demoFilter === 'false') {
      conds.push('p.is_demo = FALSE');
    }
    if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
    sql += ' ORDER BY p.id';
    const { rows } = await query(sql, params);
    res.json({ patients: rows });
  } catch (err) { next(err); }
});

/** GET /api/patients/:id — Détail patient + ses évaluations + éducation */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'patient' && req.user.patient_id !== req.params.id) {
      return res.status(403).json({ error: 'Accès refusé' });
    }
    const patient = await query('SELECT * FROM patients WHERE id = $1', [req.params.id]);
    if (!patient.rows.length) return res.status(404).json({ error: 'Patient introuvable' });

    const [evals, notifs, edu] = await Promise.all([
      query('SELECT * FROM evaluations WHERE patient_id = $1 ORDER BY eval_id', [req.params.id]),
      query('SELECT * FROM notifications WHERE patient_id = $1 ORDER BY sent_date DESC NULLS LAST', [req.params.id]),
      query('SELECT * FROM education_records WHERE patient_id = $1', [req.params.id])
    ]);
    res.json({
      patient: patient.rows[0],
      evaluations: evals.rows,
      notifications: notifs.rows,
      education: edu.rows
    });
  } catch (err) { next(err); }
});

/** POST /api/patients — Crée un patient + son compte utilisateur + envoi auto SF-36/GPAQ */
router.post('/', requireAuth, requireRole('principal_admin', 'investigator'), async (req, res, next) => {
  try {
    const p = req.body || {};
    if (!p.id || !p.sex || !p.age || !p.gene) {
      return res.status(400).json({ error: 'id, sex, age, gene requis' });
    }
    const exists = await query('SELECT id FROM patients WHERE id = $1', [p.id]);
    if (exists.rows.length) return res.status(409).json({ error: 'Code patient déjà utilisé' });

    const result = await transaction(async (client) => {
      // 1. Crée la fiche patient
      await client.query(
        `INSERT INTO patients (id, sex, age, gene, aorta, status, status_class, progress, connected,
                               risk_factor, risk_comment, alterations, incidents, civil, medical, study, created_by, is_demo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [p.id, p.sex, p.age, p.gene, p.aorta || null,
         p.status || 'Stable', p.statusClass || 'ok', p.progress || 75, p.connected || false,
         p.riskFactor || '', p.riskComment || '',
         p.alterations || [], p.incidents || [],
         JSON.stringify(p.civil || {}), JSON.stringify(p.medical || {}), JSON.stringify(p.study || {}),
         req.user.id, p.is_demo === true /* défaut : FALSE = vrai patient */]
      );
      // 2. Crée la première évaluation (Baseline)
      if (p.evaluations && p.evaluations.length) {
        for (const ev of p.evaluations) {
          await client.query(
            `INSERT INTO evaluations (patient_id, eval_id, label, eval_date, vo2, force_kg, aorta, sf36, gpaq, validated, note)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [p.id, ev.id || 1, ev.label || 'Baseline', ev.date, ev.vo2, ev.force, ev.aorta, ev.sf36, ev.gpaq, ev.validated !== false, ev.note || '']
          );
        }
      }
      // 3. Crée le compte utilisateur patient (mot de passe = code patient en minuscule, à changer)
      const userId = 'u-pat-' + p.id;
      const defaultPwd = (p.id + '!Marfan').toLowerCase();
      const hash = await bcrypt.hash(defaultPwd, parseInt(process.env.BCRYPT_ROUNDS, 10) || 10);
      // FIX : l'email du patient peut déjà exister (contrainte UNIQUE) — par ex. si
      // l'investigateur saisit sa propre adresse. Sans ce garde-fou, la violation de
      // contrainte annulait TOUTE la transaction et le patient n'était jamais créé.
      let patientEmail = (p.civil && p.civil.email) || (p.id.toLowerCase() + '@example.fr');
      const emailTaken = await client.query('SELECT id FROM users WHERE email = $1', [patientEmail]);
      if (emailTaken.rows.length) {
        patientEmail = p.id.toLowerCase() + '.' + Date.now() + '@marfan-apa.local';
      }
      await client.query(
        `INSERT INTO users (id, role, name, email, password_hash, patient_id, created_by)
         VALUES ($1, 'patient', $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [userId,
         (p.civil && p.civil.initials) || p.id,
         patientEmail,
         hash, p.id, req.user.id]
      );
      // 4. Notifications obligatoires SF-36 + GPAQ
      // FIX : ces requêtes étaient lancées dans un forEach(async) NON attendu, donc
      // exécutées après la fin de la transaction (client déjà relâché) → erreurs.
      const today = new Date().toISOString().slice(0, 10);
      for (const type of ['sf36', 'gpaq']) {
        await client.query(
          `INSERT INTO notifications (id, patient_id, type, label, source, sent_date)
           VALUES ($1,$2,$3,$4,'inclusion',$5)
           ON CONFLICT (id) DO NOTHING`,
          ['n-' + p.id + '-' + type + '-incl',
           p.id, type,
           type === 'sf36' ? 'Questionnaire SF-36 (qualité de vie)' : 'Questionnaire GPAQ (activité physique)',
           today]
        );
      }
      // 5. Log
      await client.query(
        `INSERT INTO notification_log (user_id, patient_id, action, details, ip_address)
         VALUES ($1, $2, 'create-patient', $3, $4)`,
        [req.user.id, p.id, JSON.stringify({ defaultPassword: defaultPwd }), req.ip]
      );
      return { id: p.id, userId, defaultPassword: defaultPwd };
    });

    res.status(201).json({
      success: true,
      patient: result,
      message: `Patient créé. Compte associé : ${result.userId}. Mot de passe initial communiqué (à changer dès la 1ʳᵉ connexion).`
    });
  } catch (err) { next(err); }
});

/** PATCH /api/patients/:id */
router.patch('/:id', requireAuth, requireRole('principal_admin', 'investigator'), async (req, res, next) => {
  try {
    const allowed = ['sex','age','gene','aorta','status','status_class','progress','connected','risk_factor','risk_comment','alterations','incidents','civil','medical','study'];
    const fields = []; const params = [];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        params.push(['civil','medical','study'].includes(k) ? JSON.stringify(req.body[k]) : req.body[k]);
        fields.push(`${k} = $${params.length}`);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'Rien à modifier' });
    params.push(req.params.id);
    const { rows } = await query(
      `UPDATE patients SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ error: 'Patient introuvable' });
    res.json({ patient: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
