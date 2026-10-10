/**
 * cpet-detail.js — Lecture détaillée d'une épreuve d'effort
 * ==========================================================
 *
 * Tout était calculé depuis les cycles respiratoires, et rien n'était
 * visible : l'analyse vivait dans une colonne JSONB que personne n'ouvrait.
 *
 * Un parti pris gouverne cet écran : **chaque valeur dit d'où elle vient**.
 *
 *   mesurée  — relevée dans le fichier de l'épreuve, ou lue sur la feuille
 *              de résultats de l'appareil ;
 *   calculée — déduite des mesures, avec la formule nommée ;
 *   absente  — la donnée n'existe pas, et on le dit.
 *
 * Sans cette distinction, un pouls d'oxygène calculé et un VO₂ mesuré
 * s'affichent pareil, et rien ne signale qu'un chiffre normalisé dépend
 * d'une équation de référence qui en vaut une autre. Une case vide se
 * remplit ; une case vide qu'on prend pour un zéro ne se remplit jamais.
 *
 * Aucune valeur n'est estimée, arrondie par commodité, ni remplacée par un
 * zéro. Une absence reste une absence.
 */
(function () {
  'use strict';

  let _patientId = null;
  let _conteneurId = null;
  let _epreuves = [];
  let _choisie = 0;

  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const jour = (d) => {
    if (!d) return '—';
    const x = new Date(d);
    return isNaN(x) ? String(d) : x.toLocaleDateString('fr-FR');
  };

  const num = (v) => (v == null || v === '') ? null : Number(v);

  /** Minutes et secondes : « 9 min 40 s » se lit, « 580 s » se calcule. */
  function duree(s) {
    if (s == null) return null;
    const m = Math.floor(s / 60), r = Math.round(s % 60);
    return m + ' min' + (r ? ' ' + String(r).padStart(2, '0') + ' s' : '');
  }

  // ============================================================
  // === Une ligne de résultat ==================================
  // ============================================================
  const PASTILLES = {
    mesure:  { t: 'mesurée',  f: '#ecfdf5', b: '#a7f3d0', c: '#065f46' },
    calcul:  { t: 'calculée', f: '#eff6ff', b: '#bfdbfe', c: '#1e40af' },
    absent:  { t: 'absente',  f: '#f8fafc', b: '#e2e8f0', c: '#94a3b8' }
  };

  /**
   * @param {string} libelle
   * @param {number|string|null} valeur
   * @param {string} unite
   * @param {'mesure'|'calcul'} origine  — ignorée si la valeur est absente
   * @param {string} note — formule, seuil de référence, ou raison de l'absence
   */
  function ligne(libelle, valeur, unite, origine, note) {
    const vide = valeur == null || valeur === '';
    const p = PASTILLES[vide ? 'absent' : origine] || PASTILLES.calcul;
    return '<tr style="border-top:1px solid #f1f5f9;">' +
      '<td style="padding:8px 10px; font-size:12.5px; color:#334155;">' + esc(libelle) + '</td>' +
      '<td style="padding:8px 10px; text-align:right; white-space:nowrap; font-size:14px; font-weight:800; color:' +
        (vide ? '#cbd5e1' : '#0b1530') + ';">' +
        (vide ? '—' : esc(valeur) + (unite ? ' <span style="font-size:11px; font-weight:600; color:#64748b;">' + esc(unite) + '</span>' : '')) +
      '</td>' +
      '<td style="padding:8px 10px; width:1%; white-space:nowrap;">' +
        '<span style="font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:99px; background:' +
          p.f + '; border:1px solid ' + p.b + '; color:' + p.c + ';">' + p.t + '</span>' +
      '</td>' +
      '<td style="padding:8px 10px; font-size:11.5px; color:#64748b; line-height:1.45;">' + esc(note || '') + '</td>' +
      '</tr>';
  }

  function tableau(titre, lignes) {
    return '<div style="margin-bottom:16px;">' +
      '<div style="font-size:12px; font-weight:800; color:#0b1530; text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px;">' +
        esc(titre) + '</div>' +
      '<div style="border:1px solid var(--line); border-radius:11px; overflow:hidden;">' +
        '<table style="width:100%; border-collapse:collapse; background:#fff;">' + lignes + '</table>' +
      '</div></div>';
  }

  // ============================================================
  // === Le corps de l'écran ====================================
  // ============================================================
  function rendreEpreuve(ev) {
    const t = ev.thresholds || {};
    const nature = t.natureVo2 === 'VO2max' ? 'VO₂ max' : 'VO₂ pic';
    const crit = t.criteres || {};

    // --- Paramètres principaux ---
    let l = '';
    l += ligne(nature, num(ev.vo2), 'mL/kg/min', 'mesure',
      t.natureVo2 === 'VO2max'
        ? 'Plateau de VO₂ atteint : effort maximal confirmé.'
        : 'Pas de plateau : effort maximal non confirmé. La valeur reste un pic, pas un maximum.');
    l += ligne(nature + ' absolu', num(t.vo2PicLMin), 'L/min', 'mesure',
      'Lissé sur 30 secondes, phase d\'exercice seule.');
    l += ligne('En % de la valeur théorique', num(t.vo2PctPredit), '%', 'calcul',
      t.vo2PreditEquation
        ? t.vo2PreditEquation + (t.vo2Predit ? ' — prédit : ' + t.vo2Predit + ' mL/min. Normale ≥ 84 %.' : '')
        : 'Référentiel non applicable : sexe, âge, taille ou ergomètre manquant.');
    l += ligne('Puissance maximale', num(ev.watts), 'W', 'mesure', '');
    l += ligne('Fréquence cardiaque maximale', num(t.fcPeak) || num(ev.fc), 'bpm', 'mesure',
      crit.fc_predite_tanaka
        ? 'Prédite ' + crit.fc_predite_tanaka + ' bpm (Tanaka)' +
          (crit.fc_pct_predite ? ' — atteinte à ' + crit.fc_pct_predite + ' %' : '')
        : '');
    l += ligne('Fréquence cardiaque de repos', num(t.fcRepos), 'bpm', 'mesure',
      t.fcRepos == null ? 'Phase de repos absente du fichier.' : '');
    l += ligne('Quotient respiratoire au pic', num(t.qrPic), '', 'mesure',
      'Critère d\'effort maximal : ≥ 1,10.');
    l += ligne('Durée de l\'épreuve', duree(num(t.dureeExerciceS)), '', 'mesure',
      t.dureeDansFenetre === false
        ? '⚠ Hors de la fenêtre 6–12 min recommandée : le VO₂ de pic y est sous-estimé.'
        : (t.dureeDansFenetre === true ? 'Dans la fenêtre 6–12 min recommandée.' : ''));
    l += ligne('Pression artérielle au repos', t.paRepos, 'mmHg', 'mesure',
      t.paRepos ? '' : 'Relevée au brassard par l\'opérateur : absente du fichier, à saisir.');
    l += ligne('Pression artérielle à l\'effort maximal', t.paEffortMax, 'mmHg', 'mesure',
      t.paEffortMax ? '' : 'Idem — non calculable depuis le flux ventilatoire.');
    const principaux = tableau('Paramètres principaux', l);

    // --- Seuils ventilatoires ---
    l = '';
    l += ligne('SV1 — VO₂', num(t.sv1Vo2), 'mL/min', 'mesure', '');
    l += ligne('SV1 — fréquence cardiaque', num(t.sv1Fc), 'bpm', 'mesure',
      'Borne de la zone d\'endurance fondamentale.');
    l += ligne('SV1 — puissance', num(t.sv1Watts), 'W', 'mesure', '');
    l += ligne('SV1 en % du pic', num(t.sv1PctPic), '%', 'calcul',
      '40 à 60 % attendu. En dessous, déconditionnement marqué.');
    l += ligne('SV2 — VO₂', num(t.sv2Vo2), 'mL/min', 'mesure', '');
    l += ligne('SV2 — fréquence cardiaque', num(t.sv2Fc), 'bpm', 'mesure',
      'Au-delà, contrainte tensionnelle sur l\'aorte : à éviter dans le syndrome de Marfan.');
    l += ligne('SV2 — puissance', num(t.sv2Watts), 'W', 'mesure', '');
    l += ligne('SV2 en % du pic', num(t.sv2PctPic), '%', 'calcul', '');
    const seuils = tableau('Seuils ventilatoires', l);

    // --- Indicateurs ventilatoires et pronostiques ---
    l = '';
    const iv = ev.vevco2Slope != null ? num(ev.vevco2Slope) : num(t.veVco2Pente);
    l += ligne('Pente VE/VCO₂', iv, '', 'calcul',
      'Régression sur tout l\'exercice' + (t.veVco2R2 ? ', R² ' + t.veVco2R2 : '') +
      '. Weber-Arena : < 30 normale, ≥ 36 défavorable.');
    l += ligne('OUES', num(t.oues), 'mL/min', 'calcul',
      'VO₂ = a·log₁₀(VE). Interprétable même sur une épreuve sous-maximale.');
    l += ligne('OUES rapportée au poids', num(t.ouesParKg), '', 'calcul',
      'Référence selon âge, sexe et corpulence — les normes publiées ne s\'accordent pas sur une borne.');
    l += ligne('Pouls d\'oxygène au pic', num(t.poulsO2), 'mL/battement', 'calcul',
      'VO₂ pic ÷ FC pic. Substitut du volume d\'éjection systolique à l\'effort.');
    l += ligne('PETCO₂ au pic', num(t.petco2Pic), 'mmHg', 'mesure',
      t.petco2Pic == null ? 'Colonne absente du fichier.' : '');
    l += ligne('Récupération de la FC à 1 min', num(t.hrr1), 'bpm', 'calcul',
      t.hrr1 == null
        ? 'Phase de récupération absente du fichier.'
        : (t.hrr1Anormale ? '⚠ ≤ 12 bpm : anormal. Facteur pronostique indépendant.'
                          : '> 12 bpm : normal.'));
    l += ligne('Réserve ventilatoire', num(t.reserveVentilatoire), '%', 'calcul',
      'Exige la VMM, donc un VEMS spirométrique. Sera calculée dès que la spirométrie accompagnera le fichier.');
    const pronostiques = tableau('Indicateurs ventilatoires et pronostiques', l);

    // --- Critères de maximalité ---
    const oui = v => v === true ? '<span style="color:#065f46; font-weight:800;">oui</span>'
                   : v === false ? '<span style="color:#b45309; font-weight:800;">non</span>'
                   : '<span style="color:#94a3b8;">indéterminé</span>';
    const maximalite =
      '<div style="padding:13px 15px; border-radius:11px; margin-bottom:16px; border:1px solid ' +
        (t.natureVo2 === 'VO2max' ? '#a7f3d0; background:#ecfdf5;' : '#fde68a; background:#fffbeb;') + '">' +
      '<div style="font-size:13px; font-weight:800; color:' +
        (t.natureVo2 === 'VO2max' ? '#065f46' : '#92400e') + '; margin-bottom:6px;">' +
        (t.natureVo2 === 'VO2max'
          ? '✓ VO₂ max — effort maximal confirmé'
          : '⚠ VO₂ pic — effort maximal non confirmé') + '</div>' +
      '<div style="font-size:12px; color:#475569; line-height:1.7;">' +
        'Plateau de VO₂ : ' + oui(crit.plateau) + ' · ' +
        'QR ≥ 1,10 : ' + oui(crit.qr_atteint) + ' · ' +
        'FC ≥ 90 % de la prédite : ' + oui(crit.fc_atteinte) +
        (crit.betabloquant_declare
          ? ' <em>(critère neutralisé : bêtabloquant déclaré)</em>' : '') +
      '</div>' +
      '<div style="font-size:11.5px; color:#64748b; margin-top:6px; line-height:1.55;">' +
        'Le plateau est le critère de référence : sans lui, jamais de VO₂ max, quels que soient les autres.' +
      '</div></div>';

    return maximalite + principaux + seuils + pronostiques;
  }

  // ============================================================
  // === Sélecteur et enveloppe =================================
  // ============================================================
  function rendre() {
    if (!_epreuves.length) {
      return carte(
        '<div style="text-align:center; padding:26px 18px; color:#64748b; font-size:13px; line-height:1.65;">' +
        '<div style="font-size:30px; margin-bottom:8px;">🫁</div>' +
        '<strong style="color:#0b1530;">Aucune épreuve d\'effort enregistrée.</strong><br>' +
        'Versez le fichier de l\'appareil dans <strong>« Verser une pièce »</strong>, en tête du dossier. ' +
        'Il sera analysé cycle par cycle : VO₂ de pic, seuils ventilatoires, facteurs pronostiques ' +
        'et zones d\'entraînement.<br>' +
        '<span style="font-size:11.5px;">Le format est reconnu automatiquement, y compris un export COSMED nommé « .csv ».</span>' +
        '</div>');
    }

    const ev = _epreuves[_choisie] || _epreuves[0];
    const choix = _epreuves.length > 1
      ? '<select id="cdChoix" style="padding:7px 10px; font-size:12.5px; max-width:100%;">' +
          _epreuves.map((e, i) =>
            '<option value="' + i + '"' + (i === _choisie ? ' selected' : '') + '>' +
            jour(e.date) + ' — ' + esc(e.label || 'Épreuve d\'effort') + '</option>').join('') +
        '</select>'
      : '<span style="font-size:12.5px; color:#475569;">' + jour(ev.date) + '</span>';

    return carte(
      '<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px;">' +
        choix +
        '<span style="font-size:11.5px; color:#64748b;">' + _epreuves.length + ' épreuve(s) au dossier</span>' +
      '</div>' + rendreEpreuve(ev));
  }

  function carte(contenu) {
    return '<article class="card" style="padding:0; margin-bottom:14px; overflow:hidden;">' +
      '<div style="padding:14px 20px; background:linear-gradient(135deg,#7c3aed,#a855f7); color:white;">' +
        '<h3 style="margin:0; color:white; font-size:15px;">🫁 Épreuve d\'effort cardiopulmonaire</h3>' +
        '<p style="margin:3px 0 0; font-size:11.5px; opacity:.92;">' +
          'Calculée depuis les cycles respiratoires du fichier, jamais depuis un résumé.</p>' +
      '</div>' +
      '<div style="padding:16px 20px;">' + contenu + '</div>' +
      '</article>';
  }

  // ============================================================
  // === Montage ================================================
  // ============================================================
  async function mount(containerId, patientId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    _patientId = patientId;
    _conteneurId = containerId;
    _choisie = 0;

    el.innerHTML = carte('<div style="text-align:center; padding:18px; color:#94a3b8; font-size:13px;">Lecture des épreuves…</div>');

    try {
      const r = await window.MarfanAPI.evaluations.list(patientId);
      const toutes = (r && r.evaluations) || [];
      // Une épreuve d'effort se reconnaît à son VO₂ : les évaluations
      // dérivées d'un document n'en portent pas. Filtrer là-dessus évite
      // d'afficher un écran d'épreuve d'effort pour une mesure aortique.
      _epreuves = toutes
        .filter(e => e.vo2 != null)
        .map(e => Object.assign({}, e, {
          date: e.eval_date || e.date,
          thresholds: e.thresholds || {},
          vevco2Slope: e.ve_vco2_slope,
          fc: e.fc_max
        }))
        .sort((a, b) => new Date(a.date) - new Date(b.date));
    } catch (e) {
      console.warn('[cpet-detail] lecture :', e && e.message);
      el.innerHTML = carte(
        '<div style="padding:13px 15px; border-radius:10px; background:#fef2f2; border:1px solid #fecaca; ' +
        'font-size:12.5px; color:#991b1b;">Lecture impossible : ' + esc((e && e.message) || 'erreur') + '</div>');
      return;
    }

    el.innerHTML = rendre();
    remonter(el);
  }

  /** Recâble le sélecteur après un rendu, sans dupliquer l'écouteur. */
  function remonter(el) {
    const sel = document.getElementById('cdChoix');
    if (!sel || sel._cable) return;
    sel._cable = true;
    sel.addEventListener('change', () => {
      _choisie = parseInt(sel.value, 10) || 0;
      el.innerHTML = rendre();
      remonter(el);
    });
  }

  window.CpetDetailUI = { mount: mount };
})();
