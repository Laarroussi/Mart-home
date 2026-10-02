/**
 * pieces-ui.js — Dépôt de documents par le patient, relecture par le soignant
 * ===========================================================================
 *
 *   monterDepot(id)      → carte de dépôt dans l'espace patient
 *   monterFile(id)       → file d'attente « À valider » côté investigateur
 *
 * Deux interfaces, deux registres de langage.
 *
 * Côté patient, on ne montre jamais ce que la lecture automatique a extrait.
 * Ce sont des données cliniques non vérifiées : les lui restituer
 * reviendrait à lui livrer une interprétation automatique de son propre
 * dossier, avec le risque qu'il la prenne pour un résultat. On confirme la
 * réception, on indique où en est le traitement, rien de plus.
 *
 * Côté soignant, tout est montré : chaque fait extrait, son extrait source,
 * son indice de confiance. Il coche ce qu'il retient.
 */
(function () {
  'use strict';

  var TAILLE_MAX_MO = 10;

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function note(m, t) { if (typeof window.toast === 'function') window.toast(m, t || 'info', 6000); }

  function versBase64(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result || '');
        var i = s.indexOf(',');
        res(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.onerror = function () { rej(new Error('Lecture du fichier impossible')); };
      fr.readAsDataURL(file);
    });
  }

  // ============================================================
  // CÔTÉ PATIENT — dépôt
  // ============================================================
  function monterDepot(conteneurId) {
    var hote = el(conteneurId);
    if (!hote) return;

    hote.innerHTML =
    '<article class="pat-card" style="margin-bottom:14px;">' +
      '<h3>📎 Transmettre un document à mon référent</h3>' +
      '<p>Compte rendu de consultation, échocardiographie, épreuve d\'effort, courrier… ' +
         'Votre référent le relira et l\'ajoutera à votre dossier.</p>' +
      '<div style="margin-top:12px;">' +
        '<label class="control-label" for="pcCommentaire">Un mot pour votre référent (facultatif)</label>' +
        '<textarea id="pcCommentaire" rows="2" placeholder="Ex. : échographie faite au CHU le 12 mars"' +
          ' style="width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:9px; font-family:inherit; font-size:13px; box-sizing:border-box;"></textarea>' +
      '</div>' +
      '<input type="file" id="pcFichier" style="display:none" ' +
        'accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.txt,.docx,application/pdf,image/*">' +
      '<div style="display:flex; gap:9px; flex-wrap:wrap; margin-top:12px;">' +
        '<button type="button" class="pat-btn" id="pcChoisir">📎 Choisir un document</button>' +
      '</div>' +
      '<div id="pcEtat" style="display:none; margin-top:12px;"></div>' +
      '<p style="margin:12px 0 0; font-size:11.5px; color:#647873; line-height:1.55;">' +
        'Formats acceptés : PDF, photo, texte. Taille maximale ' + TAILLE_MAX_MO + ' Mo. ' +
        'Vérifiez que le document vous concerne bien avant de l\'envoyer.' +
      '</p>' +
      '<div id="pcListe" style="margin-top:14px;"></div>' +
    '</article>';

    var inp = el('pcFichier');
    el('pcChoisir').addEventListener('click', function () { inp.click(); });
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      inp.value = '';
      if (f) envoyer(f);
    });

    chargerListe();
  }

  function etat(html, ton) {
    var z = el('pcEtat');
    if (!z) return;
    var c = ton === 'err' ? ['#fef2f2', '#fecaca', '#991b1b']
          : ton === 'ok'  ? ['#ecfdf5', '#a7f3d0', '#065f46']
                          : ['#f0f9ff', '#bae6fd', '#0369a1'];
    z.style.cssText = 'display:block; margin-top:12px; padding:11px 14px; border-radius:10px; ' +
      'font-size:12.5px; line-height:1.55; background:' + c[0] + '; border:1px solid ' + c[1] + '; color:' + c[2] + ';';
    z.innerHTML = html;
  }

  async function envoyer(f) {
    if (f.size > TAILLE_MAX_MO * 1024 * 1024) {
      etat('Ce document fait ' + Math.round(f.size / 1048576) + ' Mo, la limite est de ' +
           TAILLE_MAX_MO + ' Mo. Réduisez-le ou photographiez-le en qualité moindre.', 'err');
      return;
    }
    etat('Envoi et lecture du document en cours… cela peut prendre quelques secondes.', null);
    try {
      var b64 = await versBase64(f);
      var r = await window.MarfanAPI.pieces.deposer({
        fichier_base64: b64,
        mime: f.type || 'application/pdf',
        nom: f.name,
        commentaire: (el('pcCommentaire') || {}).value || ''
      });
      etat('✅ ' + esc(r.message || 'Document bien reçu.'), 'ok');
      if (el('pcCommentaire')) el('pcCommentaire').value = '';
      note('📎 Document transmis à votre référent.', 'success');
      chargerListe();
    } catch (e) {
      etat('Envoi impossible : ' + esc((e && e.message) || 'erreur inconnue') +
           '<br>Réessayez, ou signalez-le à votre référent.', 'err');
    }
  }

  async function chargerListe() {
    var z = el('pcListe');
    if (!z) return;
    try {
      var r = await window.MarfanAPI.pieces.mesPieces();
      var l = (r && r.pieces) || [];
      if (!l.length) { z.innerHTML = ''; return; }
      var COULEURS = { validee: '#16a34a', en_attente: '#0891b2', rejetee: '#b45309', erreur: '#b45309' };
      z.innerHTML =
        '<div style="font-size:11.5px; font-weight:800; color:#647873; text-transform:uppercase; letter-spacing:.4px; margin-bottom:7px;">Documents transmis</div>' +
        l.map(function (p) {
          var d = p.deposee_le ? new Date(p.deposee_le).toLocaleDateString('fr-FR') : '';
          return '<div style="display:flex; align-items:center; gap:10px; padding:8px 0; border-top:1px solid #e6efed; font-size:12.5px;">' +
            '<span style="flex:1; min-width:0;">' +
              '<strong style="display:block; color:#163533;">' + esc(p.nom_fichier || 'Document') + '</strong>' +
              '<span style="color:#647873; font-size:11.5px;">' + esc(d) + '</span>' +
            '</span>' +
            '<span style="color:' + (COULEURS[p.statut] || '#647873') + '; font-weight:700; font-size:11.5px; text-align:right;">' +
              esc(p.statut_libelle || p.statut) + '</span>' +
          '</div>';
        }).join('');
    } catch (_) { z.innerHTML = ''; }
  }

  // ============================================================
  // CÔTÉ SOIGNANT — file d'attente
  // ============================================================
  async function monterFile(conteneurId) {
    var hote = el(conteneurId);
    if (!hote) return;
    var l = [];
    try {
      var r = await window.MarfanAPI.pieces.aValider();
      l = (r && r.pieces) || [];
    } catch (e) { hote.innerHTML = ''; return; }

    if (!l.length) { hote.innerHTML = ''; return; }

    hote.innerHTML =
    '<article class="card" style="padding:0; overflow:hidden; margin-bottom:16px; border:1px solid #fcd34d;">' +
      '<div style="padding:14px 18px; background:linear-gradient(135deg,#f59e0b,#f97316); color:white;">' +
        '<h3 style="margin:0; color:white; font-size:15px;">📥 Documents transmis par les participants — ' + l.length + ' à relire</h3>' +
        '<p style="margin:3px 0 0; font-size:12px; opacity:.95;">Aucune de ces données n\'est encore dans la base. Vous décidez de ce qui y entre.</p>' +
      '</div>' +
      '<div style="padding:12px 18px;">' +
        l.map(function (p) {
          var d = p.deposee_le ? new Date(p.deposee_le).toLocaleDateString('fr-FR') : '';
          var qui = (p.prenom || p.nom) ? (esc(p.prenom || '') + ' ' + esc(p.nom || '')).trim() : p.patient_id;
          var souci = p.statut === 'erreur';
          return '<div style="display:flex; align-items:center; gap:12px; padding:10px 0; border-top:1px solid #eef2f7; flex-wrap:wrap;">' +
            '<span style="flex:1; min-width:200px;">' +
              '<strong style="font-size:13px; color:#0b1530;">' + esc(qui) + '</strong>' +
              '<span style="color:#64748b; font-size:11.5px;"> · ' + esc(p.patient_id) + ' · ' + esc(d) + '</span><br>' +
              '<span style="font-size:12px; color:#475569;">' + esc(p.nom_fichier || 'Document') +
                (souci ? ' <span style="color:#b45309; font-weight:700;">· lecture automatique impossible</span>'
                       : ' · <strong>' + (p.nb_faits || 0) + '</strong> donnée(s) lue(s)') + '</span>' +
              (p.commentaire ? '<br><span style="font-size:11.5px; color:#64748b; font-style:italic;">« ' + esc(p.commentaire) + ' »</span>' : '') +
            '</span>' +
            '<button class="btn-light" data-piece="' + p.id + '" style="font-weight:700; white-space:nowrap;">Relire</button>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</article>';

    hote.querySelectorAll('[data-piece]').forEach(function (b) {
      b.addEventListener('click', function () { ouvrirRelecture(b.dataset.piece, conteneurId); });
    });
  }

  async function ouvrirRelecture(id, conteneurId) {
    var piece;
    try {
      var r = await window.MarfanAPI.pieces.detail(id);
      piece = r && r.piece;
    } catch (e) { note('Pièce illisible : ' + ((e && e.message) || ''), 'error'); return; }
    if (!piece) return;

    var analyse = piece.analyse || {};
    var faits = analyse.faits || [];

    var lignes = faits.length
      ? faits.map(function (f, i) {
          var faible = f.confiance != null && f.confiance < 0.7;
          var val = f.value_num != null ? (f.value_num + ' ' + (f.unit || '')) : (f.value_text || '');
          var d = f.event_date ? new Date(f.event_date).toLocaleDateString('fr-FR') : '—';
          return '<tr' + (faible ? ' style="background:#fffbeb;"' : '') + '>' +
            '<td style="padding:5px 8px;"><input type="checkbox" data-fait="' + i + '"' +
              (faible ? '' : ' checked') + ' style="width:16px; height:16px;"></td>' +
            '<td style="padding:5px 8px; white-space:nowrap; color:#64748b; font-size:11.5px;">' + d + '</td>' +
            '<td style="padding:5px 8px; font-size:11.5px; color:#94a3b8;">' + esc(f.category || '') + '</td>' +
            '<td style="padding:5px 8px; font-size:12px;">' + esc(f.label || '') + '</td>' +
            '<td style="padding:5px 8px; font-weight:700; white-space:nowrap; font-size:12px;">' + esc(val.trim()) + '</td>' +
          '</tr>';
        }).join('')
      : '';

    var vieux = el('pieceModal'); if (vieux) vieux.remove();
    document.body.insertAdjacentHTML('beforeend',
      '<div id="pieceModal" style="position:fixed; inset:0; background:rgba(11,21,48,.84); z-index:10096; display:flex; align-items:center; justify-content:center; padding:18px;">' +
        '<div style="background:white; border-radius:16px; width:860px; max-width:96vw; max-height:92vh; display:flex; flex-direction:column; box-shadow:0 26px 70px rgba(0,0,0,.35);">' +
          '<div style="padding:16px 22px; background:linear-gradient(135deg,#f59e0b,#f97316); color:white; border-radius:16px 16px 0 0;">' +
            '<h3 style="margin:0; color:white; font-size:16px;">📥 ' + esc(piece.nom_fichier || 'Document') + '</h3>' +
            '<p style="margin:3px 0 0; font-size:12px; opacity:.95;">Transmis par ' + esc(piece.patient_id) +
              ' · ' + (piece.deposee_le ? new Date(piece.deposee_le).toLocaleString('fr-FR') : '') + '</p>' +
          '</div>' +
          '<div style="padding:16px 22px; overflow-y:auto; flex:1;">' +
            (piece.commentaire
              ? '<div style="padding:10px 13px; background:#f0f9ff; border:1px solid #bae6fd; border-radius:9px; margin-bottom:14px; font-size:12.5px; color:#0369a1;">' +
                '<strong>Mot du participant :</strong> ' + esc(piece.commentaire) + '</div>' : '') +
            (piece.erreur_lecture
              ? '<div style="padding:10px 13px; background:#fef2f2; border:1px solid #fecaca; border-radius:9px; margin-bottom:14px; font-size:12.5px; color:#991b1b;">' +
                esc(piece.erreur_lecture) + '</div>' : '') +
            '<div style="padding:10px 13px; background:#fffbeb; border:1px solid #fde68a; border-left:4px solid #f59e0b; border-radius:9px; margin-bottom:14px; font-size:12.5px; color:#92400e; line-height:1.55;">' +
              '<strong>Vérifiez d\'abord que ce document concerne bien ce participant.</strong> ' +
              'Un compte rendu déposé par erreur — celui d\'un proche, par exemple — deviendrait une donnée d\'étude.' +
            '</div>' +
            (lignes
              ? '<div style="max-height:320px; overflow:auto; border:1px solid #e2e8f0; border-radius:9px;">' +
                  '<table style="width:100%; border-collapse:collapse;">' +
                  '<thead><tr style="background:#f8fafc;">' +
                    '<th style="padding:7px 8px; width:34px;"></th>' +
                    ['Date', 'Type', 'Donnée', 'Valeur'].map(function (h) {
                      return '<th style="padding:7px 8px; text-align:left; font-size:11.5px; font-weight:800; color:#475569;">' + h + '</th>';
                    }).join('') +
                  '</tr></thead><tbody>' + lignes + '</tbody></table></div>' +
                '<p style="margin:7px 0 0; font-size:11.5px; color:#92400e;">Les lignes sur fond jaune ont une confiance faible : décochées par défaut.</p>'
              : '<p style="font-size:12.5px; color:#64748b;">Aucune donnée exploitable n\'a été extraite de ce document.</p>') +
            (piece.texte_source
              ? '<details style="margin-top:12px;"><summary style="cursor:pointer; font-size:12px; font-weight:700; color:#475569;">📄 Texte lu dans le document</summary>' +
                '<div style="margin-top:8px; max-height:220px; overflow:auto; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:11px 13px; font-size:11.5px; line-height:1.7; white-space:pre-wrap; color:#334155;">' +
                esc(piece.texte_source) + '</div></details>' : '') +
          '</div>' +
          '<div style="padding:14px 22px; border-top:1px solid #e2e8f0; display:flex; gap:9px; justify-content:space-between; flex-wrap:wrap;">' +
            '<button class="btn-light" id="pieceRejeter" style="background:#fef2f2; color:#991b1b; border-color:#fecaca;">✖ Écarter ce document</button>' +
            '<span style="display:flex; gap:9px;">' +
              '<button class="btn-light" id="pieceFermer">Plus tard</button>' +
              '<button class="btn-gradient" id="pieceValider"' + (lignes ? '' : ' disabled') + '>✓ Intégrer au dossier</button>' +
            '</span>' +
          '</div>' +
        '</div>' +
      '</div>');

    var fermer = function () { var m = el('pieceModal'); if (m) m.remove(); };
    el('pieceFermer').addEventListener('click', fermer);

    el('pieceRejeter').addEventListener('click', async function () {
      var motif = prompt("Pourquoi écarter ce document ?\n\nLe participant a fait une démarche : le dossier doit garder trace de la raison.");
      if (motif == null) return;
      if (motif.trim().length < 5) { note('Motif trop court.', 'error'); return; }
      try {
        await window.MarfanAPI.pieces.rejeter(piece.id, motif.trim());
        note('Document écarté.', 'info');
        fermer();
        monterFile(conteneurId);
      } catch (e) { note('Rejet impossible : ' + ((e && e.message) || ''), 'error'); }
    });

    el('pieceValider').addEventListener('click', async function () {
      var retenus = [];
      document.querySelectorAll('#pieceModal [data-fait]').forEach(function (c) {
        if (c.checked) retenus.push(faits[Number(c.dataset.fait)]);
      });
      if (!retenus.length) { note('Aucune donnée cochée.', 'error'); return; }
      this.disabled = true; this.textContent = 'Intégration…';
      try {
        var r = await window.MarfanAPI.pieces.valider(piece.id, { faits: retenus });
        note('✓ ' + r.enregistres + ' donnée(s) intégrée(s) au dossier.', 'success');
        fermer();
        monterFile(conteneurId);
        try { if (typeof window.loadPatientsFromApi === 'function') await window.loadPatientsFromApi(); } catch (_) {}
      } catch (e) {
        note('Intégration impossible : ' + ((e && e.message) || ''), 'error');
        this.disabled = false; this.textContent = '✓ Intégrer au dossier';
      }
    });
  }

  window.PiecesUI = { monterDepot: monterDepot, monterFile: monterFile };
})();
