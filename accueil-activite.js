/**
 * accueil-activite.js — L'activité physique de la cohorte, en tête d'accueil
 * ===========================================================================
 *
 * La page d'accueil annonçait un nombre d'évaluations. C'est une mesure de
 * ce que les patients *peuvent* faire. Ce qu'on vient y chercher le matin,
 * c'est ce qu'ils *ont* fait : combien de séances, combien d'heures, à
 * quelle intensité, et qui décroche.
 *
 * Deux principes tenus jusqu'au bout.
 *
 * **Un écran vide dit qu'il est vide.** Tant qu'aucune séance n'a été
 * enregistrée, cette carte ne montre pas « 0 h » et « 0 kcal » — elle
 * explique d'où viendront les chiffres. La différence n'est pas cosmétique :
 * « personne ne s'entraîne » et « rien n'a encore été enregistré »
 * n'appellent pas la même réaction.
 *
 * **Un volume n'est jamais montré sans sa part de patients.** Quarante
 * heures d'activité sur treize patients ne veulent rien dire si trente-huit
 * sont le fait d'un seul. La proportion de patients actifs est donc
 * affichée à côté du total, pas ailleurs.
 */
(function () {
  'use strict';

  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const jour = (d) => {
    if (!d) return '—';
    const x = new Date(d);
    return isNaN(x) ? String(d) : x.toLocaleDateString('fr-FR');
  };

  const MODALITES = {
    endurance:     { l: 'Endurance',            c: '#0ea5e9' },
    renforcement:  { l: 'Renforcement',         c: '#8b5cf6' },
    combine:       { l: 'Combiné',              c: '#14b8a6' },
    autre:         { l: 'Autre',                c: '#94a3b8' },
    non_precisee:  { l: 'Non précisée',         c: '#cbd5e1' }
  };

  function chiffre(valeur, libelle, precision, couleur) {
    const vide = valeur == null || valeur === '';
    return '<div style="flex:1 1 150px; min-width:138px; padding:13px 15px; border:1px solid var(--line); border-radius:12px; background:#fff;">' +
      '<div style="font-size:10.5px; color:#64748b; font-weight:700; text-transform:uppercase; letter-spacing:.04em;">' +
        esc(libelle) + '</div>' +
      '<div style="font-size:23px; font-weight:800; margin-top:3px; color:' + (vide ? '#cbd5e1' : (couleur || '#0b1530')) + ';">' +
        (vide ? '—' : esc(valeur)) + '</div>' +
      (precision ? '<div style="font-size:11px; color:#94a3b8; margin-top:2px; line-height:1.4;">' + esc(precision) + '</div>' : '') +
      '</div>';
  }

  /** Répartition par modalité : barre proportionnelle, pas un camembert. */
  function barreModalites(mods) {
    const total = mods.reduce((s, m) => s + m.nb, 0);
    if (!total) return '';
    const seg = mods.map(m => {
      const d = MODALITES[m.modalite] || { l: m.modalite, c: '#94a3b8' };
      const pct = (m.nb / total) * 100;
      return '<div title="' + esc(d.l) + ' : ' + m.nb + ' séance(s)" style="width:' + pct +
        '%; background:' + d.c + ';"></div>';
    }).join('');
    const legende = mods.map(m => {
      const d = MODALITES[m.modalite] || { l: m.modalite, c: '#94a3b8' };
      const pct = Math.round((m.nb / total) * 100);
      return '<span style="display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:#475569;">' +
        '<span style="width:9px; height:9px; border-radius:2px; background:' + d.c + ';"></span>' +
        esc(d.l) + ' ' + pct + ' %' +
        (m.heures ? ' <span style="color:#94a3b8;">(' + m.heures + ' h)</span>' : '') + '</span>';
    }).join('');

    const nonPrecisees = mods.find(m => m.modalite === 'non_precisee');
    const avertissement = nonPrecisees && nonPrecisees.nb / total > 0.3
      ? '<div style="font-size:11.5px; color:#92400e; margin-top:6px; line-height:1.5;">' +
        'Plus d\'un tiers des séances n\'ont pas de modalité renseignée : la répartition ci-dessus ne décrit qu\'une partie du travail réalisé.</div>'
      : '';

    return '<div style="margin-top:14px;">' +
      '<div style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.04em; margin-bottom:6px;">' +
        'Répartition par modalité</div>' +
      '<div style="display:flex; height:11px; border-radius:99px; overflow:hidden; background:#f1f5f9;">' + seg + '</div>' +
      '<div style="display:flex; gap:14px; flex-wrap:wrap; margin-top:8px;">' + legende + '</div>' +
      avertissement + '</div>';
  }

  /**
   * Charge hebdomadaire — histogramme en SVG, sans dépendance.
   *
   * Les semaines sans séance sont dessinées comme des creux, pas omises :
   * un graphique qui saute les semaines vides montre une activité régulière
   * là où il y a eu des interruptions.
   */
  function graphiqueCharge(points, semaines) {
    if (!points.length) return '';

    // Reconstitution de la série complète, semaine par semaine.
    const parSemaine = new Map(points.map(p => [String(p.semaine).slice(0, 10), p]));
    const serie = [];
    const debut = new Date();
    debut.setDate(debut.getDate() - debut.getDay() + 1 - semaines * 7);
    for (let i = 0; i <= semaines; i++) {
      const d = new Date(debut); d.setDate(d.getDate() + i * 7);
      const cle = d.toISOString().slice(0, 10);
      const p = parSemaine.get(cle);
      serie.push({ date: d, seances: p ? p.seances : 0, heures: p ? Number(p.heures) : 0 });
    }

    const max = Math.max(1, ...serie.map(s => s.seances));
    const L = 520, H = 120, bas = 96, g = 30;
    const largeur = (L - g - 10) / serie.length;

    const barres = serie.map((s, i) => {
      const h = (s.seances / max) * (bas - 10);
      const x = g + i * largeur;
      const titre = s.date.toLocaleDateString('fr-FR') + ' — ' + s.seances + ' séance(s)' +
                    (s.heures ? ', ' + s.heures + ' h' : '');
      return '<rect x="' + (x + 1) + '" y="' + (bas - h) + '" width="' + Math.max(2, largeur - 2) +
        '" height="' + Math.max(s.seances ? 2 : 1, h) + '" rx="2" fill="' +
        (s.seances ? '#0f766e' : '#e2e8f0') + '"><title>' + esc(titre) + '</title></rect>';
    }).join('');

    const premier = serie[0].date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
    const dernier = serie[serie.length - 1].date.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });

    return '<div style="margin-top:16px;">' +
      '<div style="font-size:11px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.04em; margin-bottom:4px;">' +
        'Charge d\'entraînement, ' + semaines + ' dernières semaines</div>' +
      '<svg viewBox="0 0 ' + L + ' ' + H + '" style="width:100%; height:auto;">' +
        '<line x1="' + g + '" y1="' + bas + '" x2="' + (L - 10) + '" y2="' + bas + '" stroke="#e2e8f0" stroke-width="1"/>' +
        '<text x="4" y="16" font-size="10" fill="#94a3b8">' + max + '</text>' +
        '<text x="4" y="' + (bas + 4) + '" font-size="10" fill="#94a3b8">0</text>' +
        barres +
        '<text x="' + g + '" y="' + (H - 4) + '" font-size="10" fill="#94a3b8">' + esc(premier) + '</text>' +
        '<text x="' + (L - 10) + '" y="' + (H - 4) + '" font-size="10" fill="#94a3b8" text-anchor="end">' + esc(dernier) + '</text>' +
      '</svg>' +
      '<div style="font-size:11px; color:#94a3b8; margin-top:2px;">Séances par semaine. Les semaines sans séance restent visibles, en gris.</div>' +
      '</div>';
  }

  function carte(contenu) {
    return '<article class="card" style="padding:0; margin-bottom:16px; overflow:hidden;">' +
      '<div style="padding:15px 20px; background:linear-gradient(135deg,#0f766e,#14b8a6); color:white;">' +
        '<h3 style="margin:0; color:white; font-size:16px;">🏃 Activité physique de la cohorte</h3>' +
        '<p style="margin:3px 0 0; font-size:11.5px; opacity:.92;">Ce que les patients ont réellement fait — séances, volume, intensité.</p>' +
      '</div>' +
      '<div style="padding:16px 20px;">' + contenu + '</div></article>';
  }

  function rendre(d) {
    if (!d || d.aucune_seance) {
      return carte(
        '<div style="text-align:center; padding:24px 18px; color:#64748b; font-size:13px; line-height:1.7;">' +
        '<div style="font-size:30px; margin-bottom:8px;">🚶</div>' +
        '<strong style="color:#0b1530;">Aucune séance enregistrée à ce jour.</strong><br>' +
        'Ces indicateurs se remplissent seuls dès la première séance menée en visioconférence : ' +
        'durée, fréquences cardiaques, ressenti de fin de séance et modalité.<br>' +
        '<span style="font-size:11.5px;">' + (d && d.patients_total ? d.patients_total + ' patient(s) au dossier. ' : '') +
        'Le taux d\'assiduité demandera en plus un rythme de séances prescrit, ' +
        'sans quoi il n\'aura pas de dénominateur.</span></div>');
    }

    let html = '<div style="display:flex; flex-wrap:wrap; gap:10px;">';
    html += chiffre(d.seances, 'Séances réalisées',
      d.premiere ? 'depuis le ' + jour(d.premiere) : null, '#0f766e');
    html += chiffre(d.heures != null ? d.heures + ' h' : null, 'Volume total',
      d.duree_moyenne_min ? 'séance moyenne : ' + d.duree_moyenne_min + ' min' : null, '#0f766e');
    html += chiffre(
      d.patients_actifs + (d.patients_total ? ' / ' + d.patients_total : ''),
      'Patients actifs',
      d.part_actifs_pct != null ? d.part_actifs_pct + ' % de la cohorte' : null,
      d.part_actifs_pct != null && d.part_actifs_pct < 50 ? '#b45309' : '#0f766e');
    html += '</div><div style="display:flex; flex-wrap:wrap; gap:10px; margin-top:10px;">';
    html += chiffre(d.kcal != null ? d.kcal.toLocaleString('fr-FR') : null, 'Dépense cumulée',
      d.kcal != null ? 'kcal, estimée à partir de la FC' : 'exige une ceinture cardiofréquencemètre');
    html += chiffre(d.cr10_moyen != null ? d.cr10_moyen + ' / 10' : null, 'Ressenti moyen', 'échelle de Borg CR10');
    html += chiffre(d.fc_moyenne != null ? d.fc_moyenne + ' bpm' : null, 'FC moyenne en séance');
    html += '</div>';

    if (d.modalites && d.modalites.length) html += barreModalites(d.modalites);
    if (d.charge_hebdomadaire) html += graphiqueCharge(d.charge_hebdomadaire, d.semaines_demandees || 12);

    // L'assiduité n'est pas un chiffre qu'on affiche à tout prix.
    const p = d.prescription || {};
    html += '<div style="margin-top:14px; padding:11px 14px; border-radius:10px; font-size:12.5px; line-height:1.6; ' +
      (p.avec_prescription
        ? 'background:#f0fdfa; border:1px solid #99f6e4; color:#115e59;">' +
          '<strong>' + p.avec_prescription + ' patient(s)</strong> ont un rythme de séances prescrit' +
          (p.rythme_moyen ? ', ' + p.rythme_moyen + ' par semaine en moyenne' : '') +
          '. Le taux d\'assiduité est calculé pour eux, dossier par dossier.'
        : 'background:#fffbeb; border:1px solid #fde68a; color:#92400e;">' +
          '<strong>Aucun rythme de séances prescrit.</strong> Le taux d\'assiduité ne peut pas être calculé : ' +
          'il lui manque son dénominateur. Renseignez le nombre de séances par semaine dans le programme du patient.') +
      '</div>';

    return carte(html);
  }

  async function mount(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = carte('<div style="text-align:center; padding:18px; color:#94a3b8; font-size:13px;">Lecture de l\'activité…</div>');
    try {
      const d = await window.MarfanAPI.cohort.activite(12);
      el.innerHTML = rendre(d);
    } catch (e) {
      console.warn('[accueil-activite]', e && e.message);
      el.innerHTML = carte('<div style="padding:13px 15px; border-radius:10px; background:#fef2f2; ' +
        'border:1px solid #fecaca; font-size:12.5px; color:#991b1b;">Lecture impossible : ' +
        esc((e && e.message) || 'erreur') + '</div>');
    }
  }

  window.AccueilActivite = { mount: mount };
})();
