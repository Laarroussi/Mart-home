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

  var STATUTS = [
    { v: 'preparation',       l: 'En préparation',   c: '#64748b', f: '#f8fafc', b: '#e2e8f0' },
    { v: 'en_cours',          l: 'Inclusions ouvertes', c: '#065f46', f: '#ecfdf5', b: '#a7f3d0' },
    { v: 'inclusions_closes', l: 'Inclusions closes', c: '#b45309', f: '#fffbeb', b: '#fde68a' },
    { v: 'suspendue',         l: 'Suspendue',        c: '#991b1b', f: '#fef2f2', b: '#fecaca' },
    { v: 'terminee',          l: 'Terminée',         c: '#5b21b6', f: '#faf5ff', b: '#ddd6fe' }
  ];
  function statut(v) {
    return STATUTS.filter(function (s) { return s.v === v; })[0] || STATUTS[0];
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
  // Fiche d'une étude
  // ============================================================
  function champ(id, libelle, valeur, type, aide) {
    return '<div>' +
      '<label class="control-label" for="' + id + '">' + esc(libelle) + '</label>' +
      '<input type="' + (type || 'text') + '" id="' + id + '" value="' + esc(valeur || '') + '"' +
      (aide ? ' placeholder="' + esc(aide) + '"' : '') + ' />' +
      '</div>';
  }

  function dessinerFiche() {
    var z = el('etContenu');
    if (!z || !_ouverte) return;
    var e = _ouverte.etude;
    var nbVar = _ouverte.sections.reduce(function (n, s) { return n + s.variables.length; }, 0);

    z.innerHTML = '' +
    '<div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">' +
      '<button type="button" class="btn-secondary" id="etRetour">← Bibliothèque</button>' +
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
        champ('et_type', 'Type d\'étude', e.type_etude, 'text', 'ex. interventionnelle, monocentrique') +
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

    el('etRetour').addEventListener('click', function () { info(''); dessinerBibliotheque(); });
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

  async function ouvrir(id) {
    try {
      _ouverte = await window.MarfanAPI.etudes.detail(id);
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
      await ouvrir(r.etude.id);
      info("Étude créée. Complétez la fiche, puis construisez le cahier d'observation.", 'ok');
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
        notes: val('et_notes')
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
