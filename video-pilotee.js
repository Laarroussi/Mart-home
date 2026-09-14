/**
 * video-pilotee.js — Diffusion pilotée de la vidéo d'entraînement
 * ===============================================================
 *
 * Le soignant clique une vidéo ; elle démarre chez tous les patients, en
 * pleine qualité, à la même seconde.
 *
 * Pourquoi pas le partage d'écran : il oblige à une manipulation dans Chrome
 * au début de chaque séance, recompresse l'image, et relègue la vidéo au rang
 * de vignette parmi les autres participants. Ici, chaque patient lit la vidéo
 * depuis sa propre connexion : qualité intacte, aucune bande passante prise
 * au soignant, et la vidéo occupe la place principale de son écran.
 *
 * Synchronisation : le soignant annonce la position de sa lecture toutes les
 * trois secondes. Un patient qui s'écarte de plus d'une seconde et demie se
 * recale seul. Un patient qui rejoint en retard se cale immédiatement.
 *
 * Expose window.VideoPilotee :
 *   preparer()                    → charge l'API YouTube (une seule fois)
 *   diffuser(id, titre)           → (soignant) lance la vidéo pour tous
 *   arreter()                     → (soignant) arrête la diffusion
 *   recevoir(msg)                 → (patient) applique une commande reçue
 *   estEnCours()                  → true si une diffusion est active
 */
