/**
 * ============================================================
 * QUESTIONNAIRES VALIDÉS — SF-36 et GPAQ (OMS)
 * ============================================================
 * Définitions complètes + algorithmes de scoring officiels.
 * Expose window.MarfanQuestionnaires.{ SF36, GPAQ, scoreSF36, scoreGPAQ }
 *
 * Références :
 *   - SF-36 : Ware JE, Sherbourne CD. The MOS 36-item Short-Form Health Survey
 *             (SF-36). Med Care. 1992;30(6):473-83.
 *             Recodage selon RAND Health (https://www.rand.org/health-care/surveys_tools/mos/36-item-short-form/scoring.html)
 *   - GPAQ  : Global Physical Activity Questionnaire — World Health Organization
 *             (https://www.who.int/teams/noncommunicable-diseases/surveillance/systems-tools/physical-activity-surveillance)
 * ============================================================
 */
(function () {
  'use strict';

  // ============================================================
  // SF-36 — Définitions des 36 items et de leurs options
  // ============================================================
  const SF36 = {
    title: 'SF-36 — Qualité de vie liée à la santé',
    description: 'Questionnaire de qualité de vie en 36 items validé internationalement (Ware & Sherbourne 1992). Évalue 8 dimensions sur 100 et 2 scores synthétiques (PCS = physique, MCS = mental).',
    estimatedMinutes: 10,
    sections: [
      {
        id: 'general',
        title: '1. Santé en général',
        items: [
          { id: 'q1', text: 'En général, vous diriez que votre santé est :',
            options: [
              { v: 1, label: 'Excellente' },
              { v: 2, label: 'Très bonne' },
              { v: 3, label: 'Bonne' },
              { v: 4, label: 'Médiocre' },
              { v: 5, label: 'Mauvaise' }
            ]
          },
          { id: 'q2', text: 'Par rapport à il y a un an, comment trouvez-vous votre état de santé en ce moment ?',
            options: [
              { v: 1, label: 'Bien meilleur qu\'il y a un an' },
              { v: 2, label: 'Un peu meilleur' },
              { v: 3, label: 'À peu près pareil' },
              { v: 4, label: 'Un peu moins bon' },
              { v: 5, label: 'Bien pire qu\'il y a un an' }
            ]
          }
        ]
      },
      {
        id: 'physical',
        title: '2. Activités physiques',
        introduction: 'Voici une liste d\'activités que vous pourriez avoir à faire dans votre journée. Pour chacune, indiquez si vous êtes limité(e) :',
        commonOptions: [
          { v: 1, label: 'Oui, beaucoup limité(e)' },
          { v: 2, label: 'Oui, un peu limité(e)' },
          { v: 3, label: 'Non, pas limité(e) du tout' }
        ],
        items: [
          { id: 'q3',  text: 'Activités intenses (courir, soulever des objets lourds, faire un sport violent)' },
          { id: 'q4',  text: 'Activités modérées (déplacer une table, passer l\'aspirateur, jouer aux quilles, jouer au golf)' },
          { id: 'q5',  text: 'Soulever et porter les courses' },
          { id: 'q6',  text: 'Monter plusieurs étages par l\'escalier' },
          { id: 'q7',  text: 'Monter un étage par l\'escalier' },
          { id: 'q8',  text: 'Se pencher, se mettre à genoux, s\'accroupir' },
          { id: 'q9',  text: 'Marcher plus d\'un kilomètre et demi' },
          { id: 'q10', text: 'Marcher plus de 500 mètres' },
          { id: 'q11', text: 'Marcher seulement 100 mètres' },
          { id: 'q12', text: 'Prendre un bain, une douche ou s\'habiller' }
        ]
      },
      {
        id: 'role_physical',
        title: '3. Limitations dues à l\'état physique (4 dernières semaines)',
        introduction: 'Au cours de ces 4 dernières semaines, et en raison de votre état physique, avez-vous :',
        commonOptions: [
          { v: 1, label: 'Oui' },
          { v: 2, label: 'Non' }
        ],
        items: [
          { id: 'q13', text: 'Réduit le temps passé à votre travail ou à vos activités habituelles ?' },
          { id: 'q14', text: 'Fait moins de choses que vous auriez voulu ?' },
          { id: 'q15', text: 'Trouvé des limites au type de travail ou d\'activités possibles ?' },
          { id: 'q16', text: 'Eu des difficultés à faire votre travail ou toute autre activité (effort supplémentaire) ?' }
        ]
      },
      {
        id: 'role_emotional',
        title: '4. Limitations dues à l\'état émotionnel (4 dernières semaines)',
        introduction: 'Au cours de ces 4 dernières semaines, et en raison de votre état émotionnel (comme se sentir triste, nerveux ou déprimé), avez-vous :',
        commonOptions: [
          { v: 1, label: 'Oui' },
          { v: 2, label: 'Non' }
        ],
        items: [
          { id: 'q17', text: 'Réduit le temps passé à votre travail ou à vos activités habituelles ?' },
          { id: 'q18', text: 'Fait moins de choses que vous auriez voulu ?' },
          { id: 'q19', text: 'Fait votre travail ou toute autre activité moins soigneusement qu\'à l\'habitude ?' }
        ]
      },
      {
        id: 'social',
        title: '5. Vie sociale',
        items: [
          { id: 'q20', text: 'Au cours des 4 dernières semaines, dans quelle mesure votre état de santé physique ou émotionnel a-t-il gêné votre vie sociale (famille, amis, voisins, autres) ?',
            options: [
              { v: 1, label: 'Pas du tout' },
              { v: 2, label: 'Un peu' },
              { v: 3, label: 'Moyennement' },
              { v: 4, label: 'Beaucoup' },
              { v: 5, label: 'Énormément' }
            ]
          }
        ]
      },
      {
        id: 'pain',
        title: '6. Douleurs',
        items: [
          { id: 'q21', text: 'Au cours des 4 dernières semaines, quelle a été l\'intensité de vos douleurs physiques ?',
            options: [
              { v: 1, label: 'Nulles' },
              { v: 2, label: 'Très faibles' },
              { v: 3, label: 'Faibles' },
              { v: 4, label: 'Moyennes' },
              { v: 5, label: 'Grandes' },
              { v: 6, label: 'Très grandes' }
            ]
          },
          { id: 'q22', text: 'Au cours des 4 dernières semaines, dans quelle mesure vos douleurs vous ont-elles gêné(e) dans votre travail ou vos activités (au domicile et à l\'extérieur) ?',
            options: [
              { v: 1, label: 'Pas du tout' },
              { v: 2, label: 'Un peu' },
              { v: 3, label: 'Moyennement' },
              { v: 4, label: 'Beaucoup' },
              { v: 5, label: 'Énormément' }
            ]
          }
        ]
      },
      {
        id: 'mental',
        title: '7. Votre état au cours des 4 dernières semaines',
        introduction: 'Indiquez pour chaque question la réponse qui correspond le mieux à ce que vous avez ressenti :',
        commonOptions: [
          { v: 1, label: 'Tout le temps' },
          { v: 2, label: 'Très souvent' },
          { v: 3, label: 'Souvent' },
          { v: 4, label: 'Quelquefois' },
          { v: 5, label: 'Rarement' },
          { v: 6, label: 'Jamais' }
        ],
        items: [
          { id: 'q23', text: 'Vous êtes-vous senti(e) dynamique ?' },
          { id: 'q24', text: 'Vous êtes-vous senti(e) très nerveux(se) ?' },
          { id: 'q25', text: 'Vous êtes-vous senti(e) si découragé(e) que rien ne pouvait vous remonter le moral ?' },
          { id: 'q26', text: 'Vous êtes-vous senti(e) calme et détendu(e) ?' },
          { id: 'q27', text: 'Avez-vous eu beaucoup d\'énergie ?' },
          { id: 'q28', text: 'Vous êtes-vous senti(e) triste et abattu(e) ?' },
          { id: 'q29', text: 'Vous êtes-vous senti(e) épuisé(e) ?' },
          { id: 'q30', text: 'Vous êtes-vous senti(e) heureux(se) ?' },
          { id: 'q31', text: 'Vous êtes-vous senti(e) fatigué(e) ?' }
        ]
      },
      {
        id: 'social_time',
        title: '8. Vie sociale (suite)',
        items: [
          { id: 'q32', text: 'Au cours des 4 dernières semaines, votre état physique ou émotionnel a-t-il gêné vos activités sociales (rendre visite à des amis, de la famille, etc.) ?',
            options: [
              { v: 1, label: 'Tout le temps' },
              { v: 2, label: 'Une bonne partie du temps' },
              { v: 3, label: 'De temps en temps' },
              { v: 4, label: 'Rarement' },
              { v: 5, label: 'Jamais' }
            ]
          }
        ]
      },
      {
        id: 'health_general',
        title: '9. Santé en général (suite)',
        introduction: 'Indiquez pour chaque phrase si elle est vraie ou fausse dans votre cas :',
        commonOptions: [
          { v: 1, label: 'Tout à fait vraie' },
          { v: 2, label: 'Plutôt vraie' },
          { v: 3, label: 'Je ne sais pas' },
          { v: 4, label: 'Plutôt fausse' },
          { v: 5, label: 'Tout à fait fausse' }
        ],
        items: [
          { id: 'q33', text: 'Il me semble que je tombe malade plus facilement que les autres' },
          { id: 'q34', text: 'Je me porte aussi bien que n\'importe qui' },
          { id: 'q35', text: 'Je m\'attends à ce que ma santé se dégrade' },
          { id: 'q36', text: 'Ma santé est excellente' }
        ]
      }
    ],

    // ============================================================
    // Scoring SF-36 (recodage selon RAND Health)
    // ============================================================
    dimensions: {
      PF: { label: 'Fonctionnement physique',         short: 'PF', items: ['q3','q4','q5','q6','q7','q8','q9','q10','q11','q12'] },
      RP: { label: 'Rôle physique',                    short: 'RP', items: ['q13','q14','q15','q16'] },
      BP: { label: 'Douleurs',                         short: 'BP', items: ['q21','q22'] },
      GH: { label: 'Santé générale',                   short: 'GH', items: ['q1','q33','q34','q35','q36'] },
      VT: { label: 'Vitalité',                         short: 'VT', items: ['q23','q27','q29','q31'] },
      SF: { label: 'Vie sociale',                      short: 'SF', items: ['q20','q32'] },
      RE: { label: 'Rôle émotionnel',                  short: 'RE', items: ['q17','q18','q19'] },
      MH: { label: 'Santé mentale',                    short: 'MH', items: ['q24','q25','q26','q28','q30'] }
    },
    transitionItem: 'q2'
  };

  /**
   * Score SF-36 selon la méthode RAND/Ware.
   * Étape 1 : recoder chaque item (item raw → "transformed value" entre 0 et 100)
   * Étape 2 : moyenne pondérée des items par dimension
   * @param {Object} answers - { qN: valeur, ... }
   * @returns {Object} { PF, RP, BP, GH, VT, SF, RE, MH, transition }
   */
  function scoreSF36(answers) {
    if (!answers) return null;
    // Table de recodage RAND (1992)
    const recode = {
      // Items à 3 choix (PF) : 1→0, 2→50, 3→100
      threeChoice: { 1: 0, 2: 50, 3: 100 },
      // Items à 2 choix oui/non (RP, RE) : 1→0 (oui = gêne), 2→100 (non)
      twoChoice: { 1: 0, 2: 100 },
      // Items à 5 choix montants (q1, q34, q36) : 1→100, 2→75, 3→50, 4→25, 5→0
      fiveUp: { 1: 100, 2: 75, 3: 50, 4: 25, 5: 0 },
      // Items à 5 choix descendants (q33, q35, q20) : 1→0, 2→25, 3→50, 4→75, 5→100
      fiveDown: { 1: 0, 2: 25, 3: 50, 4: 75, 5: 100 },
      // Items 6 choix montants (q23, q27, q26, q30) : 1→100, 2→80, 3→60, 4→40, 5→20, 6→0
      sixUp: { 1: 100, 2: 80, 3: 60, 4: 40, 5: 20, 6: 0 },
      // Items 6 choix descendants (q24, q25, q28, q29, q31) : 1→0, 2→20, 3→40, 4→60, 5→80, 6→100
      sixDown: { 1: 0, 2: 20, 3: 40, 4: 60, 5: 80, 6: 100 },
      // q22 (gêne 5 choix asym.) : 1→100, 2→75, 3→50, 4→25, 5→0
      // q21 (intensité douleur 6 choix asym.) : 1→100, 2→80, 3→60, 4→40, 5→20, 6→0
      // q32 (gêne 5 choix asym.) : 1→100, 2→75, 3→50, 4→25, 5→0
    };

    // Recodage de chaque item
    const r = {};
    // PF (q3-q12) : 3 choix montant 1→0, 2→50, 3→100
    ['q3','q4','q5','q6','q7','q8','q9','q10','q11','q12'].forEach(q => {
      r[q] = recode.threeChoice[answers[q]];
    });
    // RP (q13-q16) : 2 choix oui/non, oui=0
    ['q13','q14','q15','q16'].forEach(q => { r[q] = recode.twoChoice[answers[q]]; });
    // RE (q17-q19) : 2 choix oui/non
    ['q17','q18','q19'].forEach(q => { r[q] = recode.twoChoice[answers[q]]; });
    // SF : q20 (5 desc), q32 (5 asym desc)
    r.q20 = recode.fiveDown[answers.q20];
    r.q32 = recode.fiveUp[answers.q32]; // attention : q32 (5 niveaux), Tout le temps=1→0... → fiveDown
    // Correction officielle : q32 va de 1 (Tout le temps) à 5 (Jamais), gêne = Tout le temps → 0 ; Jamais → 100 → fiveDown
    r.q32 = recode.fiveDown[answers.q32];
    // BP : q21 (intensité, 6 niveaux), q22 (gêne, 5 niveaux)
    r.q21 = recode.sixUp[answers.q21];   // Nulles=1→100, Très grandes=6→0
    r.q22 = recode.fiveUp[answers.q22];  // Pas du tout=1→100, Énormément=5→0
    // GH : q1 (5 montant), q33-q36 (5 montant ou desc selon la phrase)
    r.q1  = recode.fiveUp[answers.q1];   // Excellente=1→100
    r.q33 = recode.fiveDown[answers.q33]; // "Je tombe malade plus facilement" : vrai = mauvais → fiveDown
    r.q34 = recode.fiveUp[answers.q34];   // "Je me porte aussi bien" : vrai = bon
    r.q35 = recode.fiveDown[answers.q35]; // "Je m'attends à ce que ma santé se dégrade" : vrai = mauvais
    r.q36 = recode.fiveUp[answers.q36];   // "Ma santé est excellente" : vrai = bon
    // VT : q23, q27 (6 montant énergie), q29, q31 (6 desc fatigue)
    r.q23 = recode.sixUp[answers.q23];   // Dynamique : Tout le temps=1→100
    r.q27 = recode.sixUp[answers.q27];   // Énergie
    r.q29 = recode.sixDown[answers.q29]; // Épuisé : Tout le temps=1→0
    r.q31 = recode.sixDown[answers.q31]; // Fatigué
    // MH : q24, q25, q28 (6 desc neg), q26, q30 (6 montant pos)
    r.q24 = recode.sixDown[answers.q24]; // Nerveux
    r.q25 = recode.sixDown[answers.q25]; // Découragé
    r.q26 = recode.sixUp[answers.q26];   // Calme et détendu
    r.q28 = recode.sixDown[answers.q28]; // Triste
    r.q30 = recode.sixUp[answers.q30];   // Heureux

    // Calcul des scores par dimension (moyenne des items recodés)
    function avg(itemList) {
      const vals = itemList.map(q => r[q]).filter(v => v != null && !isNaN(v));
      if (!vals.length) return null;
      return Math.round(vals.reduce((a,b) => a+b, 0) / vals.length * 10) / 10;
    }
    const out = {};
    Object.keys(SF36.dimensions).forEach(k => {
      out[k] = avg(SF36.dimensions[k].items);
    });
    out.transition = answers[SF36.transitionItem] || null;
    return out;
  }

  // ============================================================
  // GPAQ — Global Physical Activity Questionnaire (OMS)
  // ============================================================
  // 16 items, 4 domaines : travail (1-6), déplacements (7-9), loisirs (10-15), sédentarité (16)
  // Scoring officiel OMS — MET-min/semaine
  //   Travail/Loisirs intenses : 8 MET ; modérés : 4 MET ; déplacement (vélo/marche) : 4 MET
  // ============================================================
  const GPAQ = {
    title: 'GPAQ — Activité physique (questionnaire OMS)',
    description: 'Global Physical Activity Questionnaire de l\'OMS, version 2. Évalue l\'activité physique hebdomadaire dans 4 domaines : travail, déplacements, loisirs, sédentarité.',
    estimatedMinutes: 7,
    sections: [
      {
        id: 'work',
        title: '1. Activité au travail',
        introduction: 'On entend par "travail" les activités rémunérées et non rémunérées : emploi, études, garde de la maison, agriculture, etc.',
        items: [
          { id: 'g1', text: 'Votre travail comporte-t-il une activité d\'intensité élevée (forte accélération du rythme cardiaque ou respiratoire), pendant au moins 10 minutes consécutives ? (ex : porter, soulever des charges lourdes, creuser, monter à toute allure)',
            options: [{ v: 1, label: 'Oui' }, { v: 0, label: 'Non' }] },
          { id: 'g2', text: 'Si OUI : combien de jours par semaine en moyenne ?',
            type: 'number', min: 0, max: 7, unit: 'jours/sem', dependsOn: 'g1', dependsValue: 1 },
          { id: 'g3', text: 'Combien de temps en moyenne consacrez-vous à ces activités intenses lors d\'une journée typique ?',
            type: 'minutes', dependsOn: 'g1', dependsValue: 1 },
          { id: 'g4', text: 'Votre travail comporte-t-il une activité d\'intensité modérée (légère accélération cardiaque ou respiratoire), pendant au moins 10 minutes consécutives ? (ex : marcher d\'un bon pas, porter des charges légères)',
            options: [{ v: 1, label: 'Oui' }, { v: 0, label: 'Non' }] },
          { id: 'g5', text: 'Si OUI : combien de jours par semaine ?',
            type: 'number', min: 0, max: 7, unit: 'jours/sem', dependsOn: 'g4', dependsValue: 1 },
          { id: 'g6', text: 'Combien de temps en moyenne ces activités modérées au travail durent-elles dans la journée ?',
            type: 'minutes', dependsOn: 'g4', dependsValue: 1 }
        ]
      },
      {
        id: 'transport',
        title: '2. Déplacements actifs',
        introduction: 'Maintenant, nous parlons de la façon habituelle dont vous vous déplacez d\'un endroit à un autre (marche, vélo).',
        items: [
          { id: 'g7', text: 'Marchez-vous, faites-vous du vélo pour vos déplacements pendant au moins 10 minutes consécutives ?',
            options: [{ v: 1, label: 'Oui' }, { v: 0, label: 'Non' }] },
          { id: 'g8', text: 'Si OUI : combien de jours par semaine ?',
            type: 'number', min: 0, max: 7, unit: 'jours/sem', dependsOn: 'g7', dependsValue: 1 },
          { id: 'g9', text: 'Combien de temps en moyenne marchez-vous/faites-vous du vélo pour vos déplacements dans la journée ?',
            type: 'minutes', dependsOn: 'g7', dependsValue: 1 }
        ]
      },
      {
        id: 'leisure',
        title: '3. Loisirs et sport',
        introduction: 'Parlons à présent des activités sportives, de fitness, ou de loisirs.',
        items: [
          { id: 'g10', text: 'Pratiquez-vous des sports/loisirs d\'intensité élevée (course, football intense, vélo rapide) pendant au moins 10 minutes consécutives ?',
            options: [{ v: 1, label: 'Oui' }, { v: 0, label: 'Non' }] },
          { id: 'g11', text: 'Si OUI : combien de jours par semaine ?',
            type: 'number', min: 0, max: 7, unit: 'jours/sem', dependsOn: 'g10', dependsValue: 1 },
          { id: 'g12', text: 'Combien de temps en moyenne ?',
            type: 'minutes', dependsOn: 'g10', dependsValue: 1 },
          { id: 'g13', text: 'Pratiquez-vous des sports/loisirs d\'intensité modérée (marche rapide, vélo doux, natation, danse de salon) pendant au moins 10 minutes consécutives ?',
            options: [{ v: 1, label: 'Oui' }, { v: 0, label: 'Non' }] },
          { id: 'g14', text: 'Si OUI : combien de jours par semaine ?',
            type: 'number', min: 0, max: 7, unit: 'jours/sem', dependsOn: 'g13', dependsValue: 1 },
          { id: 'g15', text: 'Combien de temps en moyenne ?',
            type: 'minutes', dependsOn: 'g13', dependsValue: 1 }
        ]
      },
      {
        id: 'sedentary',
        title: '4. Sédentarité',
        items: [
          { id: 'g16', text: 'Combien de temps en moyenne passez-vous assis(e) ou allongé(e) lors d\'une journée typique (hors temps de sommeil) ?',
            type: 'minutes' }
        ]
      }
    ]
  };

  /**
   * Score GPAQ selon WHO Analysis Guide v2.
   * MET-values officielles :
   *   - Travail intense    : 8 MET
   *   - Travail modéré     : 4 MET
   *   - Déplacement vélo/marche : 4 MET
   *   - Loisir intense     : 8 MET
   *   - Loisir modéré      : 4 MET
   * MET-min/semaine = MET × jours/sem × minutes/jour
   * @param {Object} a - { g1..g16: valeurs }
   * @returns {Object} { work_metmin, transport_metmin, leisure_metmin, total_metmin,
   *                     sedentary_min_per_day, activity_level }
   */
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

    // Classification OMS / IPAQ
    let activity_level = 'low';
    if (total_metmin >= 3000) activity_level = 'high';
    else if (total_metmin >= 600) activity_level = 'moderate';

    return {
      work_metmin, transport_metmin, leisure_metmin, total_metmin,
      sedentary_min_per_day, activity_level
    };
  }

  // ============================================================
  // Export
  // ============================================================
  window.MarfanQuestionnaires = { SF36, GPAQ, scoreSF36, scoreGPAQ };
})();
