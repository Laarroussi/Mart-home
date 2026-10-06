/* ============================================================
   PARCOURS DU PATIENT — bilans d'entrée, intermédiaires et de sortie
   ------------------------------------------------------------
   Le dossier ne sert plus seulement à consulter : c'est ici que se mène
   l'entretien de suivi en cours d'année. Chaque entretien produit un bilan
   daté, qui couvre la période écoulée depuis le précédent.

   Un choix de forme mérite d'être expliqué. La liste des bilans reste
   toujours visible, et l'on n'en ouvre qu'un à la fois. On lit un parcours
   comme une chronologie, pas comme un empilement de pages : voir d'un coup
   d'œil qu'il y a eu trois entretiens en huit mois dit déjà quelque chose
   du suivi.

   Les chiffres affichés dans l'encart « ce qui a servi » ne sont pas
   recalculés ici : ils viennent de la colonne `donnees`, figée au moment de
   la création du bilan. C'est ce qui permet de relire un bilan de l'an
   dernier et de retrouver exactement les nombres sur lesquels il reposait,
   même si des séances ont été corrigées depuis.
   ============================================================ */
(function () {
  'use strict';

  var _patientId = null;
  var _bilans = [];
  var _ouvert = null;      // id du bilan affiché
  var _occupe = false;

  function el(id) { return document.getElementById(id); }
  function esc(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function jour(d) {
    if (!d) return '';
    var x = new Date(d);
    return isNaN(x) ? String(d) : x.toLocaleDateString('fr-FR');
  }
  function note(msg, type) {
    if (typeof window.toast === 'function') window.toast(msg, type || 'info', 6000);
  }

  var ETIQUETTES = {
    entree:        { libelle: "Bilan d'entrée",     couleur: '#0369a1', fond: '#f0f9ff', bord: '#bae6fd' },
    intermediaire: { libelle: 'Bilan intermédiaire', couleur: '#7c3aed', fond: '#faf5ff', bord: '#ddd6fe' },
    sortie:        { libelle: 'Bilan de sortie',     couleur: '#b45309', fond: '#fffbeb', bord: '#fde68a' }
  };

  var RUBRIQUES = [
    { cle: 'contexte', titre: 'Contexte médical de la période',
      aide: "Ce qui est survenu depuis le bilan précédent : consultation, nouvelle mesure aortique, intervention, changement de traitement. L'absence d'événement est elle aussi une information." },
    { cle: 'activite', titre: "Activité physique réalisée",
      aide: "Nombre de séances et régularité, durée moyenne, intensités rapportées aux seuils ventilatoires, ressenti CR10, modules d'éducation thérapeutique suivis." },
    { cle: 'objectifs', titre: 'Progression et objectifs pour la suite',
      aide: "Écarts chiffrés entre évaluations, ce que le patient exprime, l'objectif retenu pour la période suivante et les adaptations décidées." }
  ];

  // ============================================================
  // Rendu
  // ============================================================
  function gabarit() {
    return '' +
    '<article class="card" style="padding:0; overflow:hidden; margin-bottom:16px;">' +
      '<div style="padding:16px 20px; background:linear-gradient(135deg,#1e3a8a,#0891b2); color:#fff; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">' +
        '<div style="flex:1; min-width:220px;">' +
          '<h3 style="margin:0; color:#fff; font-size:16px;">🗂 Parcours du patient</h3>' +
          '<p style="margin:3px 0 0; font-size:12px; opacity:.93;">Entretien d\'entrée, entretiens de suivi, bilan de sortie.</p>' +
        '</div>' +
        '<button id="bilNouveauBtn" class="btn-light" style="font-weight:700;">+ Entretien de suivi</button>' +
        '<button id="bilSortieBtn" class="btn-light" style="font-weight:700;">🏁 Bilan de sortie</button>' +
        '<button id="bilDossierBtn" class="btn-light" style="font-weight:700;">🖨 Dossier complet</button>' +
      '</div>' +
      '<div style="padding:16px 20px;">' +
        '<div id="bilInfo" style="display:none; margin-bottom:14px; padding:11px 14px; border-radius:10px; font-size:12.5px; line-height:1.55;"></div>' +
        '<div id="bilListe" style="margin-bottom:16px;"></div>' +
        '<div id="bilDetail"></div>' +
      '</div>' +
    '</article>';
  }

  function info(html, ton) {
    var z = el('bilInfo');
    if (!z) return;
    if (!html) { z.style.display = 'none'; z.innerHTML = ''; return; }
    var c = ton === 'erreur' ? ['#fef2f2', '#fecaca', '#991b1b']
          : ton === 'ok'     ? ['#ecfdf5', '#a7f3d0', '#065f46']
          : ton === 'alerte' ? ['#fffbeb', '#fde68a', '#92400e']
                             : ['#f8fafc', '#e2e8f0', '#475569'];
    z.style.display = 'block';
    z.style.background = c[0]; z.style.border = '1px solid ' + c[1]; z.style.color = c[2];
    z.innerHTML = html;
  }

  function dessinerListe() {
    var z = el('bilListe');
    if (!z) return;
    if (!_bilans.length) {
      z.innerHTML = '<div style="padding:16px 18px; background:#f8fafc; border:1px dashed #cbd5e1; ' +
        'border-radius:10px; font-size:13px; color:#64748b; line-height:1.6;">' +
        'Aucun bilan pour l\'instant. Le bilan d\'entrée est créé depuis la fiche patient ; ' +
        'les entretiens de suivi se lancent avec le bouton ci-dessus.</div>';
      return;
    }
    z.innerHTML = _bilans.map(function (b) {
      var e = ETIQUETTES[b.type] || ETIQUETTES.intermediaire;
      var actif = b.id === _ouvert;
      var seances = (b.donnees && b.donnees.seances && b.donnees.seances.nb_seances) || 0;
      return '' +
      '<button type="button" data-bilan="' + b.id + '" style="' +
        'display:flex; align-items:center; gap:12px; width:100%; text-align:left; margin-bottom:7px; ' +
        'padding:11px 14px; border-radius:10px; cursor:pointer; font-family:inherit; ' +
        'border:1px solid ' + (actif ? e.couleur : e.bord) + '; ' +
        'background:' + (actif ? e.fond : '#fff') + '; ' +
        (actif ? 'box-shadow:0 2px 10px rgba(8,145,178,.14);' : '') + '">' +
        '<span style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; ' +
          'color:' + e.couleur + '; background:' + e.fond + '; border:1px solid ' + e.bord + '; ' +
          'border-radius:6px; padding:3px 8px; white-space:nowrap;">' + esc(e.libelle) + '</span>' +
        '<span style="flex:1; min-width:0; font-size:13px; font-weight:700; color:#0b1530;">' +
          jour(b.date_bilan) +
          (seances ? ' <span style="font-weight:600; color:#64748b;">· ' + seances + ' séance' + (seances > 1 ? 's' : '') + '</span>' : '') +
        '</span>' +
        '<span style="font-size:11.5px; font-weight:700; white-space:nowrap; color:' +
          (b.validee ? '#065f46' : '#b45309') + ';">' +
          (b.validee ? '✓ validé' : '✎ brouillon') + '</span>' +
      '</button>';
    }).join('');

    Array.prototype.forEach.call(z.querySelectorAll('[data-bilan]'), function (b) {
      b.addEventListener('click', function () { ouvrir(Number(b.dataset.bilan)); });
    });
  }

  /** Encart replié : les chiffres qui ont servi à rédiger. Replié parce
   *  qu'on les consulte pour vérifier, pas pour lire. */
  function encartDonnees(d) {
    if (!d || !Object.keys(d).length) return '';
    var l = [];
    var s = d.seances;
    if (s) {
      var t = s.nb_seances + ' séance' + (s.nb_seances > 1 ? 's' : '');
      if (s.seances_par_semaine) t += ', ' + s.seances_par_semaine + '/semaine';
      if (s.duree_moyenne_min) t += ', ' + s.duree_moyenne_min + ' min en moyenne';
      if (s.fc_moyenne) t += ', FC moyenne ' + s.fc_moyenne + ' bpm';
      if (s.cr10_moyen != null) t += ', CR10 ' + s.cr10_moyen;
      l.push(['Séances', t]);
    }
    if (d.seances_interrompues) l.push(['Interrompues', d.seances_interrompues]);
    if (d.education_therapeutique && d.education_therapeutique.length) {
      l.push(['Éducation', d.education_therapeutique.map(function (x) { return x.module; }).join(', ')]);
    }
    var ec = d.ecart_depuis_evaluation_precedente;
    if (ec) {
      var p = [];
      if (ec.vo2_pic_ml_kg_min != null) p.push('VO₂ pic ' + (ec.vo2_pic_ml_kg_min >= 0 ? '+' : '') + ec.vo2_pic_ml_kg_min + ' mL/kg/min');
      if (ec.watts_pic != null) p.push('puissance ' + (ec.watts_pic >= 0 ? '+' : '') + ec.watts_pic + ' W');
      if (ec.force_kg != null) p.push('force ' + (ec.force_kg >= 0 ? '+' : '') + ec.force_kg + ' kg');
      if (ec.sf36 != null) p.push('SF-36 ' + (ec.sf36 >= 0 ? '+' : '') + ec.sf36);
      if (p.length) l.push(['Évolution sur ' + ec.mois + ' mois', p.join(', ')]);
    }
    if (d.consultations_periode && d.consultations_periode.length) {
      l.push(['Consultations', d.consultations_periode.length]);
    }
    if (!l.length) return '';
    return '<details style="margin-bottom:14px; border:1px solid #e2e8f0; border-radius:10px; padding:10px 13px; background:#f8fafc;">' +
      '<summary style="cursor:pointer; font-size:12px; font-weight:700; color:#475569; list-style:none;">' +
      '📊 Ce qui a servi à rédiger <span style="font-weight:600; color:#94a3b8;">— chiffres figés à la création du bilan</span></summary>' +
      '<div style="margin-top:9px; font-size:12.5px; line-height:1.7; color:#334155;">' +
      l.map(function (x) {
        return '<div><strong style="color:#64748b; font-weight:700;">' + esc(x[0]) + ' :</strong> ' + esc(x[1]) + '</div>';
      }).join('') + '</div></details>';
  }

  function dessinerDetail() {
    var z = el('bilDetail');
    if (!z) return;
    var b = _bilans.filter(function (x) { return x.id === _ouvert; })[0];
    if (!b) { z.innerHTML = ''; return; }
    var e = ETIQUETTES[b.type] || ETIQUETTES.intermediaire;
    var lecture = b.type === 'entree';

    z.innerHTML = '' +
      '<div style="border-top:1px solid #e2e8f0; padding-top:16px;">' +
        '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px;">' +
          '<strong style="font-size:15px; color:' + e.couleur + ';">' + esc(e.libelle) + ' — ' + jour(b.date_bilan) + '</strong>' +
          (b.periode_debut ? '<span style="font-size:11.5px; color:#64748b;">période du ' +
            jour(b.periode_debut) + ' au ' + jour(b.date_bilan) + '</span>' : '') +
          '<span style="margin-left:auto; display:flex; gap:7px;">' +
            '<button type="button" id="bilImprimerBtn" class="btn-secondary" style="font-size:12px;">🖨 Imprimer ce bilan</button>' +
            (lecture ? '' :
              '<button type="button" id="bilEnregistrerBtn" class="btn-secondary" style="font-size:12px;">💾 Enregistrer</button>' +
              '<button type="button" id="bilValiderBtn" class="btn-gradient" style="font-size:12px;">✓ Valider</button>') +
          '</span>' +
        '</div>' +

        (lecture
          ? '<div style="margin-bottom:12px; padding:10px 13px; background:#f0f9ff; border:1px solid #bae6fd; ' +
            'border-radius:9px; font-size:12.5px; color:#0369a1; line-height:1.55;">' +
            'Le bilan d\'entrée se modifie depuis la synthèse clinique, juste en dessous. ' +
            'Il est affiché ici en lecture seule pour que le parcours se lise d\'un bloc.</div>'
          : '') +

        encartDonnees(b.donnees) +

        RUBRIQUES.map(function (r) {
          var v = b[r.cle] || '';
          if (lecture && !v) return '';
          return '<div style="margin-bottom:16px;">' +
            '<strong style="font-size:13px; color:#0b1530; display:block; margin-bottom:4px;">' + esc(r.titre) + '</strong>' +
            (lecture
              ? '<p style="margin:0; font-size:13px; line-height:1.65; color:#1e293b; white-space:pre-wrap;">' + esc(v) + '</p>'
              : '<p style="margin:0 0 6px; font-size:11.5px; color:#64748b; line-height:1.5;">' + esc(r.aide) + '</p>' +
                '<textarea id="bil_' + r.cle + '" rows="6" style="width:100%; padding:11px 13px; ' +
                'border:1px solid #cbd5e1; border-radius:10px; font-family:inherit; font-size:13px; ' +
                'line-height:1.65; resize:vertical; box-sizing:border-box;">' + esc(v) + '</textarea>') +
            '</div>';
        }).join('') +

        (lecture ? '' :
          '<div style="border-top:1px solid #e2e8f0; padding-top:14px;">' +
            '<strong style="font-size:13px; color:#0b1530; display:block; margin-bottom:4px;">🗒 Notes d\'entretien ' +
            '<span style="font-size:11px; color:#f97316;">— non publiées telles quelles</span></strong>' +
            '<p style="margin:0 0 6px; font-size:11.5px; color:#64748b; line-height:1.5;">' +
            'Ce que dit le patient pendant l\'entretien. L\'IA s\'en sert pour nourrir les rubriques ci-dessus ; ' +
            'ce texte n\'apparaît pas dans le bilan imprimé.</p>' +
            '<textarea id="bil_bilan_entretien" rows="4" style="width:100%; padding:11px 13px; ' +
            'border:1px solid #fed7aa; background:#fffbeb; border-radius:10px; font-family:inherit; ' +
            'font-size:13px; line-height:1.65; resize:vertical; box-sizing:border-box;">' +
            esc(b.bilan_entretien || '') + '</textarea>' +
            '<div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">' +
              '<button type="button" id="bilRedigerBtn" class="btn-secondary" style="font-size:12px;">✨ Rédiger à nouveau avec ces notes</button>' +
              (b.validee ? '' : '<button type="button" id="bilSupprBtn" class="btn-light" style="font-size:12px; color:#991b1b;">Supprimer ce brouillon</button>') +
            '</div>' +
          '</div>') +

        '<div style="margin-top:12px; font-size:11px; color:#94a3b8;">' +
          (b.validee
            ? '✓ Validé le ' + jour(b.validee_le) + (b.validee_par_nom ? ' par ' + esc(b.validee_par_nom) : '')
            : 'Brouillon — modifié le ' + jour(b.maj_le)) +
          (b.modele ? ' · proposition rédigée par ' + esc(b.modele) : '') +
        '</div>' +
      '</div>';

    brancher(b);
  }

  function lireChamps() {
    var o = {};
    ['contexte', 'activite', 'objectifs', 'bilan_entretien'].forEach(function (k) {
      var t = el('bil_' + k);
      if (t) o[k] = t.value;
    });
    return o;
  }

  function brancher(b) {
    var p = el('bilImprimerBtn');
    if (p) p.addEventListener('click', function () { imprimerUn(b); });

    var s = el('bilEnregistrerBtn');
    if (s) s.addEventListener('click', function () { enregistrer(b.id); });

    var v = el('bilValiderBtn');
    if (v) v.addEventListener('click', function () { valider(b.id); });

    var r = el('bilRedigerBtn');
    if (r) r.addEventListener('click', function () { redigerANouveau(b); });

    var d = el('bilSupprBtn');
    if (d) d.addEventListener('click', function () { supprimer(b.id); });
  }

  // ============================================================
  // Actions
  // ============================================================
  async function charger() {
    try {
      var r = await window.MarfanAPI.bilans.liste(_patientId);
      _bilans = r.bilans || [];
      if (!_bilans.some(function (x) { return x.id === _ouvert; })) {
        _ouvert = _bilans.length ? _bilans[_bilans.length - 1].id : null;
      }
      dessinerListe();
      dessinerDetail();
    } catch (e) {
      info('Parcours non chargé : ' + esc(e && e.message), 'erreur');
    }
  }

  function ouvrir(id) { _ouvert = id; dessinerListe(); dessinerDetail(); }

  async function creer(type) {
    if (_occupe) return;
    var libelle = type === 'sortie' ? 'bilan de sortie' : 'entretien de suivi';
    if (type === 'sortie' && !confirm(
      "Créer le bilan de sortie ?\n\nIl clôt le parcours et ne peut exister qu'en un seul exemplaire.\n\nContinuer ?")) return;

    _occupe = true;
    info("Lecture des séances, de l'éducation et des évaluations, puis rédaction… quelques secondes.", null);
    try {
      var r = await window.MarfanAPI.bilans.creer(_patientId, { type: type });
      _ouvert = r.bilan && r.bilan.id;
      await charger();
      info("<strong>Proposition rédigée.</strong> Relisez-la, corrigez ce qui doit l'être, " +
           "puis validez : c'est vous qui signez ce bilan.", 'ok');
    } catch (e) {
      info('Création impossible : ' + esc(e && e.message), 'erreur');
    } finally { _occupe = false; }
  }

  async function redigerANouveau(b) {
    if (_occupe) return;
    if (!confirm("Faire rédiger à nouveau remplacera les trois rubriques de ce bilan.\n\n" +
                 "Vos notes d'entretien sont conservées et serviront à la rédaction.\n\nContinuer ?")) return;
    _occupe = true;
    var champs = lireChamps();
    info('Rédaction en cours…', null);
    try {
      // On enregistre d'abord les notes, sinon la nouvelle rédaction
      // ignorerait ce qui vient d'être saisi pendant l'entretien.
      await window.MarfanAPI.bilans.enregistrer(b.id, { bilan_entretien: champs.bilan_entretien || '' });
      await window.MarfanAPI.bilans.supprimer(b.id);
      var r = await window.MarfanAPI.bilans.creer(_patientId, {
        type: b.type, date_bilan: String(b.date_bilan).slice(0, 10),
        periode_debut: b.periode_debut ? String(b.periode_debut).slice(0, 10) : null,
        bilan_entretien: champs.bilan_entretien || ''
      });
      _ouvert = r.bilan && r.bilan.id;
      await charger();
      info('<strong>Nouvelle proposition.</strong> Relisez-la avant de valider.', 'ok');
    } catch (e) {
      info('Rédaction impossible : ' + esc(e && e.message), 'erreur');
      await charger();
    } finally { _occupe = false; }
  }

  async function enregistrer(id) {
    try {
      await window.MarfanAPI.bilans.enregistrer(id, lireChamps());
      await charger();
      note('💾 Bilan enregistré.', 'success');
    } catch (e) {
      info('Enregistrement impossible : ' + esc(e && e.message), 'erreur');
    }
  }

  async function valider(id) {
    var c = lireChamps();
    if (!confirm("Valider ce bilan ?\n\nIl entre alors dans le dossier du patient : " +
                 "il restera modifiable, mais toute modification le ramènera à l'état de brouillon.")) return;
    try {
      await window.MarfanAPI.bilans.valider(id, c);
      await charger();
      note('✓ Bilan validé.', 'success');
    } catch (e) {
      info('Validation impossible : ' + esc(e && e.message), 'erreur');
    }
  }

  async function supprimer(id) {
    if (!confirm('Supprimer ce brouillon ? Cette action est définitive.')) return;
    try {
      await window.MarfanAPI.bilans.supprimer(id);
      _ouvert = null;
      await charger();
      note('Brouillon supprimé.', 'info');
    } catch (e) {
      info('Suppression impossible : ' + esc(e && e.message), 'erreur');
    }
  }

  // ============================================================
  // Impression
  // ============================================================
  function identite() {
    var p = (window.patients || []).filter(function (x) { return x.id === _patientId; })[0] || {};
    var c = p.civil || {}, m = p.medical || {}, e = p.study || {};
    return {
      code: p.id || _patientId,
      nom: c.lastName || c.nom || '', prenom: c.firstName || c.prenom || '',
      ipp: c.ipp || '', dob: c.dob || '', age: p.age || '', sexe: p.sex || '',
      taille_cm: c.heightCm || '', poids_kg: c.weightKg || '',
      profession: c.profession || c.metier || '',
      gene: p.gene || '', variant: m.variant || '',
      date_entree_apa: e.apaStart || e.inclusionDate || '',
      modalites: e.modalites || ''
    };
  }

  function imprimerUn(b) {
    if (!window.FicheAPA) { info('Module d\'impression indisponible. Rechargez la page.', 'erreur'); return; }
    var champs = (b.id === _ouvert && b.type !== 'entree') ? lireChamps() : b;
    var e = ETIQUETTES[b.type] || ETIQUETTES.intermediaire;
    window.FicheAPA.imprimerParcours(identite(), [{
      titre: e.libelle + ' — ' + jour(b.date_bilan),
      periode: b.periode_debut ? 'Période du ' + jour(b.periode_debut) + ' au ' + jour(b.date_bilan) : '',
      sections: sectionsDe(b, champs),
      valide_le: b.validee ? b.validee_le : null,
      auteur: b.validee_par_nom || null
    }]);
  }

  function sectionsDe(b, champs) {
    var src = champs || b;
    if (b.type === 'entree') {
      return [
        ['Histoire de la maladie et éléments médicaux pertinents', src.contexte],
        ['Difficultés physiques, objectifs et prise en charge proposée', src.objectifs]
      ];
    }
    return [
      ['Contexte médical de la période', src.contexte],
      ['Activité physique réalisée', src.activite],
      ['Progression et objectifs pour la suite', src.objectifs]
    ];
  }

  /** Dossier complet : entrée, intermédiaires, sortie, dans l'ordre. C'est le
   *  document que l'on remet en fin de programme — il n'a de sens que lu en
   *  entier, puisque c'est la comparaison entre les bilans qui raconte le
   *  parcours. */
  function imprimerDossier() {
    if (!window.FicheAPA) { info('Module d\'impression indisponible. Rechargez la page.', 'erreur'); return; }
    if (!_bilans.length) { info('Aucun bilan à imprimer.', 'alerte'); return; }
    var brouillons = _bilans.filter(function (b) { return !b.validee; }).length;
    if (brouillons && !confirm(
      brouillons + ' bilan(s) ne sont pas encore validés.\n\n' +
      'Ils figureront dans le document avec la mention « brouillon ».\n\nImprimer quand même ?')) return;

    window.FicheAPA.imprimerParcours(identite(), _bilans.map(function (b) {
      var e = ETIQUETTES[b.type] || ETIQUETTES.intermediaire;
      return {
        titre: e.libelle + ' — ' + jour(b.date_bilan),
        periode: b.periode_debut && b.type !== 'entree'
          ? 'Période du ' + jour(b.periode_debut) + ' au ' + jour(b.date_bilan) : '',
        sections: sectionsDe(b, null),
        valide_le: b.validee ? b.validee_le : null,
        auteur: b.validee_par_nom || null,
        brouillon: !b.validee
      };
    }), { titre: 'Parcours en activité physique adaptée' });
  }

  // ============================================================
  // Montage
  // ============================================================
  function mount(conteneurId, patientId) {
    var hote = el(conteneurId);
    if (!hote) return;
    var u = (window.MarfanAPI && window.MarfanAPI.currentUser && window.MarfanAPI.currentUser()) || {};
    if (u.role === 'patient' || !patientId) { hote.innerHTML = ''; return; }

    _patientId = patientId;
    _ouvert = null;
    hote.innerHTML = gabarit();

    var n = el('bilNouveauBtn'); if (n) n.addEventListener('click', function () { creer('intermediaire'); });
    var s = el('bilSortieBtn');  if (s) s.addEventListener('click', function () { creer('sortie'); });
    var d = el('bilDossierBtn'); if (d) d.addEventListener('click', imprimerDossier);

    charger();
  }

  window.BilansUI = { mount: mount };
})();
