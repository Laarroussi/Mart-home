/**
 * Activité physique réalisée — ce que le patient a effectivement fait.
 * ============================================================
 *
 * Deuxième rubrique du dossier, juste après la synthèse d'entrée. L'ordre
 * n'est pas décoratif : en ouvrant un dossier on ne se demande pas quelles
 * pièces il contient, on se demande où en est la personne. La synthèse dit
 * d'où elle part, cette vue dit ce qu'elle a fait depuis.
 *
 * Tous les chiffres viennent de `GET /bilans/:id/donnees?tout=1`, le même
 * agrégat que celui transmis à l'IA pour rédiger un bilan. Un seul calcul,
 * une seule vérité : ce que vous lisez ici est exactement ce sur quoi le
 * modèle s'appuie. Si les deux divergeaient, il serait impossible de savoir
 * lequel croire.
 *
 * Rien n'est inventé ni extrapolé : une donnée absente s'affiche comme
 * absente. Dans un dossier clinique, un tiret est une information ; un zéro
 * mis à la place d'une mesure manquante est une erreur.
 */
(function () {
  'use strict';

  let _patientId = null;
  let _conteneurId = null;

  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const fmtDate = (d) => {
    if (!d) return '—';
    const x = new Date(d);
    return isNaN(x) ? String(d) : x.toLocaleDateString('fr-FR');
  };

  /** Minutes en « 4 h 20 » : un total en minutes au-delà de deux heures ne se lit plus. */
  function duree(min) {
    if (min == null) return null;
    if (min < 60) return min + ' min';
    const h = Math.floor(min / 60), m = min % 60;
    return h + ' h' + (m ? ' ' + String(m).padStart(2, '0') : '');
  }

  /**
   * Le CR10 de Borg en mots.
   *
   * Un « 4 » seul ne dit rien à qui ne manie pas l'échelle quotidiennement,
   * et c'est l'intensité ressentie qui décide de l'adaptation de la séance.
   */
  function libelleCr10(v) {
    if (v == null) return null;
    const n = Number(v);
    if (n < 1)  return { mot: 'très léger',  couleur: '#0284c7' };
    if (n < 3)  return { mot: 'léger',       couleur: '#0ea5e9' };
    if (n < 5)  return { mot: 'modéré',      couleur: '#16a34a' };
    if (n < 7)  return { mot: 'soutenu',     couleur: '#ca8a04' };
    if (n < 9)  return { mot: 'intense',     couleur: '#ea580c' };
    return { mot: 'maximal', couleur: '#dc2626' };
  }

  function chiffre(valeur, libelle, precision, couleur) {
    const vide = valeur == null || valeur === '';
    return '<div style="flex:1 1 150px; min-width:140px; padding:12px 14px; border:1px solid var(--line); border-radius:11px; background:#fff;">' +
      '<div style="font-size:11px; color:#64748b; font-weight:600; text-transform:uppercase; letter-spacing:.03em;">' + esc(libelle) + '</div>' +
      '<div style="font-size:22px; font-weight:800; margin-top:4px; color:' + (vide ? '#cbd5e1' : (couleur || '#0b1530')) + ';">' +
        (vide ? '—' : esc(valeur)) + '</div>' +
      (precision ? '<div style="font-size:11px; color:#94a3b8; margin-top:2px;">' + esc(precision) + '</div>' : '') +
      '</div>';
  }

  // ============================================================
  // === Rendu ==================================================
  // ============================================================
  function rendre(d, bilan) {
    const s = (d && d.seances) || null;

    // Aucune séance : on le dit, et on s'arrête là. Afficher une grille de
    // tirets laisserait croire à une panne d'affichage.
    if (!s || !s.nb_seances) {
      return carte(
        '<div style="text-align:center; padding:26px 18px; color:#64748b; font-size:13px; line-height:1.6;">' +
        '<div style="font-size:30px; margin-bottom:8px;">🚶</div>' +
        '<strong style="color:#0b1530;">Aucune séance enregistrée pour l\'instant.</strong><br>' +
        'Les séances menées en visioconférence alimentent cette page automatiquement :' +
        ' durée, fréquences cardiaques et ressenti de fin de séance.' +
        '</div>');
    }

    const cr = libelleCr10(s.cr10_moyen);
    const periode = (s.premiere_seance && s.derniere_seance)
      ? 'du ' + fmtDate(s.premiere_seance) + ' au ' + fmtDate(s.derniere_seance)
      : null;

    let html = '';

    // --- Volume ---
    html += '<div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px;">';
    html += chiffre(s.nb_seances, 'Séances réalisées',
                    s.seances_par_semaine ? s.seances_par_semaine + ' par semaine en moyenne' : null, '#0f766e');
    html += chiffre(duree(s.duree_totale_min), 'Temps total d\'activité',
                    s.duree_moyenne_min ? 'séance moyenne : ' + s.duree_moyenne_min + ' min' : null, '#0f766e');
    html += chiffre(s.semaines_couvertes, 'Semaines de suivi', periode);
    html += '</div>';

    // --- Intensité ---
    html += '<div style="display:flex; flex-wrap:wrap; gap:10px; margin-bottom:14px;">';
    html += chiffre(s.fc_moyenne != null ? s.fc_moyenne + ' bpm' : null, 'FC moyenne en séance');
    html += chiffre(s.fc_max_observee != null ? s.fc_max_observee + ' bpm' : null, 'FC maximale observée',
                    'toutes séances confondues', '#b45309');
    html += chiffre(s.cr10_moyen != null ? s.cr10_moyen + ' / 10' : null, 'Ressenti moyen (Borg CR10)',
                    cr ? 'effort ' + cr.mot : null, cr ? cr.couleur : null);
    html += '</div>';

    // --- Séances interrompues : un signal, pas une statistique ---
    if (d.seances_interrompues) {
      html += '<div style="padding:11px 14px; margin-bottom:14px; border-radius:10px; ' +
              'background:#fffbeb; border:1px solid #fde68a; font-size:12.5px; color:#92400e; line-height:1.55;">' +
              '<strong>' + d.seances_interrompues + ' séance(s) interrompue(s)</strong> sur la période. ' +
              'À regarder : fatigue, douleur, intensité mal calibrée ou problème technique ne se corrigent pas de la même façon.' +
              '</div>';
    }

    // --- Éducation thérapeutique ---
    const edu = d.education_therapeutique || [];
    if (edu.length) {
      html += '<div style="padding:12px 14px; margin-bottom:14px; border:1px solid var(--line); border-radius:11px; background:#fff;">' +
        '<div style="font-size:12px; font-weight:700; color:#0b1530; margin-bottom:7px;">🎓 Éducation thérapeutique suivie</div>' +
        edu.map(e =>
          '<div style="display:flex; justify-content:space-between; gap:10px; font-size:12.5px; padding:4px 0; border-top:1px solid #f1f5f9;">' +
          '<span style="color:#334155;">' + esc(e.module) + '</span>' +
          '<span style="font-weight:700; color:' + (e.valide ? '#166534' : '#64748b') + ';">' +
            (e.score != null ? e.score + ' / 100' : '—') + (e.valide ? ' ✓' : '') + '</span>' +
          '</div>').join('') +
        '</div>';
    }

    // --- Le texte : bilan déjà rédigé, ou invitation à en faire rédiger un ---
    if (bilan && bilan.activite) {
      html += '<div style="padding:14px 16px; border:1px solid #bae6fd; border-left:4px solid #0ea5e9; ' +
        'border-radius:11px; background:#f0f9ff;">' +
        '<div style="font-size:12px; font-weight:700; color:#075985; margin-bottom:6px;">' +
          '📝 Bilan du ' + fmtDate(bilan.date_bilan) +
          (bilan.validee ? ' · validé' : ' · <span style="color:#b45309;">brouillon, non validé</span>') + '</div>' +
        '<div style="font-size:13px; color:#0c4a6e; line-height:1.65; white-space:pre-wrap;">' +
          esc(bilan.activite) + '</div>' +
        '</div>';
    } else {
      html += '<div style="padding:12px 15px; border:1px dashed #cbd5e1; border-radius:11px; ' +
        'background:#f8fafc; font-size:12.5px; color:#475569; line-height:1.6;">' +
        'Aucun bilan rédigé pour cette période. Les chiffres ci-dessus sont ceux que l\'IA utilisera : ' +
        'vérifiez-les d\'abord, puis créez le bilan depuis <strong>« 1 · Synthèse »</strong>, rubrique Parcours.' +
        '</div>';
    }

    return carte(html, periode);
  }

  function carte(contenu, periode) {
    return '<article class="card" style="padding:0; margin-bottom:14px; overflow:hidden;">' +
      '<div style="padding:14px 20px; background:linear-gradient(135deg,#0f766e,#14b8a6); color:white;">' +
        '<h3 style="margin:0; color:white; font-size:15px;">🏃 Activité physique réalisée</h3>' +
        '<p style="margin:3px 0 0; font-size:11.5px; opacity:.92;">' +
          (periode ? esc(periode) : 'Séances, intensités et ressenti depuis l\'entrée en APA') + '</p>' +
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

    el.innerHTML = carte('<div style="text-align:center; padding:20px; color:#94a3b8; font-size:13px;">Lecture des séances…</div>');

    let d = null, bilan = null;
    try {
      const r = await window.MarfanAPI.bilans.donnees(patientId, { tout: '1' });
      d = (r && r.donnees) || null;
    } catch (e) {
      console.warn('[activite] agrégat :', e && e.message);
      el.innerHTML = carte(
        '<div style="padding:14px 16px; border-radius:10px; background:#fef2f2; border:1px solid #fecaca; ' +
        'font-size:12.5px; color:#991b1b; line-height:1.55;">Impossible de lire les séances : ' +
        esc((e && e.message) || 'erreur') + '</div>');
      return;
    }

    // Le dernier bilan validé, s'il existe : c'est le texte qui accompagne
    // ces chiffres. Son absence n'est pas une erreur, seulement un dossier
    // qui n'a pas encore été raconté.
    try {
      const r = await window.MarfanAPI.bilans.liste(patientId);
      const tous = (r && r.bilans) || [];
      bilan = tous.filter(b => b.activite).pop() || null;
    } catch (_) {}

    el.innerHTML = rendre(d, bilan);
  }

  window.ActiviteUI = { mount: mount };
})();
