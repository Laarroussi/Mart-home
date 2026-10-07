/* ============================================================
   QUESTIONNAIRES LIBRES — composer, diffuser, dépouiller
   ------------------------------------------------------------
   Un espace à part, qui ne touche à aucun dossier patient. On y écrit ses
   propres questionnaires, on les envoie par courriel à qui l'on veut, et on
   récupère les réponses dans un tableau exportable.

   La différence avec le SF-36 et le GPAQ n'est pas qu'une question
   d'étiquette : ceux-là partent automatiquement aux patients inclus et leurs
   scores nourrissent les évaluations ; ceux-ci ne font rien de tel. Ils
   vivent dans leurs propres tables, sans colonne patient, parce qu'un
   questionnaire libre s'adresse aussi bien à un témoin, à un collègue ou à
   quelqu'un qui n'est pas suivi.

   Chaque questionnaire n'appartient qu'à son auteur : vous ne voyez pas ceux
   des autres investigateurs, et ils ne voient pas les vôtres.
   ============================================================ */
(function () {
  'use strict';

  var _liste = [];
  var _ouvert = null;     // { questionnaire, questions, envois }
  var _reponses = null;
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

  var TYPES = [
    { v: 'texte',          l: 'Texte court' },
    { v: 'texte_long',     l: 'Texte long' },
    { v: 'nombre',         l: 'Nombre' },
    { v: 'date',           l: 'Date' },
    { v: 'oui_non',        l: 'Oui / Non' },
    { v: 'choix',          l: 'Choix unique' },
    { v: 'choix_multiple', l: 'Choix multiple' },
    { v: 'echelle',        l: 'Échelle chiffrée' }
  ];
  function libelleType(v) {
    return (TYPES.filter(function (t) { return t.v === v; })[0] || TYPES[0]).l;
  }

  function info(html, ton) {
    var z = el('qlInfo');
    if (!z) return;
    if (!html) { z.style.display = 'none'; z.innerHTML = ''; return; }
    var c = ton === 'erreur' ? ['#fef2f2', '#fecaca', '#991b1b']
          : ton === 'ok'     ? ['#ecfdf5', '#a7f3d0', '#065f46']
          : ton === 'alerte' ? ['#fffbeb', '#fde68a', '#92400e']
                             : ['#f8fafc', '#e2e8f0', '#475569'];
    z.style.cssText = 'display:block; margin-bottom:16px; padding:11px 14px; border-radius:10px; ' +
      'font-size:12.5px; line-height:1.55; background:' + c[0] + '; border:1px solid ' + c[1] +
      '; color:' + c[2] + ';';
    z.innerHTML = html;
  }

  // ============================================================
  // Bibliothèque
  // ============================================================
  function dessinerListe() {
    var z = el('qlContenu');
    if (!z) return;
    _ouvert = null; _reponses = null;

    if (!_liste.length) {
      z.innerHTML =
        '<article class="card" style="padding:34px 28px; text-align:center;">' +
          '<div style="font-size:40px; margin-bottom:10px;">📝</div>' +
          '<h3 style="font-size:17px; font-weight:800; margin-bottom:6px;">Aucun questionnaire</h3>' +
          '<p style="color:var(--muted); font-size:13px; line-height:1.6; max-width:470px; margin:0 auto 18px;">' +
            'Composez vos propres questions, envoyez un lien par courriel à qui vous voulez, ' +
            'et récupérez les réponses ici. Rien n\'est rattaché aux dossiers patients.</p>' +
          '<button type="button" class="btn-gradient" id="qlVide">+ Créer un questionnaire</button>' +
        '</article>';
      var b = el('qlVide'); if (b) b.addEventListener('click', creer);
      return;
    }

    z.innerHTML = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:14px;">' +
      _liste.map(function (q) {
        var part = q.nb_envois ? Math.round((q.nb_reponses / q.nb_envois) * 100) : 0;
        return '' +
        '<article class="card" data-ql="' + q.id + '" style="padding:18px 20px; cursor:pointer; display:flex; flex-direction:column; gap:10px;">' +
          '<div style="display:flex; align-items:flex-start; gap:10px;">' +
            '<h3 style="flex:1; font-size:15px; font-weight:800; line-height:1.4; margin:0;">' + esc(q.titre) + '</h3>' +
            (q.actif ? '' : '<span style="font-size:10.5px; font-weight:800; text-transform:uppercase; ' +
              'color:#92400e; background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:3px 8px;">clos</span>') +
          '</div>' +
          (q.description ? '<p style="margin:0; font-size:12.5px; color:var(--muted); line-height:1.55; ' +
            'display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">' +
            esc(q.description) + '</p>' : '') +
          '<div style="margin-top:auto; padding-top:10px; border-top:1px solid var(--line); display:flex; gap:14px; font-size:12px; color:#475569;">' +
            '<span><strong style="color:#0b1530;">' + q.nb_questions + '</strong> question' + (q.nb_questions > 1 ? 's' : '') + '</span>' +
            '<span><strong style="color:#0b1530;">' + q.nb_reponses + '</strong> / ' + q.nb_envois + ' réponse' + (q.nb_reponses > 1 ? 's' : '') + '</span>' +
          '</div>' +
          (q.nb_envois ? '<div style="height:4px; background:#e2e8f0; border-radius:99px; overflow:hidden;">' +
            '<div style="height:100%; width:' + part + '%; background:linear-gradient(90deg,#0f766e,#14b8a6);"></div></div>' : '') +
        '</article>';
      }).join('') + '</div>';

    Array.prototype.forEach.call(z.querySelectorAll('[data-ql]'), function (c) {
      c.addEventListener('click', function () { ouvrir(Number(c.dataset.ql)); });
    });
  }

  // ============================================================
  // Fiche d'un questionnaire
  // ============================================================
  function dessinerFiche() {
    var z = el('qlContenu');
    if (!z || !_ouvert) return;
    var q = _ouvert.questionnaire;
    var repondu = _ouvert.envois.filter(function (e) { return e.repondu_le; }).length;

    z.innerHTML = '' +
    '<div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; flex-wrap:wrap;">' +
      '<button type="button" class="btn-secondary" id="qlRetour">← Mes questionnaires</button>' +
      '<strong style="flex:1; min-width:200px; font-size:15px;">' + esc(q.titre) + '</strong>' +
      '<button type="button" class="btn-secondary" id="qlExport">⬇ Exporter (CSV)</button>' +
      '<button type="button" class="btn-gradient" id="qlEnregistrer">💾 Enregistrer</button>' +
    '</div>' +

    '<article class="card" style="padding:22px; margin-bottom:16px;">' +
      '<h3 style="font-size:16px; font-weight:800; margin-bottom:16px;">📝 Le questionnaire</h3>' +
      '<div style="display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px;">' +
        '<div style="grid-column:1 / 4;">' +
          '<label class="control-label" for="ql_titre">Titre *</label>' +
          '<input type="text" id="ql_titre" value="' + esc(q.titre) + '" />' +
        '</div>' +
        '<div>' +
          '<label class="control-label" for="ql_validite">Validité du lien (jours)</label>' +
          '<input type="number" id="ql_validite" min="1" max="365" value="' + (q.validite_jours || 30) + '" />' +
        '</div>' +
        '<div style="grid-column:1 / -1;">' +
          '<label class="control-label" for="ql_description">Description interne</label>' +
          '<input type="text" id="ql_description" value="' + esc(q.description || '') + '" placeholder="Pour vous retrouver — non affichée au répondant" />' +
        '</div>' +
        '<div style="grid-column:1 / -1;">' +
          '<label class="control-label" for="ql_consigne">Consigne affichée en tête du formulaire</label>' +
          '<textarea id="ql_consigne" rows="2" placeholder="Ce questionnaire prend environ cinq minutes…">' + esc(q.consigne || '') + '</textarea>' +
        '</div>' +
        '<div style="grid-column:1 / -1;">' +
          '<label class="control-label" for="ql_fin">Message de remerciement après validation</label>' +
          '<input type="text" id="ql_fin" value="' + esc(q.message_fin || '') + '" placeholder="Merci pour votre participation." />' +
        '</div>' +
        '<div>' +
          '<label class="control-label" for="ql_actif">État</label>' +
          '<select id="ql_actif">' +
            '<option value="1"' + (q.actif ? ' selected' : '') + '>Ouvert aux réponses</option>' +
            '<option value="0"' + (q.actif ? '' : ' selected') + '>Clos</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
    '</article>' +

    '<article class="card" style="padding:22px; margin-bottom:16px;">' +
      '<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:14px;">' +
        '<h3 style="font-size:16px; font-weight:800;">❓ Questions</h3>' +
        '<span style="font-size:12px; color:var(--muted);">' + _ouvert.questions.length + '</span>' +
        '<button type="button" class="btn-secondary" id="qlAjoutQ" style="margin-left:auto;">+ Question</button>' +
      '</div>' +
      '<div id="qlQuestions"></div>' +
    '</article>' +

    '<article class="card" style="padding:22px; margin-bottom:16px;">' +
      '<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:6px;">' +
        '<h3 style="font-size:16px; font-weight:800;">✉️ Envois</h3>' +
        '<span style="font-size:12px; color:var(--muted);">' + repondu + ' réponse(s) sur ' + _ouvert.envois.length + ' envoi(s)</span>' +
        '<button type="button" class="btn-gradient" id="qlEnvoyer" style="margin-left:auto;">✉️ Envoyer à une adresse</button>' +
      '</div>' +
      '<p style="color:var(--muted); font-size:12.5px; line-height:1.6; margin-bottom:14px;">' +
        'Chaque personne reçoit un lien qui lui est propre, valable ' + (q.validite_jours || 30) +
        ' jours et utilisable une seule fois. Aucun compte à créer de son côté.' +
      '</p>' +
      '<div id="qlEnvois"></div>' +
    '</article>' +

    '<article class="card" style="padding:22px;">' +
      '<h3 style="font-size:16px; font-weight:800; margin-bottom:14px;">📊 Réponses</h3>' +
      '<div id="qlReponses"></div>' +
    '</article>';

    dessinerQuestions();
    dessinerEnvois();
    chargerReponses();

    el('qlRetour').addEventListener('click', function () { info(''); dessinerListe(); });
    el('qlEnregistrer').addEventListener('click', enregistrer);
    el('qlExport').addEventListener('click', exporter);
    el('qlAjoutQ').addEventListener('click', ajouterQuestion);
    el('qlEnvoyer').addEventListener('click', envoyer);
  }

  function dessinerQuestions() {
    var z = el('qlQuestions');
    if (!z || !_ouvert) return;
    if (!_ouvert.questions.length) {
      z.innerHTML = '<div style="padding:16px 18px; background:#f8fafc; border:1px dashed #cbd5e1; ' +
        'border-radius:10px; font-size:13px; color:#64748b; line-height:1.6;">' +
        'Aucune question. Ajoutez-en au moins une avant d\'envoyer le questionnaire.</div>';
      return;
    }
    z.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:12.5px;">' +
      '<thead><tr style="text-align:left; color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:.04em;">' +
        '<th style="padding:6px 8px; width:34px;">#</th><th style="padding:6px 8px;">Question</th>' +
        '<th style="padding:6px 8px;">Type</th><th style="padding:6px 8px;">Réponses possibles</th>' +
        '<th style="padding:6px 8px;"></th></tr></thead><tbody>' +
      _ouvert.questions.map(function (q, i) {
        return '<tr style="border-top:1px solid var(--line);">' +
          '<td style="padding:7px 8px; color:#94a3b8; font-weight:700;">' + (i + 1) + '</td>' +
          '<td style="padding:7px 8px; font-weight:600;">' + esc(q.libelle) +
            (q.obligatoire ? ' <span style="color:#dc2626;" title="Réponse attendue">*</span>' : '') +
            (q.code ? ' <span style="font-family:ui-monospace,monospace; color:#0f766e; font-weight:700; font-size:11.5px;">' + esc(q.code) + '</span>' : '') +
            (q.aide ? '<div style="font-weight:400; color:#94a3b8; font-size:11.5px;">' + esc(q.aide) + '</div>' : '') +
          '</td>' +
          '<td style="padding:7px 8px; color:#475569;">' + esc(libelleType(q.type)) + '</td>' +
          '<td style="padding:7px 8px; color:#475569;">' +
            esc(q.choix || (q.valeur_min != null || q.valeur_max != null
              ? 'de ' + (q.valeur_min != null ? q.valeur_min : '') + ' à ' + (q.valeur_max != null ? q.valeur_max : '')
              : '—')) + '</td>' +
          '<td style="padding:7px 8px; text-align:right; white-space:nowrap;">' +
            '<button type="button" data-qmod="' + q.id + '" class="btn-light" style="font-size:11px; padding:3px 8px;">✎</button> ' +
            '<button type="button" data-qsup="' + q.id + '" class="btn-light" style="font-size:11px; padding:3px 8px; color:#991b1b;">✕</button>' +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';

    Array.prototype.forEach.call(z.querySelectorAll('[data-qmod]'), function (b) {
      b.addEventListener('click', function () { modifierQuestion(Number(b.dataset.qmod)); });
    });
    Array.prototype.forEach.call(z.querySelectorAll('[data-qsup]'), function (b) {
      b.addEventListener('click', function () { supprimerQuestion(Number(b.dataset.qsup)); });
    });
  }

  function dessinerEnvois() {
    var z = el('qlEnvois');
    if (!z || !_ouvert) return;
    if (!_ouvert.envois.length) {
      z.innerHTML = '<p style="color:var(--muted); font-size:13px; margin:0;">Aucun envoi pour l\'instant.</p>';
      return;
    }
    z.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:12.5px;">' +
      '<thead><tr style="text-align:left; color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:.04em;">' +
        '<th style="padding:6px 8px;">Destinataire</th><th style="padding:6px 8px;">Envoyé</th>' +
        '<th style="padding:6px 8px;">État</th><th style="padding:6px 8px;"></th></tr></thead><tbody>' +
      _ouvert.envois.map(function (e) {
        var etat = e.repondu_le
          ? '<span style="color:#065f46; font-weight:700;">✓ Répondu le ' + jour(e.repondu_le) + '</span>'
          : (new Date(e.expire_le) < new Date()
              ? '<span style="color:#991b1b; font-weight:700;">Lien expiré</span>'
              : '<span style="color:#b45309; font-weight:700;">En attente</span>' +
                (e.relances ? ' <span style="color:#94a3b8;">· ' + e.relances + ' relance(s)</span>' : ''));
        var alerteMail = (e.mail_statut && e.mail_statut.indexOf('echec') === 0)
          ? '<div style="color:#991b1b; font-size:11.5px;">Courriel non parti</div>' : '';
        return '<tr style="border-top:1px solid var(--line);">' +
          '<td style="padding:7px 8px;"><strong>' + esc(e.nom || '—') + '</strong>' +
            '<div style="color:#64748b; font-size:11.5px;">' + esc(e.email) + '</div>' + alerteMail + '</td>' +
          '<td style="padding:7px 8px; color:#475569;">' + jour(e.envoye_le) + '</td>' +
          '<td style="padding:7px 8px;">' + etat + '</td>' +
          '<td style="padding:7px 8px; text-align:right; white-space:nowrap;">' +
            (e.repondu_le ? '' :
              '<button type="button" data-rel="' + e.id + '" class="btn-light" style="font-size:11px; padding:3px 8px;">Relancer</button> ' +
              '<button type="button" data-ann="' + e.id + '" class="btn-light" style="font-size:11px; padding:3px 8px; color:#991b1b;">Annuler</button>') +
          '</td></tr>';
      }).join('') + '</tbody></table></div>';

    Array.prototype.forEach.call(z.querySelectorAll('[data-rel]'), function (b) {
      b.addEventListener('click', function () { relancer(Number(b.dataset.rel)); });
    });
    Array.prototype.forEach.call(z.querySelectorAll('[data-ann]'), function (b) {
      b.addEventListener('click', function () { annuler(Number(b.dataset.ann)); });
    });
  }

  function dessinerReponses() {
    var z = el('qlReponses');
    if (!z) return;
    if (!_reponses || !_reponses.lignes.length) {
      z.innerHTML = '<p style="color:var(--muted); font-size:13px; margin:0;">' +
        'Aucune réponse reçue pour l\'instant.</p>';
      return;
    }
    z.innerHTML = '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:12.5px;">' +
      '<thead><tr style="text-align:left; color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:.04em;">' +
        '<th style="padding:6px 8px; position:sticky; left:0; background:#fff;">Répondant</th>' +
        '<th style="padding:6px 8px;">Le</th>' +
        _reponses.questions.map(function (q) {
          return '<th style="padding:6px 8px; min-width:130px;">' + esc(q.code || q.libelle) + '</th>';
        }).join('') + '</tr></thead><tbody>' +
      _reponses.lignes.map(function (l) {
        return '<tr style="border-top:1px solid var(--line);">' +
          '<td style="padding:7px 8px; position:sticky; left:0; background:#fff;"><strong>' +
            esc(l.nom || l.email) + '</strong></td>' +
          '<td style="padding:7px 8px; color:#475569; white-space:nowrap;">' + jour(l.repondu_le) + '</td>' +
          _reponses.questions.map(function (q) {
            return '<td style="padding:7px 8px; color:#334155;">' + esc(l.valeurs[q.id] || '') + '</td>';
          }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  // ============================================================
  // Actions
  // ============================================================
  async function charger() {
    try {
      var r = await window.MarfanAPI.qlibres.liste();
      _liste = r.questionnaires || [];
      dessinerListe();
    } catch (e) { info('Liste non chargée : ' + esc(e && e.message), 'erreur'); }
  }

  async function ouvrir(id) {
    try {
      _ouvert = await window.MarfanAPI.qlibres.detail(id);
      info('');
      dessinerFiche();
    } catch (e) { info('Questionnaire non chargé : ' + esc(e && e.message), 'erreur'); }
  }

  async function chargerReponses() {
    if (!_ouvert) return;
    try {
      _reponses = await window.MarfanAPI.qlibres.reponses(_ouvert.questionnaire.id);
      dessinerReponses();
    } catch (_) { /* le tableau reste vide, l'essentiel est ailleurs */ }
  }

  async function creer() {
    var t = prompt('Titre du questionnaire :');
    if (t === null || !t.trim()) return;
    try {
      var r = await window.MarfanAPI.qlibres.creer({ titre: t.trim() });
      await charger();
      await ouvrir(r.questionnaire.id);
      info('Questionnaire créé. Ajoutez vos questions, puis envoyez le lien.', 'ok');
    } catch (e) { info('Création impossible : ' + esc(e && e.message), 'erreur'); }
  }

  function val(id) { var e = el(id); return e ? e.value.trim() : ''; }

  async function enregistrer() {
    if (!_ouvert || _occupe) return;
    if (!val('ql_titre')) { info('Le titre ne peut pas être vide.', 'alerte'); return; }
    _occupe = true;
    try {
      var r = await window.MarfanAPI.qlibres.modifier(_ouvert.questionnaire.id, {
        titre: val('ql_titre'), description: val('ql_description'),
        consigne: val('ql_consigne'), message_fin: val('ql_fin'),
        validite_jours: Number(val('ql_validite')) || 30,
        actif: val('ql_actif') === '1'
      });
      _ouvert.questionnaire = r.questionnaire;
      note('💾 Enregistré.', 'success');
      info('');
      try { var l = await window.MarfanAPI.qlibres.liste(); _liste = l.questionnaires || []; } catch (_) {}
    } catch (e) { info('Enregistrement impossible : ' + esc(e && e.message), 'erreur'); }
    finally { _occupe = false; }
  }

  /** Saisie d'une question, par invites successives — même parti pris que
   *  pour le cahier eCRF : on définit une question en y réfléchissant dans
   *  cet ordre, pas en remplissant un écran de champs. */
  function saisirQuestion(q) {
    var libelle = prompt('Intitulé de la question :', (q && q.libelle) || '');
    if (libelle === null || !libelle.trim()) return null;

    var t = prompt('Type de réponse ?\n\n' +
      TYPES.map(function (x, i) { return (i + 1) + ' — ' + x.l; }).join('\n'),
      q ? String(TYPES.findIndex(function (x) { return x.v === q.type; }) + 1) : '1');
    if (t === null) return null;
    var type = (TYPES[Number(t) - 1] || TYPES[0]).v;

    var choix = '', min = '', max = '';
    if (type === 'choix' || type === 'choix_multiple') {
      choix = prompt('Réponses possibles, séparées par des points-virgules :\n\n' +
        'ex. Jamais;Parfois;Souvent;Toujours', (q && q.choix) || '');
      if (choix === null || !choix.trim()) return null;
    } else if (type === 'echelle') {
      min = prompt('Valeur minimale de l\'échelle :', (q && q.valeur_min != null) ? q.valeur_min : '0');
      if (min === null) return null;
      max = prompt('Valeur maximale de l\'échelle :', (q && q.valeur_max != null) ? q.valeur_max : '10');
      if (max === null) return null;
    } else if (type === 'nombre') {
      min = prompt('Valeur minimale acceptée (facultatif) :', (q && q.valeur_min != null) ? q.valeur_min : '') || '';
      max = prompt('Valeur maximale acceptée (facultatif) :', (q && q.valeur_max != null) ? q.valeur_max : '') || '';
    }

    var code = prompt('Code de la colonne pour l\'export (facultatif) :\n\nex. DOULEUR_J7',
      (q && q.code) || '') || '';
    var obligatoire = confirm('Cette réponse est-elle obligatoire ?\n\nOK = oui, Annuler = non');

    return {
      libelle: libelle.trim(), type: type, choix: choix.trim(), code: code.trim(),
      valeur_min: min === '' ? null : Number(min), valeur_max: max === '' ? null : Number(max),
      obligatoire: obligatoire
    };
  }

  async function ajouterQuestion() {
    var d = saisirQuestion(null);
    if (!d) return;
    try {
      await window.MarfanAPI.qlibres.ajouterQuestion(_ouvert.questionnaire.id, d);
      await ouvrir(_ouvert.questionnaire.id);
    } catch (e) { info('Ajout impossible : ' + esc(e && e.message), 'erreur'); }
  }

  function questionDe(id) {
    return _ouvert.questions.filter(function (q) { return q.id === id; })[0];
  }

  async function modifierQuestion(id) {
    var q = questionDe(id); if (!q) return;
    // Modifier une question déjà remplie change le sens des réponses reçues :
    // on prévient, car rien ne le rattraperait ensuite.
    var dejaRepondu = _reponses && _reponses.lignes.length;
    if (dejaRepondu && !confirm(
      'Des réponses ont déjà été reçues.\n\nModifier cette question ne change pas les réponses ' +
      'déjà enregistrées : vous aurez des réponses à deux questions différentes dans la même ' +
      'colonne.\n\nContinuer ?')) return;
    var d = saisirQuestion(q);
    if (!d) return;
    try {
      await window.MarfanAPI.qlibres.modifierQuestion(id, d);
      await ouvrir(_ouvert.questionnaire.id);
    } catch (e) { info('Modification impossible : ' + esc(e && e.message), 'erreur'); }
  }

  async function supprimerQuestion(id) {
    var q = questionDe(id); if (!q) return;
    if (!confirm('Supprimer « ' + q.libelle + ' » ?\n\nLes réponses déjà reçues à cette question ' +
                 'seront effacées avec elle.')) return;
    try {
      await window.MarfanAPI.qlibres.supprimerQuestion(id);
      await ouvrir(_ouvert.questionnaire.id);
    } catch (e) { info('Suppression impossible : ' + esc(e && e.message), 'erreur'); }
  }

  async function envoyer() {
    if (!_ouvert) return;
    if (!_ouvert.questions.length) {
      info('Ajoutez au moins une question avant d\'envoyer.', 'alerte'); return;
    }
    var email = prompt('Adresse électronique du destinataire :');
    if (email === null || !email.trim()) return;
    var nom = prompt('Nom du destinataire (facultatif) :\n\nIl apparaîtra dans le courriel et dans vos résultats.') || '';
    try {
      var r = await window.MarfanAPI.qlibres.envoyer(_ouvert.questionnaire.id,
        { email: email.trim(), nom: nom.trim() });
      await ouvrir(_ouvert.questionnaire.id);
      if (r && r.avertissement) {
        // Le lien reste valable : l'afficher évite de tout refaire quand le
        // serveur de courriel est en défaut.
        info('<strong>Invitation créée, mais le courriel n\'est pas parti.</strong><br>' +
          esc(r.avertissement) + '<br>Vous pouvez transmettre ce lien vous-même :<br>' +
          '<code style="display:block; margin-top:6px; padding:7px 9px; background:#fff; ' +
          'border:1px solid #e2e8f0; border-radius:7px; word-break:break-all; font-size:11.5px;">' +
          esc(r.lien_secours) + '</code>', 'alerte');
      } else {
        info('✉️ Invitation envoyée à <strong>' + esc(email.trim()) + '</strong>.', 'ok');
      }
    } catch (e) { info('Envoi impossible : ' + esc(e && e.message), 'erreur'); }
  }

  async function relancer(eid) {
    try {
      var r = await window.MarfanAPI.qlibres.relancer(eid);
      await ouvrir(_ouvert.questionnaire.id);
      if (r && r.avertissement) info('Relance non partie : ' + esc(r.avertissement), 'alerte');
      else info('✉️ Relance envoyée.', 'ok');
    } catch (e) { info('Relance impossible : ' + esc(e && e.message), 'erreur'); }
  }

  async function annuler(eid) {
    if (!confirm('Annuler cette invitation ? Le lien cessera de fonctionner.')) return;
    try {
      await window.MarfanAPI.qlibres.annuler(eid);
      await ouvrir(_ouvert.questionnaire.id);
    } catch (e) { info('Annulation impossible : ' + esc(e && e.message), 'erreur'); }
  }

  async function exporter() {
    if (!_ouvert) return;
    try {
      await window.MarfanAPI.qlibres.exporter(_ouvert.questionnaire.id);
      note('⬇ Export téléchargé.', 'success');
    } catch (e) { info('Export impossible : ' + esc(e && e.message), 'erreur'); }
  }

  // ============================================================
  // Montage
  // ============================================================
  function render() {
    var hote = el('qlibresMount');
    if (!hote) return;
    if (!hote.dataset.pret) {
      hote.innerHTML =
        '<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:16px;">' +
          '<p style="flex:1; min-width:260px; margin:0; color:var(--muted); font-size:13px; line-height:1.6;">' +
            'Vos questionnaires à vous : composés librement, envoyés par courriel, ' +
            'sans lien avec les dossiers patients ni avec le SF-36 et le GPAQ.</p>' +
          '<button type="button" class="btn-gradient" id="qlNouveau">+ Nouveau questionnaire</button>' +
        '</div>' +
        '<div id="qlInfo" style="display:none;"></div>' +
        '<div id="qlContenu"></div>';
      hote.dataset.pret = '1';
      el('qlNouveau').addEventListener('click', creer);
    }
    charger();
  }

  window.QLibresUI = { render: render };
})();
