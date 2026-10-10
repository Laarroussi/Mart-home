/**
 * echo-detail.js — Lecture détaillée d'une échocardiographie
 * ============================================================
 *
 * Deux niveaux d'affichage, et une règle pour les départager.
 *
 * Dans le tableau général de la base, un seul chiffre : le diamètre maximal
 * des sinus de Valsalva et son écart. C'est la mesure qui décide du suivi
 * dans le syndrome de Marfan ; noyée parmi quarante-cinq colonnes, elle
 * devenait introuvable.
 *
 * Ici, tout le reste — en trois blocs qui suivent la lecture d'un compte
 * rendu : la racine aortique et l'aorte, le cœur, la paroi vasculaire.
 *
 * Comme pour l'épreuve d'effort, chaque valeur dit d'où elle vient. Les
 * rapports — E/A, E/e', distensibilité, compliance, indice de rigidité — ne
 * sont jamais lus en base : ils sont recalculés depuis les grandeurs
 * mesurées, à chaque affichage. Une mesure corrigée met donc à jour tout ce
 * qui en dépend, sans qu'on ait à y penser.
 */
(function () {
  'use strict';

  let _patientId = null;
  let _conteneurId = null;
  let _examens = [];
  let _choisi = 0;

  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const jour = (d) => {
    if (!d) return '—';
    const x = new Date(d);
    return isNaN(x) ? String(d) : x.toLocaleDateString('fr-FR');
  };

  const num = (v) => {
    if (v == null || v === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };

  const PASTILLES = {
    mesure: { t: 'mesurée',  f: '#ecfdf5', b: '#a7f3d0', c: '#065f46' },
    calcul: { t: 'calculée', f: '#eff6ff', b: '#bfdbfe', c: '#1e40af' },
    absent: { t: 'absente',  f: '#f8fafc', b: '#e2e8f0', c: '#94a3b8' }
  };

  function ligne(libelle, valeur, unite, origine, note, couleur) {
    const vide = valeur == null || valeur === '';
    const p = PASTILLES[vide ? 'absent' : origine] || PASTILLES.calcul;
    return '<tr style="border-top:1px solid #f1f5f9;">' +
      '<td style="padding:8px 10px; font-size:12.5px; color:#334155;">' + esc(libelle) + '</td>' +
      '<td style="padding:8px 10px; text-align:right; white-space:nowrap; font-size:14px; font-weight:800; color:' +
        (vide ? '#cbd5e1' : (couleur || '#0b1530')) + ';">' +
        (vide ? '—' : esc(valeur) +
          (unite ? ' <span style="font-size:11px; font-weight:600; color:#64748b;">' + esc(unite) + '</span>' : '')) +
      '</td>' +
      '<td style="padding:8px 10px; width:1%; white-space:nowrap;">' +
        '<span style="font-size:10.5px; font-weight:700; padding:2px 8px; border-radius:99px; background:' +
          p.f + '; border:1px solid ' + p.b + '; color:' + p.c + ';">' + p.t + '</span></td>' +
      '<td style="padding:8px 10px; font-size:11.5px; color:#64748b; line-height:1.45;">' + esc(note || '') + '</td>' +
      '</tr>';
  }

  function bloc(titre, lignes) {
    if (!lignes) return '';
    return '<div style="margin-bottom:16px;">' +
      '<div style="font-size:12px; font-weight:800; color:#0b1530; text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px;">' +
        esc(titre) + '</div>' +
      '<div style="border:1px solid var(--line); border-radius:11px; overflow:hidden;">' +
        '<table style="width:100%; border-collapse:collapse; background:#fff;">' + lignes + '</table>' +
      '</div></div>';
  }

  // ============================================================
  // === Les trois blocs ========================================
  // ============================================================
  function racineAortique(e, C) {
    let l = '';
    l += ligne('Anneau aortique', num(e.anneau_aortique_mm), 'mm', 'mesure', '');

    const zS = C.lireZScore(e.z_score_sinus, e.z_score_reference);
    l += ligne('Sinus de Valsalva', num(e.sinus_valsalva_mm), 'mm', 'mesure',
      'Mesure de référence du suivi dans le syndrome de Marfan.');
    l += ligne('Z-score des sinus', zS ? zS.valeur : null, '', 'mesure',
      zS ? (zS.reference ? zS.libelle + ' · ' + zS.reference : zS.libelle)
         : 'Non calculé : exige la surface corporelle et un nomogramme nommé.',
      zS ? zS.couleur : null);

    l += ligne('Jonction sino-tubulaire', num(e.jonction_sinotub_mm), 'mm', 'mesure', '');
    l += ligne('Aorte ascendante', num(e.aorte_ascendante_mm), 'mm', 'mesure', '');
    l += ligne('Crosse aortique', num(e.crosse_aortique_mm), 'mm', 'mesure', '');
    l += ligne('Aorte descendante', num(e.aorte_descendante_mm), 'mm', 'mesure', '');
    l += ligne('Aorte abdominale', num(e.aorte_abdominale_mm), 'mm', 'mesure', '');

    const max = num(e.aorte_max_mm);
    l += ligne('Diamètre maximal retenu', max, 'mm', 'mesure',
      (e.aorte_site_max ? 'Niveau : ' + e.aorte_site_max + '. ' : '') +
      (max != null && max >= 45 ? '⚠ Au seuil chirurgical habituellement retenu.' : ''),
      (max != null && max >= 45) ? '#b91c1c' : null);
    return bloc('Racine aortique et aorte', l);
  }

  function coeur(e, C) {
    let l = '';
    const fevg = num(e.fevg_bp_pct);
    l += ligne('FEVG', fevg, '%', 'mesure',
      e.fevg_methode ? 'Méthode : ' + e.fevg_methode
                     : 'Méthode non précisée — Simpson biplan et Teicholz ne sont pas comparables.',
      fevg != null && fevg < 50 ? '#b91c1c' : null);
    l += ligne('FEVG Teicholz', num(e.fe_teicholz_pct), '%', 'mesure',
      'Conservée pour comparaison ; Simpson biplan fait foi.');
    l += ligne('Fraction de raccourcissement', num(e.fr_teicholz_pct), '%', 'mesure', '');

    const gls = C.lireGls(e.gls_pct);
    l += ligne('Déformation longitudinale globale', gls ? gls.valeur : null, '%', 'mesure',
      gls ? (gls.libelle + (e.gls_logiciel ? ' · ' + e.gls_logiciel : ' · logiciel non précisé'))
          : 'Non mesurée.',
      gls ? gls.couleur : null);

    l += ligne('Diamètre télédiastolique du VG', num(e.divgd_cm), 'cm', 'mesure', '');
    l += ligne('Diamètre télésystolique du VG', num(e.divgs_cm), 'cm', 'mesure', '');
    l += ligne('Volume télédiastolique indexé', num(e.vtd_bp_ind_ml_m2), 'mL/m²', 'mesure', '');
    l += ligne('Volume télésystolique indexé', num(e.vts_bp_ind_ml_m2), 'mL/m²', 'mesure', '');
    l += ligne('Masse VG indexée', num(e.mvg_ind_g_m2), 'g/m²', 'mesure', '');
    l += ligne('Volume OG indexé', num(e.vts_og_bp_ind_ml_m2), 'mL/m²', 'mesure', '');

    // --- Fonction diastolique : les rapports sont calculés ---
    l += ligne('Onde E', num(e.vit_pic_e_vm_cm_s), 'cm/s', 'mesure', '');
    l += ligne('Onde A', num(e.vit_pic_a_vm_cm_s), 'cm/s', 'mesure', '');
    l += ligne('Rapport E/A', C.rapportEA(e.vit_pic_e_vm_cm_s, e.vit_pic_a_vm_cm_s), '', 'calcul',
      'E ÷ A.');
    l += ligne("e' septal", num(e.e_prime_septal_cm_s), 'cm/s', 'mesure', '');
    l += ligne("e' latéral", num(e.e_prime_lateral_cm_s), 'cm/s', 'mesure', '');

    const ee = C.rapportEsurEPrime(e.vit_pic_e_vm_cm_s, e.e_prime_septal_cm_s, e.e_prime_lateral_cm_s);
    const lect = ee ? C.lireEsurEPrime(ee.valeur) : null;
    l += ligne("Rapport E/e'", ee ? ee.valeur : null, '', 'calcul',
      ee ? (lect.libelle + ' · ' + ee.site)
         : "Exige l'onde E et au moins un e'.",
      lect ? lect.couleur : null);

    l += ligne('PAPS estimée', num(e.paps_mmhg), 'mmHg', 'mesure', '');
    return bloc('Paramètres cardiaques', l);
  }

  function paroiVasculaire(e, C) {
    const ds = e.aorte_systole_mm, dd = e.aorte_diastole_mm;
    const ps = e.pa_systolique_mmhg, pd = e.pa_diastolique_mmhg;

    let l = '';
    l += ligne('Diamètre en systole', num(ds), 'mm', 'mesure',
      e.aorte_site_cycle ? 'Niveau : ' + e.aorte_site_cycle : '');
    l += ligne('Diamètre en diastole', num(dd), 'mm', 'mesure', '');
    l += ligne('Pression artérielle de l\'examen',
      (ps != null && pd != null) ? ps + '/' + pd : null, 'mmHg', 'mesure',
      (ps == null || pd == null)
        ? 'Sans elle, ni distensibilité ni compliance ne peuvent être calculées.'
        : 'Relevée au moment de l\'examen — une pression d\'un autre jour fausserait les indices.');

    l += ligne('Variation systolo-diastolique', C.deformation(ds, dd), '%', 'calcul',
      '(Dsystole − Ddiastole) ÷ Ddiastole.');
    l += ligne('Distensibilité aortique', C.distensibilite(ds, dd, ps, pd), '×10⁻³ mmHg⁻¹', 'calcul',
      '2 × (Dsys − Ddia) ÷ (Ddia × pression pulsée).');
    l += ligne('Compliance aortique', C.compliance(ds, dd, ps, pd), 'mm/mmHg', 'calcul',
      '(Dsys − Ddia) ÷ pression pulsée.');
    l += ligne('Indice de rigidité β', C.rigiditeBeta(ds, dd, ps, pd), '', 'calcul',
      'ln(PAs/PAd) ÷ déformation. Moins dépendant du niveau de pression que la distensibilité.');

    // Valeur donnée par l'appareil : affichée à côté, jamais à la place.
    const dr = num(e.distensibilite_rapportee);
    if (dr != null) {
      l += ligne('Distensibilité rapportée par l\'appareil', dr, '×10⁻³ mmHg⁻¹', 'mesure',
        'Affichée pour comparaison avec le calcul ci-dessus. Un écart important signale une mesure à revoir.');
    }
    return bloc('Paroi aortique', l);
  }

  function texteLibre(e) {
    const parts = [
      ['Ventricule gauche', e.vg_texte], ['Ventricule droit', e.vd_texte],
      ['Oreillettes', e.oreillettes_texte], ['Valve mitrale', e.valve_mitrale_texte],
      ['Valve aortique', e.valve_aortique_texte], ['Valve tricuspide', e.valve_tricuspide_texte],
      ['Gros vaisseaux', e.gros_vaisseaux_texte]
    ].filter(([, t]) => t && String(t).trim());

    let html = '';
    if (parts.length) {
      html += '<details class="dossier-annexe" style="margin-bottom:12px;">' +
        '<summary>📄 Description du compte rendu</summary><div>' +
        parts.map(([t, v]) =>
          '<div style="margin-bottom:9px;"><strong style="font-size:12px; color:#0b1530;">' + esc(t) + '</strong>' +
          '<div style="font-size:12.5px; color:#475569; line-height:1.6;">' + esc(v) + '</div></div>').join('') +
        '</div></details>';
    }
    if (e.conclusion && String(e.conclusion).trim()) {
      html += '<div style="padding:13px 15px; border:1px solid #bae6fd; border-left:4px solid #0ea5e9; ' +
        'border-radius:11px; background:#f0f9ff; margin-bottom:14px;">' +
        '<div style="font-size:12px; font-weight:800; color:#075985; margin-bottom:5px;">Conclusion du compte rendu</div>' +
        '<div style="font-size:13px; color:#0c4a6e; line-height:1.65; white-space:pre-wrap;">' +
          esc(e.conclusion) + '</div></div>';
    }
    return html;
  }

  // ============================================================
  // === Évolution du seul diamètre qui décide du suivi =========
  // ============================================================
  function evolutionValsalva(exs) {
    const pts = exs
      .map(e => ({ date: e.exam_date, v: num(e.sinus_valsalva_mm) ?? num(e.aorte_max_mm) }))
      .filter(p => p.v != null && p.date);
    if (pts.length < 2) return '';

    const prem = pts[0], dern = pts[pts.length - 1];
    const d = Math.round((dern.v - prem.v) * 10) / 10;
    const mois = Math.round((new Date(dern.date) - new Date(prem.date)) / 86400000 / 30.4);
    // Une progression ne se juge pas en valeur absolue mais par an : 2 mm en
    // six mois et 2 mm en cinq ans n'appellent pas la même surveillance.
    const parAn = mois >= 6 ? Math.round(d / (mois / 12) * 10) / 10 : null;

    return '<div style="padding:12px 15px; margin-bottom:14px; border-radius:11px; background:#f8fafc; border:1px solid var(--line);">' +
      '<div style="font-size:12px; font-weight:800; color:#0b1530; margin-bottom:5px;">Évolution des sinus de Valsalva</div>' +
      '<div style="font-size:13px; color:#334155; line-height:1.7;">' +
        prem.v + ' mm (' + jour(prem.date) + ') → <strong>' + dern.v + ' mm</strong> (' + jour(dern.date) + ')' +
        ' · <strong style="color:' + (d > 0 ? '#b45309' : '#047857') + ';">' +
        (d > 0 ? '+' : '') + d + ' mm</strong> sur ' + mois + ' mois' +
        (parAn != null ? ' · soit ' + (parAn > 0 ? '+' : '') + parAn + ' mm/an' : '') +
      '</div>' +
      (parAn != null && parAn >= 3
        ? '<div style="font-size:11.5px; color:#991b1b; margin-top:5px;">⚠ Progression rapide : à confronter au seuil d\'indication chirurgicale.</div>'
        : '') +
      (mois < 6
        ? '<div style="font-size:11.5px; color:#64748b; margin-top:5px;">Intervalle court : la vitesse annuelle n\'est pas extrapolée, elle n\'aurait pas de sens.</div>'
        : '') +
      '</div>';
  }

  // ============================================================
  // === Enveloppe ==============================================
  // ============================================================
  function rendre() {
    if (!_examens.length) {
      return carte(
        '<div style="text-align:center; padding:26px 18px; color:#64748b; font-size:13px; line-height:1.65;">' +
        '<div style="font-size:30px; margin-bottom:8px;">🫀</div>' +
        '<strong style="color:#0b1530;">Aucune échocardiographie enregistrée.</strong><br>' +
        'Versez le compte rendu dans <strong>« Verser une pièce »</strong>, en tête du dossier : ' +
        'les mesures en seront extraites, puis relues par vous avant enregistrement.<br>' +
        '<span style="font-size:11.5px;">Tant qu\'aucun compte rendu n\'est versé, les valeurs aortiques du dossier ' +
        'restent des valeurs déclarées — visibles sur la courbe, mais signalées comme telles.</span>' +
        '</div>');
    }

    const C = window.EchoCalculs;
    if (!C) return carte('<div style="padding:14px; color:#991b1b; font-size:12.5px;">Module echo-calculs.js non chargé.</div>');

    const e = _examens[_choisi] || _examens[0];
    const choix = _examens.length > 1
      ? '<select id="edChoix" style="padding:7px 10px; font-size:12.5px; max-width:100%;">' +
          _examens.map((x, i) => '<option value="' + i + '"' + (i === _choisi ? ' selected' : '') + '>' +
            jour(x.exam_date) + (x.centre ? ' — ' + esc(x.centre) : '') + '</option>').join('') +
        '</select>'
      : '<span style="font-size:12.5px; color:#475569;">' + jour(e.exam_date) + '</span>';

    return carte(
      '<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px;">' +
        choix + '<span style="font-size:11.5px; color:#64748b;">' + _examens.length + ' examen(s) au dossier</span>' +
      '</div>' +
      evolutionValsalva(_examens) +
      racineAortique(e, C) + coeur(e, C) + paroiVasculaire(e, C) + texteLibre(e));
  }

  function carte(contenu) {
    return '<article class="card" style="padding:0; margin-bottom:14px; overflow:hidden;">' +
      '<div style="padding:14px 20px; background:linear-gradient(135deg,#be123c,#f43f5e); color:white;">' +
        '<h3 style="margin:0; color:white; font-size:15px;">🫀 Échocardiographie</h3>' +
        '<p style="margin:3px 0 0; font-size:11.5px; opacity:.92;">' +
          'Document de référence pour l\'aorte et le cœur. Les rapports sont recalculés, jamais recopiés.</p>' +
      '</div>' +
      '<div style="padding:16px 20px;">' + contenu + '</div></article>';
  }

  function remonter(el) {
    const sel = document.getElementById('edChoix');
    if (!sel || sel._cable) return;
    sel._cable = true;
    sel.addEventListener('change', () => {
      _choisi = parseInt(sel.value, 10) || 0;
      el.innerHTML = rendre();
      remonter(el);
    });
  }

  async function mount(containerId, patientId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    _patientId = patientId;
    _conteneurId = containerId;
    _choisi = 0;

    el.innerHTML = carte('<div style="text-align:center; padding:18px; color:#94a3b8; font-size:13px;">Lecture des examens…</div>');

    try {
      const r = await window.MarfanAPI.timeline.echoList(patientId);
      _examens = ((r && r.examens) || (r && r.echos) || [])
        .slice()
        .sort((a, b) => new Date(a.exam_date || 0) - new Date(b.exam_date || 0));
      // Le plus récent ouvert par défaut : c'est celui qu'on vient lire.
      _choisi = Math.max(0, _examens.length - 1);
    } catch (e) {
      console.warn('[echo-detail] lecture :', e && e.message);
      el.innerHTML = carte('<div style="padding:13px 15px; border-radius:10px; background:#fef2f2; ' +
        'border:1px solid #fecaca; font-size:12.5px; color:#991b1b;">Lecture impossible : ' +
        esc((e && e.message) || 'erreur') + '</div>');
      return;
    }

    el.innerHTML = rendre();
    remonter(el);
  }

  window.EchoDetailUI = { mount: mount };
})();
