/**
 * synthese-ui.js — Synthèse clinique en trois rubriques
 * ======================================================
 *
 * Le document qu'on relit avant une consultation :
 *
 *   1. Synthèse d'entrée     — qui est ce patient, sa pathologie, son gène,
 *                              sa profession, ses diamètres aortiques et leur
 *                              évolution, ses interventions.
 *   2. Difficultés et objectifs — ce qu'il ressent, ce qu'on vise, et la façon
 *                              dont l'activité physique adaptée à distance
 *                              est mise en place.
 *   3. Suivi de l'activité   — l'état de sa pratique, remis à jour à chaque
 *                              consultation.
 *
 * L'IA rédige à partir du dossier ; le clinicien relit, corrige, enregistre.
 * Le texte affiché est toujours celui qu'un humain a validé : la génération
 * remplit les champs, elle n'enregistre rien d'elle-même.
 *
 * Le bilan d'entretien est à part. Ce sont les notes de l'investigateur ;
 * elles nourrissent les rubriques 1 et 2 sans être publiées telles quelles,
 * car tout ce qui se dit en entretien n'a pas vocation à figurer dans une
 * synthèse partagée.
 *
 * Expose window.SyntheseUI = { mount }
 */
(function () {
  'use strict';

  var _patientId = null;
  var _etat = { entree: '', objectifs: '', suivi_activite: '', bilan_entretien: '' };
  var _chargement = false;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function note(msg, type) {
    if (typeof window.toast === 'function') window.toast(msg, type || 'info', 6000);
  }

  var RUBRIQUES = [
    { cle: 'entree', titre: "Synthèse d'entrée", icone: '📋',
      aide: "Identité, pathologie et gène, profession, diamètres aortiques et leur évolution, interventions." },
    { cle: 'objectifs', titre: 'Difficultés et objectifs', icone: '🎯',
      aide: "Ce que le patient ressent, ce que vous visez avec lui, et l'organisation de l'activité physique adaptée à distance." },
    { cle: 'suivi_activite', titre: "Suivi de l'activité physique", icone: '📈',
      aide: "Nombre de séances, durée moyenne, intensités, ressenti CR10, éducation thérapeutique. À régénérer à chaque consultation." }
  ];

  function gabarit() {
    return '' +
    '<article class="card" style="padding:0; overflow:hidden; margin-bottom:16px;">' +
      '<div style="padding:16px 20px; background:linear-gradient(135deg,#0f766e,#14b8a6); color:white; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">' +
        '<div style="flex:1; min-width:220px;">' +
          '<h3 style="margin:0; color:white; font-size:16px;">🧠 Synthèse clinique</h3>' +
          '<p style="margin:3px 0 0; font-size:12px; opacity:.93;">Rédigée à partir du dossier, relue et validée par vous.</p>' +
        '</div>' +
        '<button id="synGenBtn" class="btn-light" style="font-weight:700;">✨ Rédiger avec l\'IA</button>' +
        '<button id="synSaveBtn" class="btn-light" style="font-weight:700;">💾 Enregistrer</button>' +
      '</div>' +


      '<div style="padding:18px 20px;">' +
        // L'entretien précède la rédaction : on l'enregistre, on relit ce qui
        // en a été tiré, puis seulement on fait rédiger la synthèse.
        '<div id="dossierEntretienMount" style="margin-bottom:18px;"></div>' +
        '<div id="synInfo" style="display:none; margin-bottom:14px; padding:11px 14px; border-radius:10px; font-size:12.5px; line-height:1.55;"></div>' +

        RUBRIQUES.map(function (r) {
          return '' +
          '<div style="margin-bottom:18px;">' +
            '<div style="display:flex; align-items:baseline; gap:8px; margin-bottom:5px;">' +
              '<strong style="font-size:13.5px; color:#0b1530;">' + r.icone + ' ' + r.titre + '</strong>' +
            '</div>' +
            '<p style="margin:0 0 7px; font-size:11.5px; color:#64748b; line-height:1.5;">' + r.aide + '</p>' +
            '<textarea id="syn_' + r.cle + '" rows="6" ' +
              'style="width:100%; padding:11px 13px; border:1px solid #cbd5e1; border-radius:10px; ' +
              'font-family:inherit; font-size:13px; line-height:1.65; resize:vertical; box-sizing:border-box;"></textarea>' +
          '</div>';
        }).join('') +

        '<div style="border-top:1px solid #e2e8f0; padding-top:16px;">' +
          '<div style="display:flex; align-items:baseline; gap:8px; margin-bottom:5px;">' +
            '<strong style="font-size:13.5px; color:#0b1530;">🗒 Bilan d\'entretien</strong>' +
            '<span style="font-size:11px; color:#f97316; font-weight:700;">vos notes — non publiées telles quelles</span>' +
          '</div>' +
          '<p style="margin:0 0 7px; font-size:11.5px; color:#64748b; line-height:1.5;">' +
            'Écrivez librement ce qui ressort de l\'entretien. L\'IA répartit ces éléments dans les rubriques ' +
            'ci-dessus, là où ils ont leur place. Ce texte n\'apparaît pas dans la synthèse.' +
          '</p>' +
          '<textarea id="syn_bilan_entretien" rows="5" ' +
            'style="width:100%; padding:11px 13px; border:1px solid #fed7aa; background:#fffbeb; border-radius:10px; ' +
            'font-family:inherit; font-size:13px; line-height:1.65; resize:vertical; box-sizing:border-box;"></textarea>' +
        '</div>' +

        '<div id="synMeta" style="margin-top:14px; font-size:11px; color:#94a3b8;"></div>' +
      '</div>' +
    '</article>';
  }

  function lireChamps() {
    ['entree', 'objectifs', 'suivi_activite', 'bilan_entretien'].forEach(function (k) {
      var t = el('syn_' + k);
      if (t) _etat[k] = t.value;
    });
    return _etat;
  }

  function ecrireChamps() {
    ['entree', 'objectifs', 'suivi_activite', 'bilan_entretien'].forEach(function (k) {
      var t = el('syn_' + k);
      if (t) t.value = _etat[k] || '';
    });
  }

  function info(html, ton) {
    var z = el('synInfo');
    if (!z) return;
    if (!html) { z.style.display = 'none'; return; }
    var couleurs = {
      ok:      ['#ecfdf5', '#a7f3d0', '#065f46'],
      alerte:  ['#fffbeb', '#fde68a', '#92400e'],
      erreur:  ['#fef2f2', '#fecaca', '#991b1b'],
      neutre:  ['#f8fafc', '#e2e8f0', '#475569']
    };
    var c = couleurs[ton || 'neutre'];
    z.style.cssText = 'display:block; margin-bottom:14px; padding:11px 14px; border-radius:10px; ' +
      'font-size:12.5px; line-height:1.55; background:' + c[0] + '; border:1px solid ' + c[1] + '; color:' + c[2] + ';';
    z.innerHTML = html;
  }

  function majMeta(s) {
    var m = el('synMeta');
    if (!m) return;
    var bouts = [];
    if (s && s.maj_le) bouts.push('Dernier enregistrement : ' + new Date(s.maj_le).toLocaleString('fr-FR'));
    if (s && s.generee_le) bouts.push('Dernière rédaction IA : ' + new Date(s.generee_le).toLocaleString('fr-FR'));
    m.textContent = bouts.join(' · ');
  }

  /**
   * Patient de démonstration : ses données vivent dans le navigateur, pas en
   * base. Interroger le serveur renvoyait une erreur et le panneau s'ouvrait
   * sur un message rouge — désagréable quand on fait justement une démonstration.
   */
  function patientDemo() {
    var p = (window.patients || []).find(function (x) { return x.id === _patientId; });
    return (p && p.demo && !p._fromApi) ? p : null;
  }

  /** Synthèse d'exemple, construite depuis les données en mémoire */
  function syntheseDemo(p) {
    var c = p.civil || {};
    var evals = p.evaluations || [];
    var der = evals.length ? evals[evals.length - 1] : null;
    var prem = evals.length ? evals[0] : null;
    var entree = c.firstName
      ? c.firstName + ' ' + c.lastName + ', ' + (p.sex || '').toLowerCase() + ' de ' + p.age +
        ' ans, ' + (c.profession ? c.profession.toLowerCase() + ', ' : '') +
        'suivie pour un syndrome de Marfan avec mutation du gène ' + (p.gene || '—') + '. ' +
        (der ? 'Le dernier diamètre aortique enregistré est de ' + der.aorta + ' mm' +
               (prem && prem !== der ? ', contre ' + prem.aorta + ' mm à l\'inclusion' : '') + '. ' : '') +
        (der ? 'La VO₂ de pic s\'établit à ' + der.vo2 + ' mL/min/kg.' : '')
      : '';
    var objectifs = (p.incidents && p.incidents.length)
      ? 'Les précautions retenues sont les suivantes : ' + p.incidents.join(', ').toLowerCase() + '. ' +
        'L\'accompagnement se déroule à distance, en visioconférence, par séances encadrées ' +
        'avec suivi de la fréquence cardiaque en direct.'
      : '';
    var suivi = der
      ? 'Les repères d\'intensité sont issus de la dernière épreuve d\'effort : premier seuil ' +
        'ventilatoire à ' + der.sv1Fc + ' battements par minute, second seuil à ' + der.sv2Fc +
        ', pic à ' + der.fcPeak + '.'
      : '';
    return { entree: entree, objectifs: objectifs, suivi_activite: suivi, bilan_entretien: '' };
  }

  async function charger() {
    var d = patientDemo();
    if (d) {
      _etat = syntheseDemo(d);
      ecrireChamps();
      majMeta(null);
      info("<strong>Patient de démonstration.</strong> Cette synthèse est un exemple généré " +
           "à partir des données affichées ; elle n'est ni enregistrée ni transmise à l'IA.", 'alerte');
      return;
    }
    try {
      var s = await window.MarfanAPI.synthese.get(_patientId);
      _etat = {
        entree: s.entree || '',
        objectifs: s.objectifs || '',
        suivi_activite: s.suivi_activite || '',
        bilan_entretien: s.bilan_entretien || ''
      };
      ecrireChamps();
      majMeta(s);
    } catch (e) {
      info("Synthèse non chargée : " + esc(e && e.message ? e.message : ''), 'erreur');
    }
  }

  async function enregistrer() {
    if (_chargement) return;
    if (patientDemo()) {
      info("Patient de démonstration : rien n'est enregistré. Créez une vraie fiche pour utiliser cette fonction.", 'alerte');
      return;
    }
    lireChamps();
    var b = el('synSaveBtn');
    if (b) { b.disabled = true; b.textContent = '💾 Enregistrement…'; }
    try {
      var s = await window.MarfanAPI.synthese.save(_patientId, _etat);
      majMeta(s);
      note('💾 Synthèse enregistrée.', 'success');
      info('', null);
    } catch (e) {
      info("Enregistrement impossible : " + esc(e && e.message ? e.message : ''), 'erreur');
    } finally {
      if (b) { b.disabled = false; b.textContent = '💾 Enregistrer'; }
    }
  }

  /** Noms lisibles des blocs de données, pour dire ce qui a servi */
  var LIBELLES = {
    identite: 'identité', aorte: 'suivi aortique', antecedents: 'antécédents',
    histoire: 'histoire de la maladie', objectifs_patient: 'objectifs du patient',
    objectifs_clinicien: 'objectifs du clinicien', mesures_aortiques: 'mesures aortiques',
    evolution_derniere: 'évolution du dernier diamètre', operations: 'interventions',
    echocardiographies: 'échocardiographies', activite_physique: 'séances réalisées',
    seuils_ventilatoires: 'seuils ventilatoires', education_therapeutique: 'éducation thérapeutique',
    bilan_entretien: "bilan d'entretien"
  };

  async function generer() {
    if (_chargement) return;
    if (patientDemo()) {
      info("Patient de démonstration : le dossier n'existe pas en base, l'IA n'a rien à lire. " +
           "Créez une fiche réelle pour essayer la rédaction assistée.", 'alerte');
      return;
    }
    lireChamps();

    var rempli = _etat.entree || _etat.objectifs || _etat.suivi_activite;
    if (rempli && !confirm(
      "La rédaction par l'IA va remplacer le contenu des trois rubriques.\n\n" +
      "Votre texte actuel sera écrasé dans le formulaire — mais rien n'est enregistré " +
      "tant que vous ne cliquez pas sur « Enregistrer ».\n\nContinuer ?")) return;

    _chargement = true;
    var b = el('synGenBtn');
    if (b) { b.disabled = true; b.textContent = '✨ Rédaction en cours…'; }
    info("Lecture du dossier et rédaction… cela prend quelques secondes.", 'neutre');

    try {
      var r = await window.MarfanAPI.synthese.generer(_patientId, {
        bilan_entretien: _etat.bilan_entretien
      });
      _etat.entree = r.entree || '';
      _etat.objectifs = r.objectifs || '';
      _etat.suivi_activite = r.suivi_activite || '';
      ecrireChamps();

      var blocs = (r.blocs_disponibles || [])
        .filter(function (k) { return LIBELLES[k]; })
        .map(function (k) { return LIBELLES[k]; });

      var vides = RUBRIQUES.filter(function (x) { return !_etat[x.cle]; })
                           .map(function (x) { return x.titre.toLowerCase(); });

      var html = "<strong>Proposition rédigée.</strong> Relisez-la, corrigez ce qui doit l'être, " +
                 "puis cliquez sur « Enregistrer » — rien n'est conservé avant cela.";
      if (blocs.length) html += "<br><span style='opacity:.85;'>Éléments utilisés : " + esc(blocs.join(', ')) + ".</span>";
      if (vides.length) {
        html += "<br><span style='opacity:.85;'>Rubrique(s) laissée(s) vide(s), faute de données au dossier : " +
                esc(vides.join(', ')) + ".</span>";
      }
      info(html, 'ok');
      note('✨ Synthèse rédigée — à relire avant enregistrement.', 'success');
    } catch (e) {
      info("Rédaction impossible : " + esc(e && e.message ? e.message : 'erreur inconnue'), 'erreur');
    } finally {
      _chargement = false;
      if (b) { b.disabled = false; b.textContent = "✨ Rédiger avec l'IA"; }
    }
  }

  /**
   * Affiche le panneau pour un patient donné.
   * Réservé au personnel soignant : un patient ne voit pas sa synthèse
   * clinique, qui contient des éléments de pronostic.
   */
  function mount(conteneurId, patientId) {
    var hote = el(conteneurId);
    if (!hote) return;
    var u = (window.MarfanAPI && window.MarfanAPI.currentUser && window.MarfanAPI.currentUser()) || {};
    if (u.role === 'patient') { hote.innerHTML = ''; return; }
    if (!patientId) { hote.innerHTML = ''; return; }

    _patientId = patientId;
    hote.innerHTML = gabarit();
    var g = el('synGenBtn'); if (g) g.addEventListener('click', generer);
    var s = el('synSaveBtn'); if (s) s.addEventListener('click', enregistrer);
    // Entretien enregistré : ce qui en est retenu alimente le bilan
    // d'entretien juste en dessous, qui nourrit à son tour la synthèse.
    try {
      if (window.EntretienUI) window.EntretienUI.monter('dossierEntretienMount', { patientId: patientId });
    } catch (e) { console.warn('[entretien] montage échoué :', e && e.message); }
    charger();
  }

  window.SyntheseUI = { mount: mount };
})();
