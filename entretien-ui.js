/**
 * entretien-ui.js — Entretien patient : enregistrement et transcription
 * =====================================================================
 *
 * Le clinicien appuie sur « Enregistrer », mène son entretien normalement,
 * puis arrête. L'enregistrement part au serveur, qui le transcrit et en
 * extrait les éléments utiles : difficultés, attentes, objectifs,
 * précautions, antécédents, traitements. Le clinicien relit, corrige, et
 * applique — les champs du dossier se remplissent alors d'eux-mêmes.
 *
 * Deux choix méritent d'être explicités.
 *
 * L'audio ne quitte le navigateur qu'une fois, pour la transcription, et
 * n'est jamais conservé. La voix est une donnée biométrique ; le texte
 * suffit à tout ce qu'on veut en faire.
 *
 * Rien n'est appliqué automatiquement. Une transcription automatique
 * comporte des erreurs de reconnaissance, et l'extraction qui en découle
 * peut se tromper. Le clinicien voit la transcription intégrale à côté de
 * ce qui en a été tiré, coche ce qu'il retient, puis applique.
 *
 * Expose window.EntretienUI = { monter, estEnCours }
 */
(function () {
  'use strict';

  var _flux = null;        // MediaStream en cours
  var _enregistreur = null; // MediaRecorder
  var _morceaux = [];
  var _debut = 0;
  var _minuterie = null;
  var _hote = null;
  var _options = {};

  // Au-delà, le fichier dépasse la limite d'envoi et la transcription coûte
  // cher pour peu de gain : un entretien d'inclusion dure rarement plus.
  var DUREE_MAX_S = 25 * 60;

  var CHAMPS = [
    { cle: 'difficultes',      titre: 'Difficultés ressenties',  cible: 'cf_difficultes' },
    { cle: 'attentes_patient', titre: 'Attentes du patient',     cible: 'cf_objectifsPatient' },
    { cle: 'objectifs',        titre: 'Objectifs de prise en charge', cible: 'cf_objectifsClinicien' },
    { cle: 'precautions',      titre: 'Précautions et alertes',  cible: 'cf_incidents' },
    { cle: 'profession',       titre: 'Profession / situation',  cible: 'cf_profession' },
    { cle: 'antecedents',      titre: 'Antécédents évoqués',     cible: 'cf_history' },
    { cle: 'traitements',      titre: 'Traitements évoqués',     cible: 'cf_treatments' },
    { cle: 'activite_actuelle', titre: 'Activité physique actuelle', cible: null },
    { cle: 'resume',           titre: "Résumé de l'entretien",   cible: null }
  ];

  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function note(m, t) { if (typeof window.toast === 'function') window.toast(m, t || 'info', 6000); }

  function mmss(s) {
    s = Math.max(0, Math.floor(s));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function dire(html, ton) {
    var z = el('entInfo');
    if (!z) return;
    if (!html) { z.style.display = 'none'; return; }
    var c = { ok: ['#ecfdf5', '#a7f3d0', '#065f46'], err: ['#fef2f2', '#fecaca', '#991b1b'],
              alerte: ['#fffbeb', '#fde68a', '#92400e'], neutre: ['#f8fafc', '#e2e8f0', '#475569'] }[ton || 'neutre'];
    z.style.cssText = 'display:block; margin-top:12px; padding:11px 14px; border-radius:10px; ' +
      'font-size:12.5px; line-height:1.55; background:' + c[0] + '; border:1px solid ' + c[1] + '; color:' + c[2] + ';';
    z.innerHTML = html;
  }

  /** Format d'enregistrement réellement accepté par ce navigateur */
  function formatSupporte() {
    var candidats = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < candidats.length; i++) {
      if (MediaRecorder.isTypeSupported(candidats[i])) return candidats[i];
    }
    return '';
  }

  function gabarit() {
    return '' +
    '<div style="border:1px solid #fed7aa; background:linear-gradient(180deg,#fffbeb,#fff7ed); border-radius:14px; padding:16px 18px;">' +
      '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:6px;">' +
        '<strong style="font-size:14.5px; color:#0b1530;">🎙 Entretien patient</strong>' +
        '<span id="entChrono" style="display:none; font-variant-numeric:tabular-nums; font-weight:800; font-size:14px; color:#b91c1c;">0:00</span>' +
        '<span id="entPastille" style="display:none; width:10px; height:10px; border-radius:50%; background:#dc2626;"></span>' +
        '<div style="margin-left:auto; display:flex; gap:8px; flex-wrap:wrap;">' +
          '<button type="button" id="entRecBtn" class="btn-secondary" style="font-weight:700;">⏺ Démarrer l\'enregistrement</button>' +
          '<button type="button" id="entFileBtn" class="btn-light">📁 Importer un fichier audio</button>' +
          '<input type="file" id="entFile" accept="audio/*,.mp3,.m4a,.wav,.ogg,.opus,.webm,.aac,.flac" style="display:none">' +
        '</div>' +
      '</div>' +
      '<p style="margin:0; font-size:12.5px; color:#92400e; line-height:1.55;">' +
        'Menez l\'entretien normalement. À l\'arrêt, l\'enregistrement est transcrit et les éléments utiles ' +
        'sont extraits pour remplir le dossier. <b>Le son n\'est pas conservé</b>, seul le texte l\'est.' +
      '</p>' +
      '<p style="margin:6px 0 0; font-size:11.5px; color:#b45309;">' +
        '⚖️ Prévenez le patient et recueillez son accord avant d\'enregistrer : sa voix est une donnée personnelle.' +
      '</p>' +
      '<div id="entInfo" style="display:none;"></div>' +
      '<div id="entResultat" style="display:none; margin-top:14px;"></div>' +
    '</div>';
  }

  // ============================================================
  // Enregistrement
  // ============================================================
  async function demarrer() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      dire("Ce navigateur ne permet pas d'enregistrer le son. Utilisez Chrome, Edge ou Safari à jour.", 'err');
      return;
    }
    var type = formatSupporte();
    if (!window.MediaRecorder) {
      dire("Ce navigateur ne sait pas enregistrer de son. Vous pouvez importer un fichier audio à la place.", 'err');
      return;
    }
    try {
      _flux = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });
    } catch (e) {
      var n = (e && e.name) || '';
      if (n === 'NotAllowedError' || n === 'SecurityError') {
        dire("L'accès au microphone est refusé pour ce site.<br>Cliquez sur l'icône à gauche de l'adresse, " +
             "autorisez « Microphone », puis rechargez la page.", 'err');
      } else if (n === 'NotFoundError') {
        dire("Aucun microphone détecté sur cet appareil.", 'err');
      } else if (n === 'NotReadableError') {
        dire("Le microphone est déjà utilisé par une autre application. Fermez-la, puis réessayez.", 'err');
      } else {
        dire("Micro indisponible : " + esc(e && e.message ? e.message : n), 'err');
      }
      return;
    }

    _morceaux = [];
    try {
      _enregistreur = type ? new MediaRecorder(_flux, { mimeType: type }) : new MediaRecorder(_flux);
    } catch (e) {
      dire("Enregistrement impossible sur ce navigateur : " + esc(e.message), 'err');
      libererFlux();
      return;
    }
    _enregistreur.ondataavailable = function (ev) { if (ev.data && ev.data.size) _morceaux.push(ev.data); };
    _enregistreur.onstop = terminer;
    _enregistreur.start(1000);
    _debut = Date.now();

    var b = el('entRecBtn');
    if (b) { b.textContent = '⏹ Arrêter et transcrire'; b.classList.add('btn-danger'); }
    var f = el('entFileBtn'); if (f) f.style.display = 'none';
    if (el('entChrono')) el('entChrono').style.display = 'inline';
    if (el('entPastille')) el('entPastille').style.display = 'inline-block';
    dire("Enregistrement en cours. Parlez normalement — la qualité du micro intégré suffit.", 'alerte');

    _minuterie = setInterval(function () {
      var s = (Date.now() - _debut) / 1000;
      if (el('entChrono')) el('entChrono').textContent = mmss(s);
      if (el('entPastille')) el('entPastille').style.opacity = (Math.floor(s) % 2) ? '0.25' : '1';
      if (s >= DUREE_MAX_S) {
        note("Durée maximale atteinte (25 minutes) — arrêt automatique.", 'info');
        arreter();
      }
    }, 500);
  }

  function arreter() {
    if (_enregistreur && _enregistreur.state !== 'inactive') _enregistreur.stop();
  }

  function libererFlux() {
    if (_minuterie) { clearInterval(_minuterie); _minuterie = null; }
    if (_flux) { try { _flux.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {} _flux = null; }
    var b = el('entRecBtn');
    if (b) { b.textContent = "⏺ Démarrer l'enregistrement"; b.classList.remove('btn-danger'); b.disabled = false; }
    var f = el('entFileBtn'); if (f) f.style.display = '';
    if (el('entChrono')) el('entChrono').style.display = 'none';
    if (el('entPastille')) el('entPastille').style.display = 'none';
  }

  async function terminer() {
    var duree = Math.round((Date.now() - _debut) / 1000);
    var type = (_enregistreur && _enregistreur.mimeType) || 'audio/webm';
    var blob = new Blob(_morceaux, { type: type });
    _morceaux = [];
    libererFlux();

    if (duree < 5 || blob.size < 2000) {
      dire("Enregistrement trop court pour être exploité. Reprenez l'entretien.", 'err');
      return;
    }
    await envoyer(blob, type, 'entretien.' + (type.indexOf('mp4') >= 0 ? 'm4a' : 'webm'), duree, 'enregistrement');
  }

  /** Envoie au serveur : transcription puis extraction */
  async function envoyer(blob, mime, nom, duree, source) {
    if (blob.size > 12 * 1024 * 1024) {
      dire("Enregistrement trop volumineux (" + Math.round(blob.size / 1048576) + " Mo). " +
           "Limite : 12 Mo. Découpez-le en plusieurs parties.", 'err');
      return;
    }
    var b = el('entRecBtn'); if (b) b.disabled = true;
    dire("Transcription en cours… comptez environ une minute pour dix minutes d'entretien.", 'neutre');

    var base64;
    try {
      base64 = await new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () {
          var s = String(fr.result || '');
          var i = s.indexOf(',');
          res(i >= 0 ? s.slice(i + 1) : s);
        };
        fr.onerror = function () { rej(new Error("Lecture de l'enregistrement impossible")); };
        fr.readAsDataURL(blob);
      });
    } catch (e) { dire(esc(e.message), 'err'); if (b) b.disabled = false; return; }

    try {
      var r = await window.MarfanAPI.entretien.transcrire(
        _options.patientId || null,
        { audio_base64: base64, mime: mime, nom: nom, duree_s: duree, source: source });
      afficherResultat(r);
      dire("<strong>Entretien transcrit.</strong> Relisez ce qui en a été tiré, décochez ce que vous " +
           "ne retenez pas, puis appliquez.", 'ok');
    } catch (e) {
      dire("Transcription impossible : " + esc((e && e.message) || 'erreur inconnue'), 'err');
    } finally {
      if (b) b.disabled = false;
    }
  }

  // ============================================================
  // Relecture et application
  // ============================================================
  function afficherResultat(r) {
    var zone = el('entResultat');
    if (!zone) return;
    var champs = r.champs || {};

    var lignes = CHAMPS.filter(function (c) { return (champs[c.cle] || '').trim(); }).map(function (c) {
      return '<div style="margin-bottom:12px; background:white; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px;">' +
        '<label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;">' +
          '<input type="checkbox" data-ent="' + c.cle + '" checked style="width:16px; height:16px;">' +
          '<strong style="font-size:12.5px; color:#0b1530;">' + esc(c.titre) + '</strong>' +
          (c.cible ? '' : '<span style="font-size:10.5px; color:#94a3b8;">— pour la synthèse uniquement</span>') +
        '</label>' +
        '<textarea data-enttxt="' + c.cle + '" rows="3" style="width:100%; padding:8px 10px; border:1px solid #cbd5e1; ' +
          'border-radius:8px; font-family:inherit; font-size:12.5px; line-height:1.6; resize:vertical; box-sizing:border-box;">' +
          esc(champs[c.cle]) + '</textarea>' +
      '</div>';
    }).join('');

    if (!lignes) {
      zone.style.display = 'block';
      zone.innerHTML = '<div style="padding:14px; background:white; border:1px solid #e2e8f0; border-radius:10px; ' +
        'font-size:12.5px; color:#64748b;">La transcription n\'a pas permis d\'identifier d\'élément exploitable. ' +
        'Le texte intégral reste consultable ci-dessous.</div>' + blocTranscription(r);
      return;
    }

    var alerte = (champs.points_a_verifier || '').trim()
      ? '<div style="background:#fffbeb; border:1px solid #fde68a; border-left:4px solid #f59e0b; border-radius:9px; ' +
        'padding:10px 13px; margin-bottom:12px; font-size:12.5px; color:#92400e; line-height:1.55;">' +
        '<strong style="display:block; margin-bottom:3px;">À vérifier avant de retenir</strong>' +
        esc(champs.points_a_verifier).replace(/\n/g, '<br>') + '</div>'
      : '';

    zone.style.display = 'block';
    zone.innerHTML = alerte + lignes + blocTranscription(r) +
      '<div style="display:flex; gap:9px; justify-content:flex-end; margin-top:12px;">' +
        '<button type="button" class="btn-light" id="entIgnorer">Ignorer</button>' +
        '<button type="button" class="btn-gradient" id="entAppliquer">✓ Appliquer au dossier</button>' +
      '</div>';

    var ig = el('entIgnorer');
    if (ig) ig.addEventListener('click', function () { zone.style.display = 'none'; zone.innerHTML = ''; dire('', null); });
    var ap = el('entAppliquer');
    if (ap) ap.addEventListener('click', function () { appliquer(r); });
  }

  function blocTranscription(r) {
    var t = (r.transcription || '').trim();
    if (!t) return '';
    return '<details style="margin-top:10px;">' +
      '<summary style="cursor:pointer; font-size:12px; font-weight:700; color:#475569;">' +
        '📝 Transcription intégrale (' + t.split(/\s+/).length + ' mots)</summary>' +
      '<div style="margin-top:8px; max-height:240px; overflow-y:auto; background:white; border:1px solid #e2e8f0; ' +
        'border-radius:8px; padding:11px 13px; font-size:12px; line-height:1.7; color:#334155; white-space:pre-wrap;">' +
        esc(t) + '</div>' +
      '<p style="margin:6px 0 0; font-size:11px; color:#94a3b8;">Conservée au dossier : elle permet de vérifier ' +
        'ce qui a été retenu.</p></details>';
  }

  /** Reporte les champs cochés dans le formulaire, sans jamais écraser en silence */
  function appliquer(r) {
    var retenus = {};
    document.querySelectorAll('#entResultat [data-ent]').forEach(function (c) {
      if (!c.checked) return;
      var t = document.querySelector('#entResultat [data-enttxt="' + c.dataset.ent + '"]');
      var v = t ? t.value.trim() : '';
      if (v) retenus[c.dataset.ent] = v;
    });
    if (!Object.keys(retenus).length) { dire("Rien de coché : aucun élément reporté.", 'alerte'); return; }

    var poses = [], ignores = [];
    CHAMPS.forEach(function (c) {
      if (!c.cible || !retenus[c.cle]) return;
      var champ = el(c.cible);
      if (!champ) return;
      if (champ.value && champ.value.trim()) {
        // On complète plutôt que de remplacer : ce que le clinicien avait
        // déjà écrit lui appartient.
        champ.value = champ.value.trim() + '\n\n' + retenus[c.cle];
        ignores.push(c.titre);
      } else {
        champ.value = retenus[c.cle];
        poses.push(c.titre);
      }
    });

    // Le résumé et la transcription alimentent la synthèse.
    var bilan = [retenus.resume, retenus.activite_actuelle].filter(Boolean).join('\n\n');
    var cibleBilan = el('syn_bilan_entretien') || el('cf_notes');
    if (bilan && cibleBilan) {
      cibleBilan.value = (cibleBilan.value ? cibleBilan.value.trim() + '\n\n' : '') + bilan;
    }

    window._derniereTranscription = r.transcription || '';

    var msg = '<strong>Éléments reportés au dossier.</strong>';
    if (poses.length)   msg += '<br>Champs remplis : ' + esc(poses.join(', ')) + '.';
    if (ignores.length) msg += '<br>Champs déjà remplis, texte ajouté à la suite : ' + esc(ignores.join(', ')) + '.';
    msg += '<br>Vous pouvez maintenant cliquer sur « Rédiger la synthèse ».';
    dire(msg, 'ok');
    note('✓ Entretien reporté au dossier.', 'success');

    var zone = el('entResultat');
    if (zone) { zone.style.display = 'none'; zone.innerHTML = ''; }
  }

  // ============================================================
  // Montage
  // ============================================================
  function monter(conteneurId, options) {
    _hote = el(conteneurId);
    if (!_hote) return;
    _options = options || {};
    _hote.innerHTML = gabarit();

    var b = el('entRecBtn');
    if (b) b.addEventListener('click', function () {
      if (_enregistreur && _enregistreur.state === 'recording') arreter();
      else demarrer();
    });
    var fb = el('entFileBtn'), fi = el('entFile');
    if (fb && fi) {
      fb.addEventListener('click', function () { fi.click(); });
      fi.addEventListener('change', async function () {
        var f = fi.files && fi.files[0];
        fi.value = '';
        if (!f) return;
        await envoyer(f, f.type || 'audio/mpeg', f.name, null, 'fichier');
      });
    }
  }

  function estEnCours() { return !!(_enregistreur && _enregistreur.state === 'recording'); }

  window.EntretienUI = { monter: monter, estEnCours: estEnCours };
})();
