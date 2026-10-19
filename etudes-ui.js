/* ============================================================
   RECHERCHE CLINIQUE — bibliothèque d'études et cahier d'observation
   ------------------------------------------------------------
   Deux écrans et un seul geste : la bibliothèque, puis la fiche d'une étude
   avec son cahier. On n'ouvre qu'une étude à la fois, et le retour est
   toujours visible — un protocole se consulte, il ne se navigue pas.

   Sur le cahier d'observation, un choix mérite d'être expliqué. Les
   variables sont définies ici sans être encore remplies pour les patients.
   Ce n'est pas une étape manquante : un cahier se stabilise avant d'ouvrir
   les inclusions, et commencer à saisir dans un cahier qui bouge encore
   oblige à reprendre les données déjà recueillies. On conçoit d'abord, on
   imprime le dictionnaire, on le fait relire — la saisie viendra ensuite.

   Le dictionnaire imprimé n'est donc pas un sous-produit : c'est le
   livrable de cette phase, celui qu'on joint au protocole et qu'on soumet
   au CPP.
   ============================================================ */
(function () {
  'use strict';

  var _etudes = [];
  var _ouverte = null;   // { etude, sections, patients }
  var _occupe = false;
  var _vue = 'resume';        // 'resume' = consultation · 'edition' = fiche + cahier
  var _vueFiche = 'abstract'; // onglet de la consultation : abstract · methode · flux

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
  function note(m, t) { if (typeof window.toast === 'function') window.toast(m, t || 'info', 6000); }

  // `l` est le libellé administratif, `r` celui du synopsis : en haut d'une
  // présentation, ce qu'on veut lire est « Proposition » ou « En cours », pas
  // l'état de la file d'inclusions.
  var STATUTS = [
    { v: 'preparation',       l: 'En préparation',      r: 'Proposition',      c: '#64748b', f: '#f8fafc', b: '#e2e8f0' },
    { v: 'en_cours',          l: 'Inclusions ouvertes', r: 'En cours',         c: '#065f46', f: '#ecfdf5', b: '#a7f3d0' },
    { v: 'inclusions_closes', l: 'Inclusions closes',   r: 'Inclusions closes', c: '#b45309', f: '#fffbeb', b: '#fde68a' },
    { v: 'suspendue',         l: 'Suspendue',           r: 'Suspendue',        c: '#991b1b', f: '#fef2f2', b: '#fecaca' },
    { v: 'terminee',          l: 'Terminée',            r: 'Terminée',         c: '#5b21b6', f: '#faf5ff', b: '#ddd6fe' }
  ];
  function statut(v) {
    return STATUTS.filter(function (s) { return s.v === v; })[0] || STATUTS[0];
  }

  // ------------------------------------------------------------
  // Schéma d'étude et catégorie réglementaire
  // ------------------------------------------------------------
  // Le schéma commande tout le reste : ce qu'on peut conclure, le calcul
  // d'effectif, et le circuit réglementaire. Il est donc choisi dans une
  // liste fermée plutôt que saisi librement — « observationnelle » écrit à
  // la main dans un champ texte ne dit pas si elle est transversale ou
  // prospective, et c'est toute la différence au moment de l'analyse.
  var SCHEMAS = [
    { v: 'observationnelle_transversale',   l: 'Observationnelle transversale',  a: 'Mesure à un instant donné — prévalence, corrélations. Aucune causalité.' },
    { v: 'observationnelle_prospective',    l: 'Observationnelle prospective (cohorte)', a: 'Suivi dans le temps, exposition connue avant l\'événement.' },
    { v: 'observationnelle_retrospective',  l: 'Observationnelle rétrospective', a: 'Données déjà recueillies, reprises après coup.' },
    { v: 'cas_temoins',                     l: 'Cas-témoins',                    a: 'Comparaison de sujets avec et sans l\'événement, exposition reconstituée.' },
    { v: 'interventionnelle_randomisee',    l: 'Interventionnelle randomisée contrôlée', a: 'Attribution par tirage au sort, groupe comparateur.' },
    { v: 'interventionnelle_croisee',       l: 'Interventionnelle randomisée en cross-over', a: 'Chaque sujet est son propre témoin, ordre tiré au sort.' },
    { v: 'interventionnelle_non_randomisee', l: 'Interventionnelle non randomisée', a: 'Intervention sans tirage au sort — avant/après, ou groupes constitués.' },
    { v: 'pilote_faisabilite',              l: 'Étude pilote / de faisabilité',  a: 'Vise la faisabilité et les paramètres de l\'étude suivante, pas une conclusion d\'efficacité.' },
    { v: 'serie_de_cas',                    l: 'Série de cas',                   a: 'Description sans groupe de comparaison.' }
  ];
  function schemaEtude(v) {
    return SCHEMAS.filter(function (s) { return s.v === v; })[0] || null;
  }

  // Loi Jardé — la catégorie décide du circuit, et la retrouver au moment du
  // dépôt coûte des semaines. Elle est donc inscrite dans la fiche.
  var RIPH = [
    { v: 'riph1',     l: 'RIPH 1 — interventionnelle',
      a: 'Avis du CPP et autorisation de l\'ANSM. Consentement libre, éclairé et écrit.' },
    { v: 'riph2',     l: 'RIPH 2 — risques et contraintes minimes',
      a: 'Intervention sans risque pour la personne, liste fixée par arrêté. Avis du CPP tiré au sort, consentement écrit.' },
    { v: 'riph3',     l: 'RIPH 3 — non interventionnelle',
      a: 'Aucun acte en dehors du soin courant. Avis du CPP tiré au sort, non-opposition.' },
    { v: 'hors_riph', l: 'Hors RIPH — réutilisation de données',
      a: 'Pas de recherche impliquant la personne humaine : données déjà recueillies. Méthodologie de référence (MR-004) et information des personnes.' }
  ];
  function riph(v) {
    return RIPH.filter(function (s) { return s.v === v; })[0] || null;
  }

  var TYPES = [
    { v: 'texte',         l: 'Texte libre' },
    { v: 'nombre',        l: 'Nombre' },
    { v: 'date',          l: 'Date' },
    { v: 'oui_non',       l: 'Oui / Non' },
    { v: 'choix',         l: 'Choix unique' },
    { v: 'choix_multiple', l: 'Choix multiple' },
    { v: 'fichier',       l: 'Pièce jointe' }
  ];
  function libelleType(v) {
    return (TYPES.filter(function (t) { return t.v === v; })[0] || TYPES[0]).l;
  }

  function info(html, ton) {
    var z = el('etInfo');
    if (!z) return;
    if (!html) { z.style.display = 'none'; z.innerHTML = ''; return; }
    var c = ton === 'erreur' ? ['#fef2f2', '#fecaca', '#991b1b']
          : ton === 'ok'     ? ['#ecfdf5', '#a7f3d0', '#065f46']
          : ton === 'alerte' ? ['#fffbeb', '#fde68a', '#92400e']
                             : ['#f8fafc', '#e2e8f0', '#475569'];
    z.style.display = 'block';
    z.style.cssText = 'display:block; margin-bottom:16px; padding:11px 14px; border-radius:10px; ' +
      'font-size:12.5px; line-height:1.55; background:' + c[0] + '; border:1px solid ' + c[1] +
      '; color:' + c[2] + ';';
    z.innerHTML = html;
  }

  // ============================================================
  // Bibliothèque
  // ============================================================
  function dessinerBibliotheque() {
    var z = el('etContenu');
    if (!z) return;
    _ouverte = null;

    if (!_etudes.length) {
      z.innerHTML =
        '<article class="card" style="padding:34px 28px; text-align:center;">' +
          '<div style="font-size:40px; margin-bottom:10px;">🔬</div>' +
          '<h3 style="font-size:17px; font-weight:800; margin-bottom:6px;">Aucune étude enregistrée</h3>' +
          '<p style="color:var(--muted); font-size:13px; line-height:1.6; max-width:460px; margin:0 auto 18px;">' +
            'Créez une étude pour y consigner son intitulé, son résumé, ses numéros CPP et NCT, ' +
            'puis construisez son cahier d\'observation.</p>' +
          '<button type="button" class="btn-gradient" id="etCreerVide">+ Créer une étude</button>' +
        '</article>';
      var b = el('etCreerVide'); if (b) b.addEventListener('click', nouvelleEtude);
      return;
    }

    z.innerHTML = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(330px, 1fr)); gap:14px;">' +
      _etudes.map(function (e) {
        var s = statut(e.statut);
        var objectif = e.objectif_inclusions || 0;
        var part = objectif ? Math.min(100, Math.round((e.nb_inclus / objectif) * 100)) : 0;
        return '' +
        '<article class="card" data-etude="' + e.id + '" style="padding:18px 20px; cursor:pointer; display:flex; flex-direction:column; gap:10px;">' +
          '<div style="display:flex; align-items:flex-start; gap:10px;">' +
            '<h3 style="flex:1; font-size:15px; font-weight:800; line-height:1.4; margin:0;">' +
              esc(e.intitule) +
              (e.acronyme ? ' <span style="color:#0891b2;">(' + esc(e.acronyme) + ')</span>' : '') +
            '</h3>' +
            '<span style="font-size:10.5px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; ' +
              'color:' + s.c + '; background:' + s.f + '; border:1px solid ' + s.b + '; ' +
              'border-radius:6px; padding:3px 8px; white-space:nowrap;">' + esc(s.l) + '</span>' +
          '</div>' +
          (e.resume ? '<p style="margin:0; font-size:12.5px; color:var(--muted); line-height:1.55; ' +
            'display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">' +
            esc(e.resume) + '</p>' : '') +
          '<div style="display:flex; gap:7px; flex-wrap:wrap; font-size:11px;">' +
            (e.numero_cpp ? '<span style="background:#f1f5f9; border-radius:5px; padding:2px 7px; font-weight:700; color:#475569;">CPP ' + esc(e.numero_cpp) + '</span>' : '') +
            (e.numero_nct ? '<span style="background:#f1f5f9; border-radius:5px; padding:2px 7px; font-weight:700; color:#475569;">' + esc(e.numero_nct) + '</span>' : '') +
          '</div>' +
          '<div style="margin-top:auto; padding-top:10px; border-top:1px solid var(--line); display:flex; gap:14px; font-size:12px; color:#475569;">' +
            '<span><strong style="color:#0b1530;">' + e.nb_inclus + '</strong> patient' + (e.nb_inclus > 1 ? 's' : '') +
              (objectif ? ' / ' + objectif : '') + '</span>' +
            '<span><strong style="color:#0b1530;">' + e.nb_variables + '</strong> variable' + (e.nb_variables > 1 ? 's' : '') + '</span>' +
          '</div>' +
          (objectif ? '<div style="height:4px; background:#e2e8f0; border-radius:99px; overflow:hidden;">' +
            '<div style="height:100%; width:' + part + '%; background:linear-gradient(90deg,#0891b2,#14b8a6);"></div></div>' : '') +
        '</article>';
      }).join('') + '</div>';

    Array.prototype.forEach.call(z.querySelectorAll('[data-etude]'), function (c) {
      c.addEventListener('click', function () { ouvrir(Number(c.dataset.etude)); });
    });
  }

  // ============================================================
  // Synopsis — ce qu'on lit en ouvrant une étude
  // ------------------------------------------------------------
  // Ouvrir une étude donnait d'abord le cahier d'observation : cinquante-sept
  // champs de saisie avant la première phrase de science. Or on ouvre une
  // étude pour la relire, pas pour la saisir. Le synopsis passe donc devant,
  // en lecture seule, et la saisie attend qu'on la demande.
  //
  // Un champ vide s'affiche vide, et dit ce qu'il attend. Rien n'est inventé
  // pour remplir la page : une fiche incomplète qui le montre vaut mieux
  // qu'une fiche d'apparence complète.
  // ============================================================
  /**
   * PostgreSQL rend un NUMERIC sous forme de chaîne : « 0.800 ». Le relire
   * tel quel dans un champ de saisie donne l'impression d'une précision
   * qu'on n'a pas, et la virgule décimale est ce que l'on tape en français.
   */
  function fracTexte(v) {
    if (v === null || v === undefined || v === '') return '';
    var x = parseFloat(String(v).replace(',', '.'));
    if (!isFinite(x)) return '';
    return String(Math.round(x * 1000) / 1000).replace('.', ',');
  }

  /** Puissance et alpha sont stockés en fractions ; on les lit en pourcentages. */
  function pc(v) {
    var x = parseFloat(v);
    return Number.isFinite(x) ? String(Math.round(x * 1000) / 10).replace('.', ',') + ' %' : null;
  }

  function manque(quoi) {
    return '<span style="color:#94a3b8; font-weight:500;">' + esc(quoi) + '</span>';
  }

  /** Une ligne « libellé → valeur », avec une note explicative facultative. */
  function ligne(libelle, valeur, aide) {
    return '<div style="padding:9px 0; border-top:1px solid var(--line);">' +
      '<div style="font-size:10.5px; font-weight:800; text-transform:uppercase; ' +
        'letter-spacing:.05em; color:#94a3b8; margin-bottom:3px;">' + esc(libelle) + '</div>' +
      '<div style="font-size:13px; line-height:1.5; color:#0b1530; font-weight:600;">' +
        (valeur || manque('à renseigner')) + '</div>' +
      (aide ? '<div style="font-size:11.5px; line-height:1.5; color:#64748b; margin-top:3px;">' +
        esc(aide) + '</div>' : '') +
      '</div>';
  }

  function carte(titre, corps, pied) {
    return '<article class="card" style="padding:20px 22px; display:flex; flex-direction:column;">' +
      '<h3 style="font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; ' +
        'color:#0891b2; margin:0 0 10px;">' + titre + '</h3>' + corps +
      (pied ? '<div style="margin-top:auto; padding-top:12px;">' + pied + '</div>' : '') +
      '</article>';
  }

  // Les trois façons de lire une étude. Elles ne se complètent pas, elles se
  // relaient : on lit l'abstract pour savoir de quoi il s'agit, la
  // méthodologie pour savoir comment on mesure, le diagramme pour savoir
  // combien de patients traversent quoi. Les empiler sur une seule page
  // donnait l'écran illisible qu'on vient de quitter.
  var VUES_FICHE = [
    { v: 'abstract', l: 'Abstract' },
    { v: 'methode',  l: 'Méthodologie' },
    { v: 'flux',     l: 'Diagramme de flux' }
  ];

  function dessinerConsultation() {
    var z = el('etContenu');
    if (!z || !_ouverte) return;
    var e = _ouverte.etude;
    var s = statut(e.statut);

    z.innerHTML = '' +
    '<div style="display:flex; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap;">' +
      '<button type="button" class="btn-secondary" id="etRetourBib">← Bibliothèque</button>' +
      '<div style="flex:1; min-width:220px;">' +
        '<div style="font-size:16px; font-weight:800; line-height:1.35;">' + esc(e.intitule) +
          (e.acronyme ? ' <span style="color:#0891b2;">(' + esc(e.acronyme) + ')</span>' : '') +
        '</div>' +
      '</div>' +
      '<span style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; ' +
        'color:' + s.c + '; background:' + s.f + '; border:1px solid ' + s.b + '; ' +
        'border-radius:6px; padding:4px 10px; white-space:nowrap;">' + esc(s.r) + '</span>' +
      '<button type="button" class="btn-secondary" id="etVersEdition">✎ Fiche et cahier d\'observation</button>' +
    '</div>' +

    '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:14px;">' +
      VUES_FICHE.map(function (x) {
        var actif = x.v === _vueFiche;
        return '<button type="button" data-vuefiche="' + x.v + '" style="' +
          'font-size:12.5px; font-weight:700; padding:7px 15px; border-radius:999px; cursor:pointer; ' +
          (actif
            ? 'background:#0b1530; color:#fff; border:1px solid #0b1530;'
            : 'background:#fff; color:#475569; border:1px solid var(--line);') +
          '">' + esc(x.l) + '</button>';
      }).join('') +
    '</div>' +

    '<div id="etVue"></div>';

    dessinerVueFiche();

    el('etRetourBib').addEventListener('click', function () { info(''); dessinerBibliotheque(); });
    el('etVersEdition').addEventListener('click', function () {
      info(''); _vue = 'edition'; dessinerEdition();
      var c = el('etContenu'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'start' });
    });
    Array.prototype.forEach.call(z.querySelectorAll('[data-vuefiche]'), function (b) {
      b.addEventListener('click', function () {
        _vueFiche = b.getAttribute('data-vuefiche');
        dessinerConsultation();
      });
    });
  }

  function dessinerVueFiche() {
    var z = el('etVue');
    if (!z || !_ouverte) return;
    z.innerHTML = _vueFiche === 'methode' ? vueMethode()
                : _vueFiche === 'flux'    ? vueFlux()
                                          : vueAbstract();
  }

  function vueAbstract() {
    var e = _ouverte.etude;
    var sch = schemaEtude(e.schema_etude);
    var cat = riph(e.categorie_riph);
    var nbVar = _ouverte.sections.reduce(function (n, x) { return n + x.variables.length; }, 0);
    var inclus = _ouverte.patients.length;
    var objectif = e.objectif_inclusions || 0;
    var requis = e.effectif_calcule || 0;
    var part = objectif ? Math.min(100, Math.round(inclus / objectif * 100)) : 0;
    var hyp = [
      pc(e.puissance) ? 'puissance ' + pc(e.puissance) : null,
      pc(e.alpha) ? 'α ' + pc(e.alpha) : null,
      e.taille_effet ? 'effet attendu ' + esc(e.taille_effet) : null
    ].filter(Boolean).join(' · ');

    return '' +
    // ---- Abstract ----
    '<article class="card" style="padding:24px 26px; margin-bottom:14px;">' +
      '<h3 style="font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; ' +
        'color:#0891b2; margin:0 0 10px;">Abstract</h3>' +
      (e.resume
        ? '<p style="margin:0; font-size:13.5px; line-height:1.75; color:#1e293b; max-width:78ch; ' +
            'white-space:pre-line;">' + esc(e.resume) + '</p>'
        : '<p style="margin:0; padding:14px 16px; background:#f8fafc; border:1px dashed #cbd5e1; ' +
            'border-radius:10px; font-size:12.5px; line-height:1.65; color:#64748b;">' +
            'Pas encore d\'abstract. Quatre phrases suffisent à en tenir lieu : la question posée, ' +
            'la population, ce qu\'on mesure, ce qu\'on attend. Il se saisit dans la fiche.</p>') +
      (e.population_cible
        ? '<p style="margin:14px 0 0; font-size:12.5px; line-height:1.65; color:#475569;">' +
            '<strong style="color:#0b1530;">Population —</strong> ' + esc(e.population_cible) + '</p>'
        : '') +
    '</article>' +

    // ---- Schéma / critères · Échantillonnage ----
    '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(330px, 1fr)); gap:14px; margin-bottom:14px;">' +

      carte('Schéma et cadre réglementaire',
        ligne('Schéma de l\'étude',
              sch ? esc(sch.l) : (e.type_etude ? esc(e.type_etude) : null),
              sch ? sch.a : null) +
        ligne('Catégorie de recherche',
              cat ? esc(cat.l) : null,
              cat ? cat.a : 'Recherche impliquant la personne humaine : catégorie 1, 2, 3 ou hors RIPH.') +
        ligne('Critère de jugement principal', e.critere_jugement_principal ? esc(e.critere_jugement_principal) : null) +
        (e.criteres_secondaires ? ligne('Critères secondaires', esc(e.criteres_secondaires)) : '')
      ) +

      carte('Échantillonnage',
        '<div style="display:flex; align-items:baseline; gap:10px; margin-bottom:4px;">' +
          '<span style="font-size:34px; font-weight:800; line-height:1; color:' +
            (requis ? '#0b1530' : '#cbd5e1') + ';">' + (requis || '—') + '</span>' +
          '<span style="font-size:12.5px; color:#64748b; line-height:1.4;">' +
            (requis ? 'sujets nécessaires' : 'effectif non calculé') + '</span>' +
        '</div>' +
        (hyp ? '<div style="font-size:12px; color:#0891b2; font-weight:700; margin-bottom:8px;">' + hyp + '</div>' : '') +
        (e.calcul_effectif
          ? '<p style="margin:0 0 10px; font-size:12.5px; line-height:1.65; color:#475569; ' +
              'white-space:pre-line;">' + esc(e.calcul_effectif) + '</p>'
          : '<p style="margin:0 0 10px; padding:11px 13px; background:#fffbeb; border:1px solid #fde68a; ' +
              'border-radius:9px; font-size:12px; line-height:1.6; color:#92400e;">' +
              'Un effectif sans sa justification n\'est pas un effectif : il faut le risque α, ' +
              'la puissance visée, l\'écart attendu sur le critère principal et sa dispersion. ' +
              'Ces quatre valeurs se saisissent dans la fiche, et la phrase de méthode se relit ici.</p>') +
        ligne('Inclusions',
              inclus + ' patient' + (inclus > 1 ? 's' : '') +
              (objectif ? ' sur un objectif de ' + objectif : '') +
              (requis && objectif && objectif > requis
                ? ' <span style="font-weight:500; color:#64748b;">(' + requis + ' requis, marge pour les perdus de vue)</span>'
                : '')) +
        (objectif ? '<div style="height:5px; background:#e2e8f0; border-radius:99px; overflow:hidden; margin-top:6px;">' +
          '<div style="height:100%; width:' + part + '%; background:linear-gradient(90deg,#0891b2,#14b8a6);"></div></div>' : '')
      ) +
    '</div>' +

    // ---- Identification et calendrier ----
    '<article class="card" style="padding:20px 22px;">' +
      '<h3 style="font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; ' +
        'color:#0891b2; margin:0 0 4px;">Identification et calendrier</h3>' +
      '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:0 22px;">' +
        ligne('Promoteur', e.promoteur ? esc(e.promoteur) : null) +
        ligne('Investigateur principal', e.investigateur_principal ? esc(e.investigateur_principal) : null) +
        ligne('Numéro CPP', e.numero_cpp ? esc(e.numero_cpp) : null) +
        ligne('Numéro d\'enregistrement', e.numero_nct ? esc(e.numero_nct) : null) +
        ligne('Début', e.date_debut ? jour(e.date_debut) : null) +
        ligne('Fin prévue', e.date_fin ? jour(e.date_fin) : null) +
        ligne('Cahier d\'observation',
              _ouverte.sections.length + ' chapitre' + (_ouverte.sections.length > 1 ? 's' : '') +
              ' · ' + nbVar + ' variable' + (nbVar > 1 ? 's' : '')) +
      '</div>' +
      (e.notes ? '<p style="margin:14px 0 0; padding:11px 13px; background:#f8fafc; ' +
        'border-left:3px solid #cbd5e1; border-radius:0 8px 8px 0; font-size:12.5px; ' +
        'line-height:1.6; color:#475569; white-space:pre-line;">' +
        '<strong style="color:#0b1530;">Notes internes —</strong> ' + esc(e.notes) + '</p>' : '') +
    '</article>';
  }

  // ------------------------------------------------------------
  // Méthodologie
  // ------------------------------------------------------------
  /**
   * Rend un texte de protocole tel qu'il a été rédigé.
   *
   * Les champs de méthodologie sont du texte libre, mais ils sont écrits
   * avec une structure : une ligne en capitales ouvre une rubrique, une ligne
   * commençant par « • » est un item. On la respecte à l'affichage plutôt
   * que de tout aplatir en un pavé — un protocole qu'on ne peut pas parcourir
   * des yeux ne se relit pas, donc ne se corrige pas.
   */
  function estTitre(ligne) {
    var tete = ligne.split('—')[0].trim();
    if (tete.length < 4) return false;
    var lettres = tete.replace(/[^A-Za-zÀ-ÿ]/g, '');
    return lettres.length >= 4 && tete === tete.toUpperCase();
  }

  function texteProtocole(txt) {
    if (!txt) return '';
    return String(txt).split(/\n\s*\n/).map(function (bloc) {
      var lignes = bloc.split('\n').filter(function (l) { return l.trim(); });
      if (!lignes.length) return '';
      var html = '';
      var items = [];
      var viderItems = function () {
        if (!items.length) return;
        html += '<ul style="margin:4px 0 8px; padding-left:18px; font-size:12.5px; ' +
          'line-height:1.65; color:#334155;">' +
          items.map(function (i) { return '<li style="margin-bottom:3px;">' + esc(i) + '</li>'; }).join('') +
          '</ul>';
        items = [];
      };
      lignes.forEach(function (l, i) {
        var t = l.trim();
        if (t.indexOf('•') === 0) { items.push(t.slice(1).trim()); return; }
        viderItems();
        if (i === 0 && estTitre(t)) {
          var bout = t.split('—');
          html += '<div style="font-size:11.5px; font-weight:800; text-transform:uppercase; ' +
            'letter-spacing:.05em; color:#0891b2; margin:0 0 6px;">' + esc(bout[0].trim()) +
            (bout.length > 1
              ? ' <span style="font-weight:600; text-transform:none; letter-spacing:0; color:#94a3b8;">— ' +
                esc(bout.slice(1).join('—').trim()) + '</span>'
              : '') + '</div>';
        } else {
          html += '<p style="margin:0 0 7px; font-size:12.5px; line-height:1.7; color:#334155;">' +
            esc(t) + '</p>';
        }
      });
      viderItems();
      return '<div style="margin-bottom:16px;">' + html + '</div>';
    }).join('');
  }

  // ------------------------------------------------------------
  // Figures
  // ------------------------------------------------------------
  // Dessinées, et non reprises d'une publication. Reproduire la figure d'un
  // article sur un site accessible engage la responsabilité de l'équipe, et
  // une figure qu'on ne possède pas ne se corrige pas : si le repère de
  // l'aorte ascendante passe de 20 à 10 mm, il faut pouvoir le changer.
  //
  // Elles ne prétendent pas remplacer les images de l'examen. Leur rôle est
  // de fixer OÙ l'on mesure et À QUEL INSTANT — les deux erreurs qui ruinent
  // ce type d'étude sans laisser de trace dans le résultat.

  /** Repère des quatre niveaux, en coupe parasternale grand axe. */
  function figureGrandAxe(surligne) {
    var niveaux = [
      { n: 1, y: 236, x1: 150, x2: 216, l: 'Anneau aortique',
        d: 'repère de la valve — hors calcul de mécanique', cle: 'anneau' },
      { n: 2, y: 188, x1: 136, x2: 230, l: 'Sinus de Valsalva',
        d: 'plus grand diamètre du sinus', cle: 'sinus' },
      { n: 3, y: 142, x1: 156, x2: 208, l: 'Jonction sinotubulaire',
        d: 'rétrécissement net au-dessus des sinus', cle: 'jst' },
      { n: 4, y: 95,  x1: 162, x2: 215, l: 'Aorte ascendante proximale',
        d: '20 mm au-dessus de la jonction', cle: 'ascendante' }
    ];
    return '' +
    '<svg viewBox="0 0 470 280" width="100%" style="max-width:470px; display:block;" ' +
      'role="img" aria-label="Niveaux de mesure de la racine aortique en coupe parasternale grand axe">' +
      '<rect x="0" y="0" width="470" height="280" fill="#fbfdfe"/>' +

      // ---- cavités repères, en trait léger : sans elles le dessin flotte ----
      '<path d="M150 250 C150 272 108 276 96 262" fill="none" stroke="#cbd5e1" stroke-width="1.4"/>' +
      '<path d="M216 250 C216 272 258 276 270 262" fill="none" stroke="#cbd5e1" stroke-width="1.4"/>' +
      '<text x="104" y="272" font-size="10" fill="#94a3b8">VG</text>' +
      '<text x="258" y="272" font-size="10" fill="#94a3b8">OG</text>' +

      // ---- parois aortiques : renflement des sinus, pincement à la JST ----
      '<path d="M150 250 L150 236 C150 212 134 206 136 188 C138 166 152 160 156 142 L162 60" ' +
        'fill="none" stroke="#0b1530" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M216 250 L216 236 C216 212 232 206 230 188 C228 166 212 160 208 142 L215 60" ' +
        'fill="none" stroke="#0b1530" stroke-width="3" stroke-linecap="round"/>' +

      // ---- sigmoïdes fermées : l'instant de Dd, valve close ----
      '<path d="M152 237 L183 221 L214 237" fill="none" stroke="#64748b" stroke-width="1.6"/>' +
      '<text x="246" y="258" font-size="9.5" fill="#94a3b8">valve fermée — instant de Dd</text>' +

      niveaux.map(function (n) {
        var vif = !surligne || surligne === n.cle;
        var c = vif ? '#0891b2' : '#cbd5e1';
        var ct = vif ? '#0b1530' : '#94a3b8';
        return '<g>' +
          '<line x1="' + n.x1 + '" y1="' + n.y + '" x2="' + n.x2 + '" y2="' + n.y + '" ' +
            'stroke="' + c + '" stroke-width="2.2"/>' +
          '<line x1="' + n.x1 + '" y1="' + (n.y - 5) + '" x2="' + n.x1 + '" y2="' + (n.y + 5) + '" stroke="' + c + '" stroke-width="2.2"/>' +
          '<line x1="' + n.x2 + '" y1="' + (n.y - 5) + '" x2="' + n.x2 + '" y2="' + (n.y + 5) + '" stroke="' + c + '" stroke-width="2.2"/>' +
          '<line x1="' + n.x2 + '" y1="' + n.y + '" x2="258" y2="' + n.y + '" stroke="' + c + '" stroke-width="1" stroke-dasharray="3 3"/>' +
          '<circle cx="268" cy="' + n.y + '" r="9" fill="' + (vif ? '#0891b2' : '#e2e8f0') + '"/>' +
          '<text x="268" y="' + (n.y + 3.5) + '" font-size="11" font-weight="800" text-anchor="middle" ' +
            'fill="' + (vif ? '#fff' : '#94a3b8') + '">' + n.n + '</text>' +
          '<text x="284" y="' + (n.y - 1) + '" font-size="12" font-weight="700" fill="' + ct + '">' + esc(n.l) + '</text>' +
          '<text x="284" y="' + (n.y + 12) + '" font-size="9.5" fill="#94a3b8">' + esc(n.d) + '</text>' +
        '</g>';
      }).join('') +

      '<text x="24" y="30" font-size="11.5" font-weight="800" fill="#0891b2">A</text>' +
      '<text x="40" y="30" font-size="11.5" font-weight="700" fill="#475569">Coupe parasternale grand axe</text>' +
      '<text x="40" y="44" font-size="9.5" fill="#94a3b8">mesures inner-edge, faisceau perpendiculaire à la paroi</text>' +
    '</svg>';
  }

  /**
   * Mode TM : où se prennent Dd et Ds dans le cycle.
   *
   * Le tracé est calculé, pas dessiné à la main : la courbe doit monter vite
   * et redescendre lentement, comme l'expansion systolique réelle, sinon la
   * figure suggère un instant de mesure qui n'existe pas.
   */
  function figureTM() {
    var x0 = 56, x1 = 392, periode = 96;
    var yAntD = 118, yAntS = 100, yPostD = 176, yPostS = 194;
    // Déplacement pariétal : montée rapide (15 % du cycle), retour progressif.
    var depl = function (t) {
      return t < 0.15 ? Math.pow(t / 0.15, 0.75)
                      : Math.pow(1 - (t - 0.15) / 0.85, 1.6);
    };
    var courbe = function (yD, yS) {
      var p = '', x;
      for (x = x0; x <= x1; x += 3) {
        var t = ((x - x0) % periode) / periode;
        var y = yD + (yS - yD) * depl(t);
        p += (x === x0 ? 'M' : 'L') + x.toFixed(0) + ' ' + y.toFixed(1) + ' ';
      }
      return p;
    };
    // Instants de mesure : Dd au début du QRS (t = 0), Ds à l'expansion maximale.
    var xDd = x0 + periode;              // début du 2ᵉ cycle
    var xDs = x0 + periode + periode * 0.15;
    var ecg = function () {
      var p = '', c;
      for (c = 0; c <= 3; c++) {
        var b = x0 + c * periode;
        p += 'M' + b + ' 252 L' + (b + 14) + ' 252 L' + (b + 20) + ' 246 L' + (b + 26) + ' 252 ' +
             'L' + (b + 32) + ' 252 L' + (b + 36) + ' 258 L' + (b + 40) + ' 232 L' + (b + 44) + ' 262 ' +
             'L' + (b + 48) + ' 252 L' + (b + 62) + ' 252 L' + (b + 72) + ' 243 L' + (b + 82) + ' 252 ' +
             'L' + (b + 96) + ' 252 ';
      }
      return p;
    };
    return '' +
    '<svg viewBox="0 0 470 280" width="100%" style="max-width:470px; display:block;" ' +
      'role="img" aria-label="Mode TM : diamètres télédiastolique et systolique maximal">' +
      '<rect x="0" y="0" width="470" height="280" fill="#fbfdfe"/>' +

      '<path d="' + courbe(yAntD, yAntS) + '" fill="none" stroke="#0b1530" stroke-width="2.6"/>' +
      '<path d="' + courbe(yPostD, yPostS) + '" fill="none" stroke="#0b1530" stroke-width="2.6"/>' +

      // ---- Dd : au début du QRS, valve fermée ----
      '<line x1="' + xDd + '" y1="86" x2="' + xDd + '" y2="262" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 3"/>' +
      '<line x1="' + xDd + '" y1="' + yAntD + '" x2="' + xDd + '" y2="' + yPostD + '" stroke="#0891b2" stroke-width="2.4"/>' +
      '<line x1="' + (xDd - 6) + '" y1="' + yAntD + '" x2="' + (xDd + 6) + '" y2="' + yAntD + '" stroke="#0891b2" stroke-width="2.4"/>' +
      '<line x1="' + (xDd - 6) + '" y1="' + yPostD + '" x2="' + (xDd + 6) + '" y2="' + yPostD + '" stroke="#0891b2" stroke-width="2.4"/>' +
      '<text x="' + (xDd - 10) + '" y="' + ((yAntD + yPostD) / 2) + '" font-size="12.5" font-weight="800" ' +
        'fill="#0891b2" text-anchor="end">Dd</text>' +

      // ---- Ds : expansion maximale ----
      '<line x1="' + xDs + '" y1="86" x2="' + xDs + '" y2="262" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4 3"/>' +
      '<line x1="' + xDs + '" y1="' + yAntS + '" x2="' + xDs + '" y2="' + yPostS + '" stroke="#7c3aed" stroke-width="2.4"/>' +
      '<line x1="' + (xDs - 6) + '" y1="' + yAntS + '" x2="' + (xDs + 6) + '" y2="' + yAntS + '" stroke="#7c3aed" stroke-width="2.4"/>' +
      '<line x1="' + (xDs - 6) + '" y1="' + yPostS + '" x2="' + (xDs + 6) + '" y2="' + yPostS + '" stroke="#7c3aed" stroke-width="2.4"/>' +
      '<text x="' + (xDs + 12) + '" y="' + ((yAntS + yPostS) / 2) + '" font-size="12.5" font-weight="800" fill="#7c3aed">Ds</text>' +

      '<text x="' + x0 + '" y="92" font-size="9.5" fill="#94a3b8">paroi antérieure</text>' +
      '<text x="' + x0 + '" y="214" font-size="9.5" fill="#94a3b8">paroi postérieure</text>' +

      '<path d="' + ecg() + '" fill="none" stroke="#059669" stroke-width="1.6"/>' +
      '<text x="' + (xDd + 6) + '" y="274" font-size="9.5" fill="#059669">début du QRS</text>' +

      '<text x="24" y="30" font-size="11.5" font-weight="800" fill="#0891b2">B</text>' +
      '<text x="40" y="30" font-size="11.5" font-weight="700" fill="#475569">Mode TM — instants de mesure</text>' +
      '<text x="40" y="44" font-size="9.5" fill="#94a3b8">Dd au début du QRS, valve fermée · Ds à l\'expansion maximale · moyenne de trois cycles</text>' +
    '</svg>';
  }

  /** Les six indices, avec leur formule, leur unité et ce qu'ils disent. */
  function blocFormules() {
    var f = [
      { n: 'Strain', e: '(D<tspan>s</tspan> − D<tspan>d</tspan>) / D<tspan>d</tspan> × 100',
        u: '%', d: 'Déformation du diamètre sur un cycle.' },
      { n: 'Area strain', e: '(D<tspan>s</tspan>² − D<tspan>d</tspan>²) / D<tspan>d</tspan>² × 100',
        u: '%', d: 'Variation relative de surface.' },
      { n: 'Distensibilité', e: '(D<tspan>s</tspan>² − D<tspan>d</tspan>²) / (D<tspan>d</tspan>² × ΔPP)',
        u: '×10⁻³ mmHg⁻¹', d: 'Capacité à se dilater pour une variation de pression. Forme surfacique.' },
      { n: 'Compliance', e: 'π (D<tspan>s</tspan>² − D<tspan>d</tspan>²) / (4 ΔPP)',
        u: 'mm²/mmHg', d: 'Variation absolue de surface par mmHg. Dépend de la taille initiale.' },
      { n: 'Indice β', e: 'ln(PAS / PAD) / [(D<tspan>s</tspan> − D<tspan>d</tspan>) / D<tspan>d</tspan>]',
        u: 'sans dimension', d: 'Rigidité, peu dépendante du niveau de pression.' },
      { n: 'Module Ep', e: 'ΔPP / [(D<tspan>s</tspan> − D<tspan>d</tspan>) / D<tspan>d</tspan>]',
        u: 'mmHg', d: 'Rigidité sans correction logarithmique. Information voisine de β.' }
    ];
    return '' +
    '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(240px,1fr)); gap:10px;">' +
      f.map(function (x) {
        return '<div style="border:1px solid var(--line); border-radius:10px; padding:11px 13px; background:#fff;">' +
          '<div style="display:flex; align-items:baseline; gap:8px; flex-wrap:wrap;">' +
            '<span style="font-size:12.5px; font-weight:800; color:#0b1530;">' + x.n + '</span>' +
            '<span style="font-size:10.5px; color:#0891b2; font-weight:700;">' + x.u + '</span>' +
          '</div>' +
          '<div style="font-family:ui-serif,Georgia,serif; font-size:13.5px; color:#1e293b; ' +
            'margin:6px 0 5px; padding:6px 9px; background:#f8fafc; border-radius:7px; overflow-x:auto;">' +
            x.e.replace(/<tspan>/g, '<sub>').replace(/<\/tspan>/g, '</sub>') + '</div>' +
          '<div style="font-size:11px; line-height:1.5; color:#64748b;">' + esc(x.d) + '</div>' +
        '</div>';
      }).join('') +
    '</div>' +
    '<p style="margin:10px 0 0; font-size:11.5px; line-height:1.6; color:#64748b;">' +
      'D<sub>d</sub> et D<sub>s</sub> en mm, ΔPP = PAS − PAD en mmHg. ' +
      'Quatre de ces six indices n\'existent pas sans pression artérielle : une acquisition sans PA ' +
      'relevée ne donne qu\'un strain et un area strain.' +
    '</p>';
  }

  function vueMethode() {
    var e = _ouverte.etude;
    var visites = (e.calendrier_visites || '').split('·')
      .map(function (v) { return v.trim(); }).filter(Boolean);

    var bloc = function (titre, corps, fond) {
      return '<article class="card" style="padding:20px 22px; margin-bottom:14px;' +
        (fond ? ' background:' + fond + ';' : '') + '">' +
        '<h3 style="font-size:13px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; ' +
          'color:#0891b2; margin:0 0 10px;">' + titre + '</h3>' + corps + '</article>';
    };
    var prose = function (txt, quoi) {
      return txt
        ? '<p style="margin:0; font-size:12.5px; line-height:1.75; color:#334155; ' +
            'white-space:pre-line;">' + esc(txt) + '</p>'
        : '<p style="margin:0; padding:12px 14px; background:#f8fafc; border:1px dashed #cbd5e1; ' +
            'border-radius:9px; font-size:12.5px; line-height:1.6; color:#64748b;">' + esc(quoi) + '</p>';
    };

    return '' +
      bloc('Population',
        prose(e.population_cible,
              'Critères d\'inclusion et de non-inclusion à saisir dans la fiche.')) +

      (visites.length
        ? bloc('Calendrier des visites',
            '<div style="display:flex; gap:10px; flex-wrap:wrap;">' +
              visites.map(function (v, i) {
                var p = v.split('—');
                return '<div style="flex:1; min-width:140px; padding:12px 14px; border:1px solid var(--line); ' +
                  'border-radius:10px; background:' + (i === 0 ? '#ecfeff' : '#fff') + ';">' +
                  '<div style="font-size:15px; font-weight:800; color:#0b1530;">' + esc(p[0].trim()) + '</div>' +
                  (p.length > 1 ? '<div style="font-size:11.5px; color:#64748b; margin-top:2px;">' +
                    esc(p.slice(1).join('—').trim()) + '</div>' : '') +
                  '</div>';
              }).join('') + '</div>')
        : '') +

      bloc('Coupes et instants de mesure',
        '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(330px,1fr)); gap:16px; ' +
          'margin-bottom:14px;">' +
          '<div style="border:1px solid var(--line); border-radius:11px; overflow:hidden;">' +
            figureGrandAxe() + '</div>' +
          '<div style="border:1px solid var(--line); border-radius:11px; overflow:hidden;">' +
            figureTM() + '</div>' +
        '</div>' +
        (e.protocole_mesure
          ? texteProtocole(e.protocole_mesure)
          : '<p style="margin:0; padding:12px 14px; background:#f8fafc; border:1px dashed #cbd5e1; ' +
            'border-radius:9px; font-size:12.5px; line-height:1.6; color:#64748b;">' +
            'Protocole de mesure à rédiger : coupes utilisées, convention de mesure des diamètres, ' +
            'moment du relevé de la pression artérielle.</p>')) +

      bloc('Indices calculés', blocFormules()) +

      bloc('Critère de jugement principal',
        prose(e.critere_jugement_principal,
              'Aucun critère principal défini. C\'est lui qui fixe l\'effectif : sans lui, le calcul ' +
              'd\'échantillonnage ne repose sur rien.'),
        '#f0fdfa') +

      bloc('Critères secondaires',
        prose(e.criteres_secondaires, 'Aucun critère secondaire défini.')) +

      bloc('Plan d\'analyse',
        e.plan_analyse
          ? texteProtocole(e.plan_analyse)
          : '<p style="margin:0; padding:12px 14px; background:#fffbeb; border:1px solid #fde68a; ' +
            'border-radius:9px; font-size:12.5px; line-height:1.65; color:#92400e;">' +
            'Plan d\'analyse non rédigé. Tant qu\'il ne l\'est pas, l\'ordre des tests reste ouvert — ' +
            'et un ordre choisi après avoir vu les résultats n\'est plus un plan d\'analyse.</p>');
  }

  // ------------------------------------------------------------
  // Diagramme de flux
  // ------------------------------------------------------------
  /**
   * Diagramme de flux, construit sur les chiffres de l'étude.
   *
   * Tant qu'aucun patient n'est inclus, il est PRÉVISIONNEL et le dit. Un
   * diagramme de flux qui affiche des effectifs prévus sans le préciser est
   * exactement le genre de figure qu'on retrouve ensuite dans un article en
   * croyant qu'elle décrit l'observé.
   */
  // --- Primitives du diagramme, en SVG : un diagramme de flux se lit, se
  // --- copie dans un protocole et s'imprime. Des <div> ne s'exportent pas.
  function fBoite(x, y, w, lignes, ton) {
    var c = ton === 'fort'   ? ['#0b1530', '#ecfeff', '#67e8f9']
          : ton === 'sortie' ? ['#92400e', '#fffbeb', '#fde68a']
                             : ['#0b1530', '#ffffff', '#cbd5e1'];
    var h = 16 + lignes.length * 15;
    return '<g>' +
      '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="7" ' +
        'fill="' + c[1] + '" stroke="' + c[2] + '" stroke-width="1.4"/>' +
      lignes.map(function (l, i) {
        var gras = i === 0;
        return '<text x="' + (x + 11) + '" y="' + (y + 19 + i * 15) + '" font-size="' +
          (gras ? 11.5 : 10.5) + '" font-weight="' + (gras ? '800' : '500') +
          '" fill="' + (gras ? c[0] : '#64748b') + '">' + esc(l) + '</text>';
      }).join('') +
      '</g>';
  }
  function hBoite(lignes) { return 16 + lignes.length * 15; }

  function fFleche(x, y1, y2) {
    return '<line x1="' + x + '" y1="' + y1 + '" x2="' + x + '" y2="' + (y2 - 7) + '" ' +
      'stroke="#94a3b8" stroke-width="1.6"/>' +
      '<path d="M' + (x - 4) + ' ' + (y2 - 7) + ' L' + x + ' ' + y2 + ' L' + (x + 4) + ' ' + (y2 - 7) + 'Z" fill="#94a3b8"/>';
  }
  function fCoude(x, y, xFin) {
    return '<line x1="' + x + '" y1="' + y + '" x2="' + (xFin - 7) + '" y2="' + y + '" ' +
      'stroke="#94a3b8" stroke-width="1.6"/>' +
      '<path d="M' + (xFin - 7) + ' ' + (y - 4) + ' L' + xFin + ' ' + y + ' L' + (xFin - 7) + ' ' + (y + 4) + 'Z" fill="#94a3b8"/>';
  }

  function boite(titre, valeur, note, ton) {
    var c = ton === 'fort' ? ['#0b1530', '#ecfeff', '#a5f3fc']
          : ton === 'sortie' ? ['#92400e', '#fffbeb', '#fde68a']
                             : ['#0b1530', '#ffffff', '#e2e8f0'];
    return '<div style="border:1px solid ' + c[2] + '; background:' + c[1] + '; border-radius:11px; ' +
      'padding:12px 16px; min-width:190px;">' +
      '<div style="font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; ' +
        'color:#64748b; margin-bottom:3px;">' + esc(titre) + '</div>' +
      (valeur !== null && valeur !== undefined
        ? '<div style="font-size:20px; font-weight:800; color:' + c[0] + '; line-height:1.2;">' + valeur + '</div>'
        : '') +
      (note ? '<div style="font-size:11.5px; color:#64748b; line-height:1.5; margin-top:2px;">' +
        esc(note) + '</div>' : '') +
      '</div>';
  }

  function fleche() {
    return '<div style="display:flex; align-items:center; gap:0; margin:0 0 0 24px;">' +
      '<div style="width:2px; height:18px; background:#cbd5e1;"></div>' +
      '</div>';
  }

  function vueFlux() {
    var e = _ouverte.etude;
    var inclus = _ouverte.patients.length;
    var objectif = e.objectif_inclusions || 0;
    var requis = e.effectif_calcule || 0;
    var ecartes = (objectif && requis && objectif > requis) ? objectif - requis : 0;
    var previsionnel = inclus === 0;
    var croise = String(e.schema_etude || '').indexOf('croisee') >= 0;
    var etapes = (e.calendrier_visites || '').split('·')
      .map(function (v) { return v.split('—')[0].trim(); }).filter(Boolean);

    if (!objectif && !requis && !inclus) {
      return '<article class="card" style="padding:26px;">' +
        '<p style="margin:0 auto; font-size:13px; line-height:1.7; color:#64748b; max-width:60ch; ' +
        'text-align:center;">Le diagramme se construit sur l\'effectif de l\'étude. ' +
        'Renseignez l\'effectif calculé et l\'objectif d\'inclusions dans la fiche, et il apparaîtra ici.</p>' +
        '</article>';
    }

    var n = objectif || inclus || requis;
    var nA = Math.ceil(n / 2), nB = n - nA;
    var L = 70, W = 230, CX = L + W / 2;          // colonne principale
    var XS = L + W + 48, WS = 182;                // colonne des sorties
    var y = 24, svg = '';

    var poser = function (lignes, ton) {
      svg += fBoite(L, y, W, lignes, ton);
      var h = hBoite(lignes);
      y += h;
      return h;
    };
    var sortie = function (lignes, decalage) {
      var yb = y - hBoite(lignes) - (decalage || 0);
      svg += fCoude(CX, yb + hBoite(lignes) / 2, XS);
      svg += fBoite(XS, yb, WS, lignes, 'sortie');
    };
    var versLeBas = function (h) { svg += fFleche(CX, y, y + h); y += h; };

    // ---- 1. éligibilité ----
    poser(['Sujets évalués pour éligibilité', 'n = à dénombrer au démarrage']);
    versLeBas(34);
    svg += fCoude(CX, y - 17, XS);
    svg += fBoite(XS, y - 17 - hBoite(['Non inclus', 'critères non remplis', 'refus de participer',
      'fenêtre échographique insuffisante']) / 2, WS,
      ['Non inclus', 'critères non remplis', 'refus de participer',
       'fenêtre échographique insuffisante'], 'sortie');

    // ---- 2. inclusion ----
    poser([previsionnel ? 'Inclus — effectif prévu' : 'Inclus',
           'n = ' + (objectif || inclus)], 'fort');

    if (croise) {
      // ---- 3. randomisation de l'ordre, deux bras ----
      versLeBas(30);
      poser(['Randomisation de l\'ordre des modalités', 'n = ' + n]);
      versLeBas(26);
      var wB = (W - 16) / 2;
      var lA = ['Ordre A → B', 'n = ' + nA, 'dynamique puis isométrique'];
      var lB = ['Ordre B → A', 'n = ' + nB, 'isométrique puis dynamique'];
      var hB = Math.max(hBoite(lA), hBoite(lB));
      svg += '<line x1="' + CX + '" y1="' + (y - 10) + '" x2="' + (L + wB / 2) + '" y2="' + (y - 10) + '" stroke="#94a3b8" stroke-width="1.6"/>';
      svg += '<line x1="' + CX + '" y1="' + (y - 10) + '" x2="' + (L + W - wB / 2) + '" y2="' + (y - 10) + '" stroke="#94a3b8" stroke-width="1.6"/>';
      svg += fFleche(L + wB / 2, y - 10, y);
      svg += fFleche(L + W - wB / 2, y - 10, y);
      svg += fBoite(L, y, wB, lA);
      svg += fBoite(L + W - wB, y, wB, lB);
      y += hB;
      versLeBas(26);
      poser(['Séance de mesure complète', 'repos → modalité 1 → repos → modalité 2']);
      sortie(['Séances non exploitables', 'arrêt pour critère de sécurité',
              'image inexploitable sous charge', 'retour au repos incomplet']);
    } else {
      // ---- 3. suivi longitudinal ----
      (etapes.length ? etapes : ['Inclusion', 'Fin de suivi']).forEach(function (v, i) {
        versLeBas(30);
        poser([v, i === 0 ? 'mesures de référence' : 'mesures prévues au protocole']);
        if (i > 0) sortie(['Perdus de vue et sorties', 'n = ' + (ecartes || 'à compter')]);
      });
    }

    // ---- 4. analyse ----
    versLeBas(30);
    poser(['Analysés — critère de jugement principal', 'n = ' + (requis || '—')], 'fort');
    sortie(['Exclus de l\'analyse', 'pression artérielle non relevée', 'aucune imputation']);

    var hauteur = y + 30;

    return '' +
      (previsionnel
        ? '<div style="padding:12px 15px; background:#fffbeb; border:1px solid #fde68a; ' +
          'border-radius:10px; font-size:12.5px; line-height:1.65; color:#92400e; margin-bottom:14px;">' +
          '<strong>Diagramme prévisionnel.</strong> Aucun participant n\'est encore inclus : les ' +
          'effectifs sont ceux du calcul de puissance, pas des observations. Ils seront remplacés par ' +
          'les nombres réels au fil de l\'étude, et c\'est cette version-là qui ira dans l\'article.</div>'
        : '<div style="padding:12px 15px; background:#ecfdf5; border:1px solid #a7f3d0; ' +
          'border-radius:10px; font-size:12.5px; line-height:1.65; color:#065f46; margin-bottom:14px;">' +
          '<strong>' + inclus + ' participant' + (inclus > 1 ? 's' : '') + ' inclus' +
          (objectif ? ' sur ' + objectif : '') + '.</strong> Les étapes suivantes restent prévisionnelles.</div>') +
      '<article class="card" style="padding:18px;">' +
        '<svg viewBox="0 0 ' + (XS + WS + 24) + ' ' + hauteur + '" width="100%" ' +
          'style="max-width:' + (XS + WS + 24) + 'px; display:block; margin:0 auto;" ' +
          'role="img" aria-label="Diagramme de flux de l\'étude">' +
          '<rect x="0" y="0" width="' + (XS + WS + 24) + '" height="' + hauteur + '" fill="#fff"/>' +
          svg +
        '</svg>' +
      '</article>';
  }

  // ============================================================
  // Fiche d'une étude
  // ============================================================
  function champ(id, libelle, valeur, type, aide) {
    return '<div>' +
      '<label class="control-label" for="' + id + '">' + esc(libelle) + '</label>' +
      '<input type="' + (type || 'text') + '" id="' + id + '" value="' + esc(valeur || '') + '"' +
      (aide ? ' placeholder="' + esc(aide) + '"' : '') + ' />' +
      '</div>';
  }

  /** Point d'entrée unique : le synopsis d'abord, la saisie sur demande. */
  function dessinerFiche() {
    if (_vue === 'edition') dessinerEdition();
    else dessinerConsultation();
  }

  function dessinerEdition() {
    var z = el('etContenu');
    if (!z || !_ouverte) return;
    var e = _ouverte.etude;
    var nbVar = _ouverte.sections.reduce(function (n, s) { return n + s.variables.length; }, 0);

    z.innerHTML = '' +
    '<div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">' +
      '<button type="button" class="btn-secondary" id="etRetour">← Synopsis</button>' +
      '<strong style="flex:1; min-width:200px; font-size:15px;">' + esc(e.intitule) + '</strong>' +
      '<button type="button" class="btn-secondary" id="etImprimer">🖨 Dictionnaire de données</button>' +
      '<button type="button" class="btn-gradient" id="etEnregistrer">💾 Enregistrer la fiche</button>' +
    '</div>' +

    '<article class="card" style="padding:22px; margin-bottom:16px;">' +
      '<h3 style="font-size:16px; font-weight:800; margin-bottom:16px;">📋 Fiche de l\'étude</h3>' +
      '<div style="display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px;">' +
        '<div style="grid-column:1 / 4;">' +
          '<label class="control-label" for="et_intitule">Intitulé *</label>' +
          '<input type="text" id="et_intitule" value="' + esc(e.intitule) + '" />' +
        '</div>' +
        champ('et_acronyme', 'Acronyme', e.acronyme, 'text', 'ex. MARFAN-APA') +
        '<div style="grid-column:1 / -1;">' +
          '<label class="control-label" for="et_resume">Résumé</label>' +
          '<textarea id="et_resume" rows="4" placeholder="Objectif principal, population, critères de jugement…">' +
          esc(e.resume || '') + '</textarea>' +
        '</div>' +
        champ('et_cpp', 'Numéro CPP', e.numero_cpp, 'text', 'ex. 2026-A00123-45') +
        champ('et_nct', 'Numéro NCT', e.numero_nct, 'text', 'ex. NCT06123456') +
        champ('et_promoteur', 'Promoteur', e.promoteur, 'text', 'ex. CHU de Toulouse') +
        champ('et_ip', 'Investigateur principal', e.investigateur_principal, 'text', 'Dr Nom') +
        '<div>' +
          '<label class="control-label" for="et_statut">Statut</label>' +
          '<select id="et_statut">' + STATUTS.map(function (s) {
            return '<option value="' + s.v + '"' + (s.v === e.statut ? ' selected' : '') + '>' + esc(s.l) + '</option>';
          }).join('') + '</select>' +
        '</div>' +
        '<div>' +
          '<label class="control-label" for="et_schema">Schéma</label>' +
          '<select id="et_schema">' +
            '<option value="">— à préciser —</option>' +
            SCHEMAS.map(function (x) {
              return '<option value="' + x.v + '"' + (x.v === e.schema_etude ? ' selected' : '') + '>' +
                esc(x.l) + '</option>';
            }).join('') + '</select>' +
        '</div>' +
        '<div>' +
          '<label class="control-label" for="et_riph">Catégorie de recherche</label>' +
          '<select id="et_riph">' +
            '<option value="">— à préciser —</option>' +
            RIPH.map(function (x) {
              return '<option value="' + x.v + '"' + (x.v === e.categorie_riph ? ' selected' : '') + '>' +
                esc(x.l) + '</option>';
            }).join('') + '</select>' +
        '</div>' +
        champ('et_type', 'Monocentrique / multicentrique', e.type_etude, 'text', 'ex. monocentrique, 1 centre') +
        '<div style="grid-column:1 / -1;">' +
          '<label class="control-label" for="et_population">Population cible</label>' +
          '<input type="text" id="et_population" value="' + esc(e.population_cible || '') +
            '" placeholder="ex. adultes Marfan confirmé, sinus ≥ 40 mm, inscrits en APA" />' +
        '</div>' +
        '<div style="grid-column:1 / 3;">' +
          '<label class="control-label" for="et_cjp">Critère de jugement principal</label>' +
          '<input type="text" id="et_cjp" value="' + esc(e.critere_jugement_principal || '') +
            '" placeholder="ex. variation du diamètre des sinus à 12 mois (mm)" />' +
        '</div>' +
        '<div style="grid-column:3 / -1;">' +
          '<label class="control-label" for="et_cjs">Critères secondaires</label>' +
          '<input type="text" id="et_cjs" value="' + esc(e.criteres_secondaires || '') +
            '" placeholder="ex. VO2 pic, distensibilité, qualité de vie" />' +
        '</div>' +
        champ('et_effectif', 'Effectif calculé', e.effectif_calcule, 'number', 'sujets nécessaires') +
        champ('et_puissance', 'Puissance', fracTexte(e.puissance), 'text', '0,80') +
        champ('et_alpha', 'Risque α', fracTexte(e.alpha), 'text', '0,05') +
        champ('et_effet', 'Effet attendu', e.taille_effet, 'text', 'ex. Δ 1,5 mm ; σ 2,0') +
        '<div style="grid-column:1 / -1;">' +
          '<label class="control-label" for="et_calcul">Justification de l\'effectif</label>' +
          '<textarea id="et_calcul" rows="3" placeholder="Méthode, hypothèses et source — de sorte que le calcul puisse être refait à l\'identique.">' +
            esc(e.calcul_effectif || '') + '</textarea>' +
        '</div>' +
        '<div style="grid-column:1 / -1;">' +
          '<label class="control-label" for="et_visites">Calendrier des visites</label>' +
          '<input type="text" id="et_visites" value="' + esc(e.calendrier_visites || '') +
            '" placeholder="M0 — inclusion · M6 — intermédiaire · M12 — fin de suivi" />' +
        '</div>' +
        // Ces deux champs nourrissent l'onglet Méthodologie. Une ligne en
        // capitales y ouvre une rubrique, une ligne commençant par « • » est
        // un item : la mise en forme suit ce que vous écrivez.
        '<div style="grid-column:1 / -1;">' +
          '<label class="control-label" for="et_protocole">Protocole de mesure</label>' +
          '<textarea id="et_protocole" rows="6" placeholder="Coupes utilisées, convention de mesure, moment du relevé de la pression artérielle. Une ligne en CAPITALES ouvre une rubrique, une ligne « • » est un item.">' +
            esc(e.protocole_mesure || '') + '</textarea>' +
        '</div>' +
        '<div style="grid-column:1 / -1;">' +
          '<label class="control-label" for="et_analyse">Plan d\'analyse</label>' +
          '<textarea id="et_analyse" rows="5" placeholder="Tests, ordre dans lequel ils sont faits, gestion des données manquantes.">' +
            esc(e.plan_analyse || '') + '</textarea>' +
        '</div>' +
        champ('et_debut', 'Début', e.date_debut ? String(e.date_debut).slice(0, 10) : '', 'date') +
        champ('et_fin', 'Fin prévue', e.date_fin ? String(e.date_fin).slice(0, 10) : '', 'date') +
        champ('et_objectif', 'Objectif d\'inclusions', e.objectif_inclusions, 'number') +
        '<div style="grid-column:1 / -1;">' +
          '<label class="control-label" for="et_notes">Notes internes</label>' +
          '<textarea id="et_notes" rows="2">' + esc(e.notes || '') + '</textarea>' +
        '</div>' +
      '</div>' +
    '</article>' +

    '<article class="card" style="padding:22px; margin-bottom:16px;">' +
      '<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px;">' +
        '<h3 style="font-size:16px; font-weight:800;">📑 Cahier d\'observation</h3>' +
        '<span style="font-size:12px; color:var(--muted);">' + _ouverte.sections.length +
          ' chapitre' + (_ouverte.sections.length > 1 ? 's' : '') + ' · ' + nbVar +
          ' variable' + (nbVar > 1 ? 's' : '') + '</span>' +
        '<button type="button" class="btn-secondary" id="etAjoutSection" style="margin-left:auto;">+ Chapitre</button>' +
      '</div>' +
      '<p style="color:var(--muted); font-size:12.5px; line-height:1.6; margin-bottom:16px;">' +
        'Décrivez les données à recueillir, chapitre par chapitre. L\'ordre est celui du cahier et de l\'export. ' +
        'Stabilisez le cahier avant d\'ouvrir les inclusions : reprendre des données déjà saisies coûte cher.' +
      '</p>' +
      '<div id="etSections"></div>' +
    '</article>' +

    '<article class="card" style="padding:22px;">' +
      '<h3 style="font-size:16px; font-weight:800; margin-bottom:12px;">👥 Patients inclus ' +
        '<span style="font-weight:600; color:var(--muted); font-size:13px;">— ' +
        _ouverte.patients.length + '</span></h3>' +
      (_ouverte.patients.length
        ? '<div style="display:flex; gap:7px; flex-wrap:wrap;">' + _ouverte.patients.map(function (p) {
            var c = p.civil || {};
            var nom = [c.lastName, c.firstName].filter(Boolean).join(' ');
            return '<span style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:7px; ' +
              'padding:4px 10px; font-size:12px; font-weight:700; color:#0369a1;">' + esc(p.id) +
              (nom ? ' <span style="font-weight:600; color:#475569;">' + esc(nom) + '</span>' : '') + '</span>';
          }).join('') + '</div>'
        : '<p style="color:var(--muted); font-size:13px; line-height:1.6; margin:0;">' +
          'Aucun patient rattaché. Le rattachement se fait depuis le dossier du patient, ' +
          'dans la liste déroulante « Étude clinique ».</p>') +
    '</article>';

    dessinerSections();

    el('etRetour').addEventListener('click', function () {
      info(''); _vue = 'resume'; dessinerConsultation();
    });
    el('etEnregistrer').addEventListener('click', enregistrerFiche);
    el('etImprimer').addEventListener('click', imprimerDictionnaire);
    el('etAjoutSection').addEventListener('click', ajouterSection);
  }

  function dessinerSections() {
    var z = el('etSections');
    if (!z || !_ouverte) return;
    if (!_ouverte.sections.length) {
      z.innerHTML = '<div style="padding:16px 18px; background:#f8fafc; border:1px dashed #cbd5e1; ' +
        'border-radius:10px; font-size:13px; color:#64748b; line-height:1.6;">' +
        'Le cahier est vide. Commencez par un chapitre — « Inclusion », « Visite M3 », ' +
        '« Critères de jugement » — puis ajoutez-y les variables.</div>';
      return;
    }

    z.innerHTML = _ouverte.sections.map(function (s, i) {
      return '' +
      '<details open style="margin-bottom:12px; border:1px solid var(--line); border-radius:12px; overflow:hidden;">' +
        '<summary style="padding:12px 15px; background:#f8fafc; cursor:pointer; list-style:none; ' +
          'display:flex; align-items:center; gap:10px; flex-wrap:wrap;">' +
          '<span style="font-size:11px; font-weight:800; color:#0891b2; background:#ecfeff; ' +
            'border:1px solid #a5f3fc; border-radius:5px; padding:2px 7px;">' + (i + 1) + '</span>' +
          '<strong style="flex:1; min-width:140px; font-size:13.5px;">' + esc(s.titre) + '</strong>' +
          (s.visite ? '<span style="font-size:11.5px; color:#7c3aed; background:#faf5ff; ' +
            'border:1px solid #ddd6fe; border-radius:5px; padding:2px 7px; font-weight:700;">' +
            esc(s.visite) + '</span>' : '') +
          '<span style="font-size:11.5px; color:var(--muted);">' + s.variables.length + ' var.</span>' +
        '</summary>' +
        '<div style="padding:14px 15px;">' +
          (s.description ? '<p style="margin:0 0 12px; font-size:12.5px; color:var(--muted); line-height:1.55;">' +
            esc(s.description) + '</p>' : '') +
          (s.variables.length
            ? '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:12.5px;">' +
              '<thead><tr style="text-align:left; color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:.04em;">' +
                '<th style="padding:6px 8px;">Code</th><th style="padding:6px 8px;">Libellé</th>' +
                '<th style="padding:6px 8px;">Type</th><th style="padding:6px 8px;">Valeurs / unité</th>' +
                '<th style="padding:6px 8px;"></th></tr></thead><tbody>' +
              s.variables.map(function (v) {
                return '<tr style="border-top:1px solid var(--line);">' +
                  '<td style="padding:7px 8px; font-family:ui-monospace,monospace; color:#0891b2; font-weight:700;">' +
                    esc(v.code || '—') + '</td>' +
                  '<td style="padding:7px 8px; font-weight:600;">' + esc(v.libelle) +
                    (v.obligatoire ? ' <span style="color:#dc2626;" title="Obligatoire">*</span>' : '') +
                    (v.aide ? '<div style="font-weight:400; color:#94a3b8; font-size:11.5px;">' + esc(v.aide) + '</div>' : '') +
                  '</td>' +
                  '<td style="padding:7px 8px; color:#475569;">' + esc(libelleType(v.type)) + '</td>' +
                  '<td style="padding:7px 8px; color:#475569;">' +
                    esc(v.choix || v.unite ||
                        (v.valeur_min != null || v.valeur_max != null
                          ? '[' + (v.valeur_min != null ? v.valeur_min : '') + ' – ' +
                            (v.valeur_max != null ? v.valeur_max : '') + ']' : '—')) + '</td>' +
                  '<td style="padding:7px 8px; text-align:right; white-space:nowrap;">' +
                    '<button type="button" data-varmod="' + v.id + '" class="btn-light" style="font-size:11px; padding:3px 8px;">✎</button> ' +
                    '<button type="button" data-varsup="' + v.id + '" class="btn-light" style="font-size:11px; padding:3px 8px; color:#991b1b;">✕</button>' +
                  '</td></tr>';
              }).join('') + '</tbody></table></div>'
            : '<p style="margin:0 0 12px; font-size:12.5px; color:#94a3b8;">Aucune variable dans ce chapitre.</p>') +
          '<div style="display:flex; gap:7px; margin-top:12px; flex-wrap:wrap;">' +
            '<button type="button" data-addvar="' + s.id + '" class="btn-secondary" style="font-size:12px;">+ Variable</button>' +
            '<button type="button" data-secmod="' + s.id + '" class="btn-light" style="font-size:12px;">✎ Renommer</button>' +
            '<button type="button" data-secsup="' + s.id + '" class="btn-light" style="font-size:12px; color:#991b1b;">Supprimer le chapitre</button>' +
          '</div>' +
        '</div>' +
      '</details>';
    }).join('');

    var lier = function (attr, fn) {
      Array.prototype.forEach.call(z.querySelectorAll('[' + attr + ']'), function (b) {
        b.addEventListener('click', function () { fn(Number(b.getAttribute(attr))); });
      });
    };
    lier('data-addvar', ajouterVariable);
    lier('data-varmod', modifierVariable);
    lier('data-varsup', supprimerVariable);
    lier('data-secmod', modifierSection);
    lier('data-secsup', supprimerSection);
  }

  // ============================================================
  // Actions
  // ============================================================
  async function charger() {
    try {
      var r = await window.MarfanAPI.etudes.liste();
      _etudes = r.etudes || [];
      // La liste déroulante du dossier patient lit ce cache. Sans cette
      // ligne, une étude créée ici n'apparaissait dans le dossier qu'après
      // rechargement de la page.
      window.__etudesCache = _etudes;
      dessinerBibliotheque();
    } catch (e) {
      info('Bibliothèque non chargée : ' + esc(e && e.message), 'erreur');
    }
  }

  /**
   * Ouvre une étude. On revient au synopsis quand on change d'étude, et on
   * reste où l'on est quand c'est la même : les actions du cahier
   * (ajouter une variable, renommer un chapitre) rechargent l'étude en
   * cours, et renvoyer l'utilisateur au synopsis à chaque geste rendrait la
   * construction du cahier insupportable.
   */
  async function ouvrir(id) {
    var changement = !_ouverte || _ouverte.etude.id !== id;
    try {
      _ouverte = await window.MarfanAPI.etudes.detail(id);
      if (changement) { _vue = 'resume'; _vueFiche = 'abstract'; }
      info('');
      dessinerFiche();
    } catch (e) {
      info('Étude non chargée : ' + esc(e && e.message), 'erreur');
    }
  }

  async function nouvelleEtude() {
    var titre = prompt("Intitulé de l'étude :");
    if (titre === null) return;
    if (!titre.trim()) { info("L'intitulé est requis.", 'alerte'); return; }
    try {
      var r = await window.MarfanAPI.etudes.creer({ intitule: titre.trim() });
      await charger();
      // Une étude qui vient de naître n'a pas de synopsis à lire : on entre
      // directement dans la fiche.
      await ouvrir(r.etude.id);
      _vue = 'edition'; dessinerEdition();
      info("Étude créée. Complétez la fiche — schéma, catégorie de recherche, " +
           "critère principal, effectif — puis construisez le cahier d'observation.", 'ok');
    } catch (e) {
      info('Création impossible : ' + esc(e && e.message), 'erreur');
    }
  }

  function val(id) { var e = el(id); return e ? e.value.trim() : ''; }

  async function enregistrerFiche() {
    if (!_ouverte || _occupe) return;
    if (!val('et_intitule')) { info("L'intitulé ne peut pas être vide.", 'alerte'); return; }
    _occupe = true;
    try {
      var r = await window.MarfanAPI.etudes.modifier(_ouverte.etude.id, {
        intitule: val('et_intitule'), acronyme: val('et_acronyme'), resume: val('et_resume'),
        numero_cpp: val('et_cpp'), numero_nct: val('et_nct'), promoteur: val('et_promoteur'),
        investigateur_principal: val('et_ip'), type_etude: val('et_type'),
        statut: val('et_statut'), date_debut: val('et_debut'), date_fin: val('et_fin'),
        objectif_inclusions: val('et_objectif') ? Number(val('et_objectif')) : null,
        notes: val('et_notes'),
        schema_etude: val('et_schema'), categorie_riph: val('et_riph'),
        critere_jugement_principal: val('et_cjp'), criteres_secondaires: val('et_cjs'),
        population_cible: val('et_population'),
        effectif_calcule: val('et_effectif') ? Number(val('et_effectif')) : null,
        puissance: val('et_puissance'), alpha: val('et_alpha'),
        taille_effet: val('et_effet'), calcul_effectif: val('et_calcul'),
        calendrier_visites: val('et_visites'), protocole_mesure: val('et_protocole'),
        plan_analyse: val('et_analyse')
      });
      _ouverte.etude = r.etude;
      note('💾 Fiche enregistrée.', 'success');
      info('');
      // La bibliothèque affiche l'intitulé et le statut : elle doit suivre.
      try {
        var l = await window.MarfanAPI.etudes.liste();
        _etudes = l.etudes || [];
        window.__etudesCache = _etudes;
      } catch (_) {}
    } catch (e) {
      info('Enregistrement impossible : ' + esc(e && e.message), 'erreur');
    } finally { _occupe = false; }
  }

  async function ajouterSection() {
    var t = prompt('Titre du chapitre :\n\nex. Inclusion, Visite M3, Critères de jugement');
    if (t === null || !t.trim()) return;
    var v = prompt('Visite associée (facultatif) :\n\nex. Inclusion, M3, M6, Sortie') || '';
    try {
      await window.MarfanAPI.etudes.ajouterSection(_ouverte.etude.id,
        { titre: t.trim(), visite: v.trim() });
      await ouvrir(_ouverte.etude.id);
    } catch (e) { info('Ajout impossible : ' + esc(e && e.message), 'erreur'); }
  }

  function sectionDe(sid) {
    return _ouverte.sections.filter(function (s) { return s.id === sid; })[0];
  }
  function variableDe(vid) {
    var r = null;
    _ouverte.sections.forEach(function (s) {
      s.variables.forEach(function (v) { if (v.id === vid) r = v; });
    });
    return r;
  }

  async function modifierSection(sid) {
    var s = sectionDe(sid); if (!s) return;
    var t = prompt('Titre du chapitre :', s.titre);
    if (t === null || !t.trim()) return;
    var v = prompt('Visite associée (facultatif) :', s.visite || '');
    if (v === null) return;
    try {
      await window.MarfanAPI.etudes.modifierSection(sid, { titre: t.trim(), visite: v.trim() });
      await ouvrir(_ouverte.etude.id);
    } catch (e) { info('Modification impossible : ' + esc(e && e.message), 'erreur'); }
  }

  async function supprimerSection(sid) {
    var s = sectionDe(sid); if (!s) return;
    if (!confirm('Supprimer le chapitre « ' + s.titre + ' » et ses ' + s.variables.length +
                 ' variable(s) ?\n\nCette action est définitive.')) return;
    try {
      await window.MarfanAPI.etudes.supprimerSection(sid);
      await ouvrir(_ouverte.etude.id);
    } catch (e) { info('Suppression impossible : ' + esc(e && e.message), 'erreur'); }
  }

  /** Saisie d'une variable. Les invites se suivent plutôt que de s'afficher
   *  dans un formulaire : on définit une variable en pensant au recueil, pas
   *  en remplissant un écran, et l'enchaînement des questions correspond à
   *  l'ordre dans lequel on y réfléchit. */
  async function saisirVariable(v) {
    var libelle = prompt('Libellé de la variable :\n\nex. Pression artérielle systolique', (v && v.libelle) || '');
    if (libelle === null || !libelle.trim()) return null;

    var typeTxt = prompt(
      'Type de donnée ?\n\n' + TYPES.map(function (t, i) { return (i + 1) + ' — ' + t.l; }).join('\n'),
      v ? String(TYPES.findIndex(function (t) { return t.v === v.type; }) + 1) : '1');
    if (typeTxt === null) return null;
    var type = (TYPES[Number(typeTxt) - 1] || TYPES[0]).v;

    var choix = '';
    if (type === 'choix' || type === 'choix_multiple') {
      choix = prompt('Valeurs possibles, séparées par des points-virgules :\n\nex. Jamais;Parfois;Souvent;Toujours',
        (v && v.choix) || '');
      if (choix === null || !choix.trim()) return null;
    }
    var unite = '';
    if (type === 'nombre') {
      unite = prompt('Unité (facultatif) :\n\nex. mmHg, mL/kg/min, kg', (v && v.unite) || '') || '';
    }
    var code = prompt("Code de la variable pour les exports (facultatif) :\n\nex. PAS_M3",
      (v && v.code) || '') || '';
    var obligatoire = confirm('Cette variable est-elle obligatoire ?\n\nOK = oui, Annuler = non');

    return {
      libelle: libelle.trim(), type: type, choix: choix.trim(),
      unite: unite.trim(), code: code.trim(), obligatoire: obligatoire
    };
  }

  async function ajouterVariable(sid) {
    var d = await saisirVariable(null);
    if (!d) return;
    try {
      await window.MarfanAPI.etudes.ajouterVariable(sid, d);
      await ouvrir(_ouverte.etude.id);
    } catch (e) { info('Ajout impossible : ' + esc(e && e.message), 'erreur'); }
  }

  async function modifierVariable(vid) {
    var v = variableDe(vid); if (!v) return;
    var d = await saisirVariable(v);
    if (!d) return;
    try {
      await window.MarfanAPI.etudes.modifierVariable(vid, d);
      await ouvrir(_ouverte.etude.id);
    } catch (e) { info('Modification impossible : ' + esc(e && e.message), 'erreur'); }
  }

  async function supprimerVariable(vid) {
    var v = variableDe(vid); if (!v) return;
    if (!confirm('Supprimer la variable « ' + v.libelle + ' » ?')) return;
    try {
      await window.MarfanAPI.etudes.supprimerVariable(vid);
      await ouvrir(_ouverte.etude.id);
    } catch (e) { info('Suppression impossible : ' + esc(e && e.message), 'erreur'); }
  }

  // ============================================================
  // Dictionnaire de données imprimable
  // ------------------------------------------------------------
  // C'est le livrable : le document qu'on joint au protocole et qu'on fait
  // relire avant d'ouvrir les inclusions.
  // ============================================================
  function imprimerDictionnaire() {
    if (!_ouverte) return;
    var e = _ouverte.etude;
    var corps = _ouverte.sections.map(function (s, i) {
      return '<section class="dd-sec">' +
        '<h3>' + (i + 1) + '. ' + esc(s.titre) +
          (s.visite ? ' <em>— ' + esc(s.visite) + '</em>' : '') + '</h3>' +
        (s.description ? '<p class="dd-desc">' + esc(s.description) + '</p>' : '') +
        (s.variables.length
          ? '<table><thead><tr><th>Code</th><th>Libellé</th><th>Type</th>' +
            '<th>Valeurs / unité</th><th>Oblig.</th></tr></thead><tbody>' +
            s.variables.map(function (v) {
              return '<tr><td class="dd-code">' + esc(v.code || '') + '</td>' +
                '<td>' + esc(v.libelle) +
                (v.aide ? '<div class="dd-aide">' + esc(v.aide) + '</div>' : '') + '</td>' +
                '<td>' + esc(libelleType(v.type)) + '</td>' +
                '<td>' + esc(v.choix || v.unite ||
                  (v.valeur_min != null || v.valeur_max != null
                    ? '[' + (v.valeur_min != null ? v.valeur_min : '') + ' – ' +
                      (v.valeur_max != null ? v.valeur_max : '') + ']' : '')) + '</td>' +
                '<td>' + (v.obligatoire ? 'oui' : '') + '</td></tr>';
            }).join('') + '</tbody></table>'
          : '<p class="dd-vide">Aucune variable définie.</p>') +
        '</section>';
    }).join('');

    var entete = [
      ['Acronyme', e.acronyme], ['Promoteur', e.promoteur],
      ['Investigateur principal', e.investigateur_principal],
      ['Numéro CPP', e.numero_cpp], ['Numéro NCT', e.numero_nct],
      ['Type', e.type_etude], ['Statut', statut(e.statut).l],
      ['Début', jour(e.date_debut)], ['Fin prévue', jour(e.date_fin)],
      ['Objectif d\'inclusions', e.objectif_inclusions]
    ].filter(function (x) { return x[1]; });

    injecterStyle();
    var hote = el('ficheApaImpression');
    if (!hote) {
      hote = document.createElement('div');
      hote.id = 'ficheApaImpression';
      document.body.appendChild(hote);
    }
    hote.style.display = 'none';
    hote.innerHTML =
      '<article class="dictionnaire">' +
        '<header><h2>' + esc(e.intitule) + '</h2>' +
        '<span>Cahier d\'observation — dictionnaire de données</span></header>' +
        '<div class="dd-bandeau">' + entete.map(function (x) {
          return '<div><span class="dd-k">' + esc(x[0]) + '</span>' +
                 '<span class="dd-v">' + esc(x[1]) + '</span></div>';
        }).join('') + '</div>' +
        (e.resume ? '<section class="dd-sec"><h3>Résumé</h3><p>' + esc(e.resume) + '</p></section>' : '') +
        corps +
        '<footer class="dd-pied">Document généré le ' + new Date().toLocaleDateString('fr-FR') + '</footer>' +
      '</article>';
    window.print();
  }

  function injecterStyle() {
    if (el('etudesStyle')) return;
    // On réutilise la mécanique d'impression des fiches : un seul conteneur
    // visible à l'impression, tout le reste masqué.
    if (window.FicheAPA && window.FicheAPA.injecterStyle) window.FicheAPA.injecterStyle();
    var st = document.createElement('style');
    st.id = 'etudesStyle';
    st.textContent = `
      .dictionnaire { background:#fff; color:#10233f; padding:22px 26px; font-size:13px;
        line-height:1.55; max-width:900px; }
      .dictionnaire header { border-bottom:2px solid #0f766e; padding-bottom:10px; margin-bottom:14px; }
      .dictionnaire header h2 { font-size:19px; font-weight:800; margin:0 0 3px; }
      .dictionnaire header span { font-size:11.5px; color:#64748b; font-weight:700;
        text-transform:uppercase; letter-spacing:.06em; }
      .dd-bandeau { display:flex; flex-wrap:wrap; gap:3px 0; background:#f8fafc;
        border:1px solid #e8edf4; border-radius:8px; padding:10px 12px; margin-bottom:16px; }
      .dd-bandeau > div { flex:1 1 32%; min-width:190px; display:flex; gap:7px; font-size:12px; padding:2px 6px 2px 0; }
      .dd-k { color:#64748b; font-weight:700; min-width:96px; }
      .dd-v { font-weight:600; }
      .dd-sec { margin-bottom:18px; }
      .dd-sec h3 { font-size:13px; font-weight:800; color:#0f766e; text-transform:uppercase;
        letter-spacing:.04em; margin:0 0 7px; padding-bottom:4px; border-bottom:1px solid #e8edf4; }
      .dd-sec h3 em { font-style:normal; color:#7c3aed; text-transform:none; letter-spacing:0; }
      .dd-desc { margin:0 0 8px; color:#475569; font-size:12.5px; }
      .dd-vide { color:#94a3b8; font-size:12.5px; margin:0; }
      .dictionnaire table { width:100%; border-collapse:collapse; font-size:12px; }
      .dictionnaire th { text-align:left; padding:5px 8px; background:#f1f5f9; color:#475569;
        font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; border:1px solid #e2e8f0; }
      .dictionnaire td { padding:5px 8px; border:1px solid #e2e8f0; vertical-align:top; }
      .dd-code { font-family:ui-monospace,monospace; color:#0f766e; font-weight:700; white-space:nowrap; }
      .dd-aide { color:#94a3b8; font-size:11px; }
      .dd-pied { margin-top:18px; padding-top:8px; border-top:1px solid #e8edf4;
        font-size:11px; color:#94a3b8; }
      @media print {
        .dictionnaire { padding:0; max-width:none; font-size:10pt; }
        .dd-sec { break-inside:avoid; page-break-inside:avoid; }
        .dictionnaire thead { display:table-header-group; }
      }
    `;
    document.head.appendChild(st);
  }

  // ============================================================
  // Montage
  // ============================================================
  function render() {
    var hote = el('etudesMount');
    if (!hote) return;
    if (!hote.dataset.pret) {
      hote.innerHTML =
        '<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px;">' +
          '<p style="flex:1; min-width:240px; margin:0; color:var(--muted); font-size:13px; line-height:1.6;">' +
            'Protocoles en cours, numéros réglementaires, cahiers d\'observation et patients inclus.</p>' +
          '<button type="button" class="btn-gradient" id="etNouvelle">+ Nouvelle étude</button>' +
        '</div>' +
        '<div id="etInfo" style="display:none;"></div>' +
        '<div id="etContenu"></div>';
      hote.dataset.pret = '1';
      el('etNouvelle').addEventListener('click', nouvelleEtude);
    }
    charger();
  }

  /** Liste des études actives, pour la liste déroulante du dossier patient. */
  function liste() { return _etudes.slice(); }

  window.EtudesUI = { render: render, charger: charger, liste: liste };
})();