(function () {
  'use strict';

  var ECART_TOLERE_S = 1.5;   // au-delà, le patient se recale
  var PERIODE_SYNC_MS = 3000; // fréquence d'annonce de la position

  var _apiPrete = null;   // Promise de chargement de l'API YouTube
  var _lecteur = null;    // instance YT.Player
  var _minuterie = null;  // intervalle d'annonce (soignant)
  var _videoId = null;
  var _titre = '';
  var _role = null;       // 'soignant' ou 'patient'

  /** Charge l'API IFrame de YouTube, une seule fois pour toute la page */
  function preparer() {
    if (_apiPrete) return _apiPrete;
    _apiPrete = new Promise(function (resolve, reject) {
      if (window.YT && window.YT.Player) return resolve();
      var precedent = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = function () {
        if (typeof precedent === 'function') { try { precedent(); } catch (_) {} }
        resolve();
      };
      var s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = function () { reject(new Error("Impossible de charger le lecteur vidéo.")); };
      document.head.appendChild(s);
      // Filet : si l'API ne se signale pas, on n'attend pas indéfiniment.
      setTimeout(function () {
        if (window.YT && window.YT.Player) resolve();
        else reject(new Error("Le lecteur vidéo n'a pas répondu. Vérifiez votre connexion."));
      }, 12000);
    });
    return _apiPrete;
  }

  /** Construit la scène : un lecteur occupant toute la largeur disponible */
  function scene(conteneurId) {
    var hote = document.getElementById(conteneurId);
    if (!hote) throw new Error("Zone d'affichage introuvable : " + conteneurId);
    hote.innerHTML =
      '<div id="vpBarre" style="display:flex; align-items:center; gap:10px; padding:9px 14px; background:#0b1530; color:white;">' +
        '<span style="width:9px; height:9px; border-radius:50%; background:#f43f5e;"></span>' +
        '<strong id="vpTitre" style="font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></strong>' +
        '<span id="vpEtat" style="margin-left:auto; font-size:11px; color:#94a3b8; white-space:nowrap;"></span>' +
      '</div>' +
      '<div id="vpLecteur" style="width:100%; aspect-ratio:16/9; background:#000;"></div>';
    return document.getElementById('vpLecteur');
  }

  function majEtat(texte) {
    var e = document.getElementById('vpEtat');
    if (e) e.textContent = texte || '';
  }

  /** Crée (ou remplace) le lecteur sur une vidéo donnée */
  function creerLecteur(conteneurId, videoId, demarrerA, autoPlay) {
    scene(conteneurId);
    var t = document.getElementById('vpTitre');
    if (t) t.textContent = _titre || "Vidéo d'entraînement";
    return new Promise(function (resolve) {
      if (_lecteur) { try { _lecteur.destroy(); } catch (_) {} _lecteur = null; }
      _lecteur = new window.YT.Player('vpLecteur', {
        videoId: videoId,
        playerVars: {
          rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0,
          modestbranding: 1, controls: _role === 'soignant' ? 1 : 0,
          disablekb: _role === 'soignant' ? 0 : 1,
          start: Math.max(0, Math.floor(demarrerA || 0))
        },
        events: {
          onReady: function (ev) {
            try {
              ev.target.seekTo(demarrerA || 0, true);
              if (autoPlay) ev.target.playVideo();
            } catch (_) {}
            resolve(ev.target);
          }
        }
      });
    });
  }

  // ============================================================
  // CÔTÉ SOIGNANT
  // ============================================================
  async function diffuser(conteneurId, videoId, titre) {
    if (!window.VisioJitsi || !window.VisioJitsi.estActif()) {
      throw new Error("Démarrez d'abord la séance : la vidéo est envoyée aux patients par la salle.");
    }
    _role = 'soignant';
    _videoId = videoId;
    _titre = titre || '';
    await preparer();
    await creerLecteur(conteneurId, videoId, 0, true);

    window.VisioJitsi.commanderVideo({ action: 'lancer', videoId: videoId, titre: _titre, position: 0 });
    majEtat('Diffusée à tous les patients');

    if (_minuterie) clearInterval(_minuterie);
    _minuterie = setInterval(function () {
      if (!_lecteur || !window.VisioJitsi || !window.VisioJitsi.estActif()) return;
      var p = 0, enLecture = false;
      try {
        p = _lecteur.getCurrentTime() || 0;
        enLecture = _lecteur.getPlayerState() === 1;
      } catch (_) { return; }
      try {
        window.VisioJitsi.commanderVideo({
          action: enLecture ? 'sync' : 'pause',
          videoId: _videoId, position: p
        });
      } catch (_) {}
      majEtat(enLecture ? 'Diffusée · ' + formater(p) : 'En pause · ' + formater(p));
    }, PERIODE_SYNC_MS);
  }

  function arreter() {
    if (_minuterie) { clearInterval(_minuterie); _minuterie = null; }
    try {
      if (window.VisioJitsi && window.VisioJitsi.estActif()) {
        window.VisioJitsi.commanderVideo({ action: 'arreter' });
      }
    } catch (_) {}
    detruire();
  }

  function detruire() {
    if (_minuterie) { clearInterval(_minuterie); _minuterie = null; }
    if (_lecteur) { try { _lecteur.destroy(); } catch (_) {} _lecteur = null; }
    _videoId = null;
  }

  // ============================================================
  // CÔTÉ PATIENT
  // ============================================================
  /**
   * Applique une commande reçue du soignant.
   * conteneurId : la zone où afficher la vidéo chez le patient.
   */
  async function recevoir(msg, conteneurId, surAffichage) {
    if (!msg) return;
    _role = 'patient';

    if (msg.action === 'arreter') {
      detruire();
      if (typeof surAffichage === 'function') surAffichage(false);
      return;
    }
    if (!msg.videoId) return;

    // Première commande, ou changement de vidéo : on (re)construit le lecteur.
    if (!_lecteur || _videoId !== msg.videoId) {
      _videoId = msg.videoId;
      _titre = msg.titre || _titre;
      if (typeof surAffichage === 'function') surAffichage(true);
      await preparer();
      await creerLecteur(conteneurId, msg.videoId, msg.position || 0, true);
      majEtat('Séance en cours');
      return;
    }

    // Vidéo déjà en place : on se contente de corriger le décalage.
    try {
      if (msg.action === 'pause') { _lecteur.pauseVideo(); majEtat('En pause'); return; }
      var local = _lecteur.getCurrentTime() || 0;
      var ecart = Math.abs(local - (msg.position || 0));
      if (ecart > ECART_TOLERE_S) _lecteur.seekTo(msg.position || 0, true);
      if (_lecteur.getPlayerState() !== 1) _lecteur.playVideo();
      majEtat('Séance en cours');
    } catch (_) {}
  }

  function formater(s) {
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function estEnCours() { return !!_lecteur; }

  window.VideoPilotee = {
    preparer: preparer,
    diffuser: diffuser,
    arreter: arreter,
    recevoir: recevoir,
    estEnCours: estEnCours
  };
})();
