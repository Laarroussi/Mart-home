/**
 * Seed initial : crée admin + investigateur principal + capsules éducation
 * + 20 patients démo avec leurs évaluations + comptes patient.
 *
 * Usage : npm run db:seed
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { query, pool } = require('../config/database');

const ROUNDS = parseInt(process.env.BCRYPT_ROUNDS, 10) || 10;

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@marfan-apa.fr';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangezMoiTresFort123!';

const CAPSULES = [
  { id:'cap-marfan', title:'Comprendre le syndrome de Marfan', theme:'Aorte · Génétique', duration:'3 min',
    description:'Capsule sur le rôle de l\'aorte, le gène FBN1 et l\'importance du suivi médical.',
    english:'Understanding Marfan syndrome',
    image:'https://images.unsplash.com/photo-1559757175-5700dde675bc?auto=format&fit=crop&w=720&q=70',
    pre:{items:5, questions:['Savez-vous quel gène est le plus souvent muté ?','Connaissez-vous la fibrilline-1 ?','Quels organes sont touchés ?','À quelle fréquence un suivi cardiologique ?','Connaissez-vous les modes de transmission ?']},
    post:{items:5, questions:['Le syndrome est-il principalement génétique ?','Quel diamètre aortique nécessite vigilance ?','Citez 2 examens du suivi annuel.','Quelle transmission héréditaire ?','Quels sports éviter ?']}},
  { id:'cap-apa', title:'Activité physique sécurisée', theme:'APA · Intensité', duration:'4 min',
    description:'Repères pour choisir une intensité adaptée.',
    english:'Safe adapted physical activity',
    image:'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=720&q=70',
    pre:{items:4, questions:['Estimez votre niveau d\'activité','Connaissez-vous Borg ?','Quelles activités éviter ?','Quels signes stoppent l\'effort ?']},
    post:{items:6, questions:['Intensité max recommandée ?','Citez 3 activités sûres','Citez 3 contre-indiquées','Seuil FC à respecter ?','Signes d\'arrêt','Échauffement conseillé']}},
  { id:'cap-alert', title:'Signes d\'alerte', theme:'Auto-surveillance', duration:'2 min',
    description:'Quand prévenir l\'équipe.',
    english:'Warning signs',
    image:'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=720&q=70',
    pre:{items:4, questions:['Identifier une douleur thoracique','Signes nécessitant un appel','Connaissez-vous le 15 ?','Conduite en cas de malaise']},
    post:{items:5, questions:['Citez les 4 signes','Réaction immédiate','Prévenir avant ou après ?','Symptômes bénins','Urgences']}},
  { id:'cap-valsalva', title:'Éviter la manœuvre de Valsalva', theme:'Respiration', duration:'3 min',
    description:'Apprendre à respirer pendant le renforcement.',
    english:'Avoiding the Valsalva maneuver',
    image:'https://images.unsplash.com/photo-1545389336-cf090694435e?auto=format&fit=crop&w=720&q=70',
    pre:{items:3, questions:['Connaissez-vous Valsalva ?','Pourquoi à risque ?','Comment respirer ?']},
    post:{items:4, questions:['Décrivez Valsalva','Impact sur tension','Respiration phase concentrique','Exercices à risque']}},
  { id:'cap-sf36', title:'Qualité de vie et fatigue', theme:'SF-36', duration:'3 min',
    description:'Pourquoi renseigner régulièrement votre qualité de vie.',
    english:'Quality of life and fatigue',
    image:'https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=720&q=70',
    pre:{items:3, questions:['Connaissez-vous le SF-36 ?','À quoi sert-il ?','Combien de dimensions ?']},
    post:{items:4, questions:['Citez 4 dimensions','Fréquence de remplissage','Pourquoi utile','Score bas = pathologie ?']}},
  { id:'cap-gpaq', title:'Activité physique quotidienne', theme:'GPAQ', duration:'3 min',
    description:'Comprendre les domaines du GPAQ.',
    english:'Daily physical activity',
    image:'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?auto=format&fit=crop&w=720&q=70',
    pre:{items:3, questions:['Connaissez-vous le GPAQ ?','Quels domaines ?','Que mesure-t-on en MET-min ?']},
    post:{items:4, questions:['Citez les 4 domaines','1 MET ?','Volume hebdomadaire recommandé','Seuil de sédentarité']}}
];

const BASE_PATIENTS = [
  {id:'MRF-001',sex:'Femme',age:34,gene:'FBN1',aorta:42,progress:82,status:'Surveillance',statusClass:'watch',
   riskFactor:'Dilatation de l\'aorte',riskComment:'Surveillance échographique recommandée.',
   alterations:['Dilatation aorte ascendante','Fatigabilité','Hyperlaxité articulaire'],
   incidents:['Éviter blocage respiratoire','Adapter charges maximales']},
  {id:'MRF-002',sex:'Homme',age:41,gene:'FBN1',aorta:38,progress:76,status:'Stable',statusClass:'ok',
   riskFactor:'Tolérance cardio-respiratoire',riskComment:'Profil stable.',
   alterations:['Tolérance correcte','Raideur rachidienne'],
   incidents:['Échauffement progressif']},
  {id:'MRF-003',sex:'Femme',age:29,gene:'FBN1',aorta:46,progress:54,status:'Alerte',statusClass:'alert',
   riskFactor:'Dilatation aortique élevée',riskComment:'Avis médical avant progression.',
   alterations:['Dilatation aortique importante','Fatigue élevée'],
   incidents:['Limiter charges intenses','Surveillance FC stricte']}
];

// Étendre à 20 patients
const PATIENTS = [...BASE_PATIENTS];
for (let i = 4; i <= 20; i++) {
  const src = BASE_PATIENTS[(i - 1) % BASE_PATIENTS.length];
  PATIENTS.push({
    ...src,
    id: `MRF-${String(i).padStart(3, '0')}`,
    age: src.age + (i % 5 - 2),
    progress: Math.max(45, Math.min(94, src.progress + (i % 4) * 3 - 4)),
    status: i % 7 === 0 ? 'Alerte' : (i % 4 === 0 ? 'Surveillance' : 'Stable'),
    statusClass: i % 7 === 0 ? 'alert' : (i % 4 === 0 ? 'watch' : 'ok')
  });
}

function makeEvaluations(patientId) {
  const n = 3 + (patientId.charCodeAt(patientId.length - 1) % 5); // 3-7 évals
  const evs = [];
  const baseVo2 = 22 + Math.floor(Math.random() * 10);
  for (let k = 0; k < n; k++) {
    const date = new Date(2025, k * 3, 10).toISOString().slice(0, 10);
    const label = k === 0 ? 'Baseline' : (k <= 3 ? `T${k}` : `Suivi ${k + 1}`);
    evs.push({
      eval_id: k + 1, label, date,
      vo2: baseVo2 + k * 1.5 + Math.random() * 2,
      force: 60 + k * 3,
      aorta: 38 + k * 0.3,
      sf36: 55 + k * 4,
      gpaq: 700 + k * 100
    });
  }
  return evs;
}

async function seed() {
  console.log('▶ Démarrage du seed Marfan APA...');
  try {
    // 1. Capsules
    console.log('\n[1/4] Création des capsules éducation...');
    for (const c of CAPSULES) {
      await query(
        `INSERT INTO education_capsules (id, title, theme, duration, description, english, image_url, pre_questionnaire, post_questionnaire)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [c.id, c.title, c.theme, c.duration, c.description, c.english, c.image,
         JSON.stringify(c.pre), JSON.stringify(c.post)]
      );
    }
    console.log(`   ✓ ${CAPSULES.length} capsules`);

    // 2. Admin (created_by = NULL car c'est le premier user — contrainte FK auto-référente)
    console.log('\n[2/4] Création de l\'administrateur initial...');
    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, ROUNDS);
    await query(
      `INSERT INTO users (id, role, name, email, password_hash, service, created_by)
       VALUES ('u-admin-001', 'admin', 'Administrateur Marfan APA', $1, $2, 'Pilotage plateforme', NULL)
       ON CONFLICT (id) DO NOTHING`,
      [ADMIN_EMAIL.toLowerCase(), adminHash]
    );
    // Investigateur principal démo
    const prinHash = await bcrypt.hash('Principal!2024', ROUNDS);
    await query(
      `INSERT INTO users (id, role, name, email, password_hash, service, created_by)
       VALUES ('u-prin-001', 'principal', 'Pr. Jean Martin', 'j.martin@bichat.fr', $1, 'Cardiologie · Marfan', 'u-admin-001')
       ON CONFLICT (id) DO NOTHING`,
      [prinHash]
    );
    // Investigateur standard démo
    const invHash = await bcrypt.hash('Investigateur!2024', ROUNDS);
    await query(
      `INSERT INTO users (id, role, name, email, password_hash, service, created_by)
       VALUES ('u-inv-001', 'investigator', 'Dr. Camille Dupont', 'c.dupont@bichat.fr', $1, 'Cardiologie · APA', 'u-prin-001')
       ON CONFLICT (id) DO NOTHING`,
      [invHash]
    );
    console.log('   ✓ Admin + Investigateur principal + Investigateur');
    console.log(`   → Connexion admin    : ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    console.log(`   → Connexion principal: j.martin@bichat.fr / Principal!2024`);
    console.log(`   → Connexion investig.: c.dupont@bichat.fr / Investigateur!2024`);

    // 3. Patients + évaluations + comptes patient
    console.log('\n[3/4] Création des 20 patients démo...');
    const patPwd = await bcrypt.hash('Patient!2024', ROUNDS);
    for (const p of PATIENTS) {
      await query(
        `INSERT INTO patients (id, sex, age, gene, aorta, status, status_class, progress,
                               risk_factor, risk_comment, alterations, incidents, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'u-prin-001')
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.sex, p.age, p.gene, p.aorta, p.status, p.statusClass, p.progress,
         p.riskFactor, p.riskComment, p.alterations, p.incidents]
      );
      const evs = makeEvaluations(p.id);
      for (const e of evs) {
        await query(
          `INSERT INTO evaluations (patient_id, eval_id, label, eval_date, vo2, force_kg, aorta, sf36, gpaq, validated)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
           ON CONFLICT (patient_id, eval_id) DO NOTHING`,
          [p.id, e.eval_id, e.label, e.date,
           Math.round(e.vo2 * 10) / 10, e.force, e.aorta, e.sf36, e.gpaq]
        );
      }
      // Compte patient
      await query(
        `INSERT INTO users (id, role, name, email, password_hash, patient_id, created_by)
         VALUES ($1, 'patient', $2, $3, $4, $5, 'u-prin-001')
         ON CONFLICT (id) DO NOTHING`,
        ['u-pat-' + p.id, p.id, p.id.toLowerCase() + '@example.fr', patPwd, p.id]
      );
      // Notifications obligatoires
      const today = new Date().toISOString().slice(0, 10);
      await query(
        `INSERT INTO notifications (id, patient_id, type, label, source, sent_date)
         VALUES ($1,$2,'sf36','Questionnaire SF-36 (qualité de vie)','inclusion',$3)
         ON CONFLICT (id) DO NOTHING`,
        ['n-' + p.id + '-sf36-incl', p.id, today]
      );
      await query(
        `INSERT INTO notifications (id, patient_id, type, label, source, sent_date)
         VALUES ($1,$2,'gpaq','Questionnaire GPAQ (activité physique)','inclusion',$3)
         ON CONFLICT (id) DO NOTHING`,
        ['n-' + p.id + '-gpaq-incl', p.id, today]
      );
    }
    console.log(`   ✓ ${PATIENTS.length} patients + leurs évaluations`);
    console.log(`   → Mot de passe patient commun (démo) : Patient!2024`);

    // 4. Education records initiaux (mixte états pour la démo)
    console.log('\n[4/4] Initialisation des dossiers éducation...');
    let eduCount = 0;
    for (let pi = 0; pi < PATIENTS.length; pi++) {
      for (let ci = 0; ci < CAPSULES.length; ci++) {
        const phase = (pi + ci) % 5;
        const baseDate = new Date(2025, 5 + ci, 5 + pi).toISOString().slice(0, 10);
        if (phase === 0) continue;
        const args = [PATIENTS[pi].id, CAPSULES[ci].id, baseDate];
        let preStatus = 'pending', preScore = null, videoWatched = false, postStatus = 'locked', postScore = null, validated = false;
        if (phase >= 2) { preStatus = 'completed'; preScore = 40 + Math.floor(Math.random() * 30); }
        if (phase >= 3) { videoWatched = true; postStatus = 'pending'; }
        if (phase === 4) { postStatus = 'completed'; postScore = 60 + Math.floor(Math.random() * 35); validated = postScore >= 70; }
        await query(
          `INSERT INTO education_records (patient_id, capsule_id, sent_date,
             pre_status, pre_score, pre_completed_date,
             video_watched, video_watched_date,
             post_status, post_score, post_completed_date, validated)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (patient_id, capsule_id) DO NOTHING`,
          [...args, preStatus, preScore, preScore != null ? baseDate : null,
           videoWatched, videoWatched ? baseDate : null,
           postStatus, postScore, postScore != null ? baseDate : null, validated]
        );
        eduCount++;
      }
    }
    console.log(`   ✓ ${eduCount} dossiers éducation amorcés`);

    console.log('\n✓✓✓ SEED TERMINÉ AVEC SUCCÈS.\n');
    console.log('Comptes de démo créés :');
    console.log(`  • admin     → ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
    console.log(`  • principal → j.martin@bichat.fr / Principal!2024`);
    console.log(`  • investig. → c.dupont@bichat.fr / Investigateur!2024`);
    console.log(`  • patients  → mrf-001@example.fr ... mrf-020@example.fr / Patient!2024`);
  } catch (err) {
    console.error('\n✖ ÉCHEC SEED :', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

seed();
