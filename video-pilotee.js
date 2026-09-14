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

  /**
   * Construit la scène.
   * En mode plein cadre (patient), le lecteur occupe toute la hauteur
   * disponible ; sinon il garde les proportions 16/9 dans la page.
   */
  function scene(conteneurId) {
    var hote = document.getElementById(conteneurId);
    if (!hote) throw new Error("Zone d'affichage introuvable : " + conteneurId);
    var plein = hote.dataset && hote.dataset.plein === '1';
    if (plein) { hote.style.display = 'flex'; hote.style.flexDirection = 'column'; }
    hote.innerHTML =
      '<div id="vpBarre" style="flex:0 0 auto; display:flex; align-items:center; gap:10px; padding:9px 14px; background:#0b1530; color:white;">' +
        '<span style="width:9px; height:9px; border-radius:50%; background:#f43f5e;"></span>' +
        '<strong id="vpTitre" style="font-size:13px; font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></strong>' +
        '<button id="vpSon" style="display:none; border:none; background:#f59e0b; color:#0b1530; font-weight:800; font-size:12px; padding:6px 13px; border-radius:8px; cursor:pointer;">🔊 Activer le son</button>' +
        '<span id="vpEtat" style="margin-left:auto; font-size:11px; color:#94a3b8; white-space:nowrap;"></span>' +
        // Le patient doit toujours pouvoir revenir à son espace : on ne
        // l'enferme pas dans la vidéo, même pendant une séance encadrée.
        (plein ? '<button id="vpReduire" style="border:1px solid rgba(255,255,255,.25); background:transparent; color:#cbd5e1; font-size:11.5px; padding:6px 12px; border-radius:8px; cursor:pointer;">Réduire</button>' : '') +
      '</div>' +
      (plein
        ? '<div id="vpLecteur" style="flex:1; min-height:0; width:100%; background:#000;"></div>'
        : '<div id="vpLecteur" style="width:100%; aspect-ratio:16/9; background:#000;"></div>');
    var bs = document.getElementById('vpSon');
    if (bs) bs.addEventListener('click', activerSon);
    var br = document.getElementById('vpReduire');
    if (br) br.addEventListener('click', function () {
      hote.style.display = 'none';
      document.body.style.overflow = '';
      // La vidéo continue de tourner : le patient peut revenir sans décalage.
      window.dispatchEvent(new CustomEvent('marfan-video-reduite'));
    });
    return document.getElementById('vpLecteur');
  }

  /**
   * Rétablit le son après un démarrage en sourdine.
   *
   * Les navigateurs refusent de lancer seuls une vidéo qui a du son : c'est
   * ce blocage qui obligeait le patient à cliquer sur Lecture. On démarre
   * donc en sourdine — toujours autorisé — puis on rend le son aussitôt.
   * Si le navigateur s'y oppose encore, un bouton apparaît : un seul clic,
   * et la vidéo continue sans s'interrompre.
   */
  function activerSon() {
    if (!_lecteur) return;
    try {
      _lecteur.unMute();
      _lecteur.setVolume(100);
    } catch (_) {}
    var b = document.getElementById('vpSon');
    if (!b) return;
    setTimeout(function () {
      var muet = true;
      try { muet = _lecteur.isMuted(); } catch (_) {}
      b.style.display = muet ? 'inline-block' : 'none';
    }, 250);
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
      var patient = _role === 'patient';
      _lecteur = new window.YT.Player('vpLecteur', {
        videoId: videoId,
        playerVars: {
          rel: 0, playsinline: 1, iv_load_policy: 3, fs: 0,
          modestbranding: 1, controls: patient ? 0 : 1,
          disablekb: patient ? 1 : 0,
          // autoplay + démarrage en sourdine : la seule combinaison que les
          // navigateurs laissent partir sans clic. Le son revient juste après.
          autoplay: autoPlay ? 1 : 0,
          mute: patient && autoPlay ? 1 : 0,
          start: Math.max(0, Math.floor(demarrerA || 0))
        },
        events: {
          onReady: function (ev) {
            try {
              if (patient && autoPlay) { try { ev.target.mute(); } catch (_) {} }
              ev.target.seekTo(demarrerA || 0, true);
              if (autoPlay) ev.target.playVideo();
            } catch (_) {}
            // Le son est rendu dès que la lecture est effectivement partie.
            if (patient && autoPlay) setTimeout(activerSon, 700);
            resolve(ev.target);
          },
          onStateChange: function (ev) {
            // 1 = en lecture. Nouvelle tentative de rétablir le son, au cas
            // où la première est arrivée trop tôt.
            if (patient && ev && ev.data === 1) setTimeout(activerSon, 200);
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
