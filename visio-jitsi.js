/**
 * visio-jitsi.js — Visioconférence réelle via Jitsi Meet
 * ======================================================
 * Expose window.VisioJitsi :
 *   rejoindre(conteneurId, options)  → ouvre la salle et affiche la vidéo
 *   quitter()                        → ferme proprement la conférence
 *   nomSalle()                       → nom de la salle courante
 *   estActif()                       → true si une conférence est en cours
 *
 * options = {
 *   salle       : nom de la salle (identique pour tous les participants)
 *   nomAffiche  : nom montré aux autres participants
 *   moderateur  : true pour le soignant (barre d'outils complète)
 *   onRejoint   : callback quand on entre dans la salle
 *   onParticipants : callback(nombre) à chaque arrivée ou départ
 *   onQuitte    : callback à la sortie
 * }
 *
 * ⚠ Instance publique meet.jit.si : les flux transitent par les serveurs
 * de Jitsi. Convient aux tests et démonstrations, PAS à des consultations
 * avec de vrais patients — cela supposerait une instance auto-hébergée.
 * ====================================================== */

(function () {
  'use strict';

  // Service utilisé : Jitsi as a Service (8x8.vc).
  //
  // Le serveur public meet.jit.si exige un modérateur authentifié pour
  // ouvrir une salle : sans compte, la conférence ne démarrait jamais.
  // JaaS résout cela — c'est notre serveur qui délivre un jeton signé
  // désignant le soignant comme modérateur.
  //
  // Repli : si la visioconférence n'est pas configurée côté serveur, on
  // retombe sur meet.jit.si pour ne pas casser la page.
  const DOMAINE_JAAS = window.MARFAN_JITSI_DOMAIN || '8x8.vc';
  const DOMAINE_LIBRE = 'meet.jit.si';
  let DOMAINE = DOMAINE_JAAS;
  let SCRIPT = 'https://' + DOMAINE + '/external_api.js';

  let _jaas = null;     // { token, app_id, moderateur } une fois récupéré

  /** Demande au serveur un jeton d'accès signé pour l'utilisateur connecté */
  async function obtenirJeton() {
    if (!window.MarfanAPI || !window.MarfanAPI.visioJaas) return null;
    try {
      const r = await window.MarfanAPI.visioJaas.token();
      if (r && r.token && r.app_id) return r;
    } catch (e) {
      console.warn('[visio] jeton JaaS indisponible :', e && e.message);
    }
    return null;
  }

  let _api = null;
  let _salle = null;
  let _scriptCharge = false;

  /** Charge la bibliothèque Jitsi à la demande, une seule fois */
  function chargerScript() {
    if (_scriptCharge && window.JitsiMeetExternalAPI) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (window.JitsiMeetExternalAPI) { _scriptCharge = true; return resolve(); }
      const s = document.createElement('script');
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => { _scriptCharge = true; resolve(); };
      s.onerror = () => reject(new Error(
        "Impossible de charger la visioconférence depuis " + DOMAINE +
        ". Vérifiez votre connexion, ou qu'aucun bloqueur n'empêche l'accès."));
      document.head.appendChild(s);
    });
  }

  /**
   * Construit un nom de salle stable et difficile à deviner.
   * Tous les participants d'une même séance doivent obtenir le même.
   */
  function construireNomSalle(cle) {
    const base = 'MarfanAPA-' + String(cle || 'general')
      .replace(/[^a-zA-Z0-9-]/g, '')
      .slice(0, 40);
    return base;
  }

  async function rejoindre(conteneurId, options) {
    options = options || {};
    const conteneur = document.getElementById(conteneurId);
    if (!conteneur) throw new Error('Zone d\'affichage introuvable : ' + conteneurId);

    // Une seule conférence à la fois
    quitter();

    conteneur.innerHTML =
      '<div style="display:flex; align-items:center; justify-content:center; height:100%; min-height:340px; color:#94a3b8; font-size:13.5px;">' +
      'Ouverture de la salle…</div>';

    // Jeton signé par notre serveur : il désigne le modérateur et porte
    // l'identifiant stable du participant. Sans lui, on bascule sur le
    // serveur public, qui ne permettra pas d'ouvrir la salle.
    _jaas = await obtenirJeton();
    if (_jaas) {
      DOMAINE = DOMAINE_JAAS;
    } else {
      DOMAINE = DOMAINE_LIBRE;
      console.warn('[visio] Aucun jeton : repli sur ' + DOMAINE_LIBRE +
                   ' (la salle risque de rester en attente de modérateur).');
    }
    SCRIPT = 'https://' + DOMAINE + '/external_api.js';

    await chargerScript();

    const salleCourte = construireNomSalle(options.salle);
    // Sur JaaS, le nom de salle doit être préfixé par l'identifiant
    // d'application, faute de quoi la salle n'appartient pas au compte.
    _salle = _jaas ? (_jaas.app_id + '/' + salleCourte) : salleCourte;

    // Le rôle vient du serveur, pas de la page : un patient ne peut pas
    // se déclarer modérateur en modifiant le code de son navigateur.
    const moderateur = _jaas ? !!_jaas.moderateur : !!options.moderateur;

    conteneur.innerHTML = '';
    _api = new window.JitsiMeetExternalAPI(DOMAINE, {
      roomName: _salle,
      jwt: _jaas ? _jaas.token : undefined,
      parentNode: conteneur,
      width: '100%',
      height: '100%',
      userInfo: { displayName: options.nomAffiche || (moderateur ? 'Soignant' : 'Patient') },
      configOverwrite: {
        // Entrée directe : le soignant ouvre la salle, il n'a pas à demander
        // l'autorisation d'y entrer ; les patients y entrent de même sans
        // étape intermédiaire. Associé à un nom de salle unique, cela évite
        // la salle d'attente qu'imposait une salle occupée par un inconnu.
        prejoinPageEnabled: false,
        prejoinConfig: { enabled: false },
        // Aucune salle d'attente ni mot de passe : la confidentialité repose
        // sur le caractère non devinable du nom de salle.
        lobby: { enabled: false, autoKnock: false },
        enableLobbyChat: false,
        requireDisplayName: false,
        startWithAudioMuted: !moderateur, // le patient arrive micro coupé
        startWithVideoMuted: false,
        disableDeepLinking: true,
        enableWelcomePage: false,
        defaultLanguage: 'fr'
      },
      interfaceConfigOverwrite: {
        DEFAULT_BACKGROUND: '#020617',
        SHOW_JITSI_WATERMARK: false,
        SHOW_BRAND_WATERMARK: false,
        DISABLE_JOIN_LEAVE_NOTIFICATIONS: false,
        MOBILE_APP_PROMO: false,
        // « sharedvideo » permet de diffuser une vidéo YouTube à tous les
        // participants, synchronisée, tout en continuant à se voir et à
        // s'entendre. C'est ce qui réunit la séance d'entraînement et la
        // visioconférence en un seul écran.
        TOOLBAR_BUTTONS: moderateur
          ? ['microphone','camera','desktop','sharedvideo','fullscreen','hangup',
             'chat','raisehand','tileview','settings','videoquality','filmstrip']
          : ['microphone','camera','fullscreen','hangup','chat','raisehand','tileview']
      }
    });

    // Une iframe n'a PAS accès à la caméra par défaut : sans cet attribut,
    // la conférence se charge mais reste noire, sans image ni son.
    try {
      const cadre = _api.getIFrame ? _api.getIFrame() : conteneur.querySelector('iframe');
      if (cadre) {
        cadre.setAttribute('allow',
          'camera; microphone; display-capture; autoplay; clipboard-write; fullscreen; speaker-selection');
        cadre.setAttribute('allowfullscreen', 'true');
        cadre.style.width = '100%';
        cadre.style.height = '100%';
        cadre.style.minHeight = '460px';
        cadre.style.border = '0';
      }
    } catch (e) { console.warn('[visio] permissions iframe :', e && e.message); }

    // Nombre de participants, transmis à l'interface appelante
    let rejoint = false;
    const compter = () => {
      try {
        const n = _api.getNumberOfParticipants();
        if (typeof options.onParticipants === 'function') options.onParticipants(n);
      } catch (_) {}
    };
    _api.addListener('videoConferenceJoined', () => {
      rejoint = true;
      compter();
      if (typeof options.onRejoint === 'function') options.onRejoint(_salle);
    });
    // Remonte les erreurs de la conférence plutôt que de laisser un écran noir
    ['errorOccurred', 'cameraError', 'micError'].forEach(ev => {
      try { _api.addListener(ev, d => console.warn('[visio] ' + ev, d)); } catch (_) {}
    });

    // Filet de sécurité : si rien ne s'affiche au bout de 45 secondes,
    // on propose d'ouvrir la salle dans un onglet séparé — certaines
    // instances Jitsi refusent purement et simplement l'intégration.
    // Le délai est large : l'écran de pré-connexion attend une action
    // de l'utilisateur, il ne faut pas le prendre pour une panne.
    setTimeout(() => {
      if (rejoint || !_api) return;
      const lien = 'https://' + DOMAINE + '/' + _salle;
      const alerte = document.createElement('div');
      alerte.style.cssText = 'position:absolute; inset:0; background:rgba(2,6,23,.96); color:white; display:flex; align-items:center; justify-content:center; text-align:center; padding:26px; z-index:5;';
      alerte.innerHTML =
        '<div style="max-width:460px;">' +
        '<div style="font-size:40px; margin-bottom:10px;">🎥</div>' +
        '<strong style="font-size:17px; display:block; margin-bottom:8px;">La vidéo ne s\'affiche pas ici</strong>' +
        '<p style="color:#cbd5e1; font-size:13px; line-height:1.55; margin:0 0 16px;">' +
        'Cette salle refuse d\'être intégrée dans la page. Ouvrez-la dans un onglet séparé : ' +
        'la visioconférence fonctionnera normalement.</p>' +
        '<a href="' + lien + '" target="_blank" rel="noopener" ' +
        'style="display:inline-block; padding:12px 24px; background:linear-gradient(135deg,#0891b2,#06b6d4); color:white; text-decoration:none; border-radius:10px; font-weight:700; font-size:14px;">' +
        'Ouvrir la salle dans un onglet</a>' +
        '<p style="color:#64748b; font-size:11.5px; margin-top:12px; word-break:break-all;">' + lien + '</p>' +
        '</div>';
      if (getComputedStyle(conteneur).position === 'static') conteneur.style.position = 'relative';
      conteneur.appendChild(alerte);
    }, 45000);
    _api.addListener('participantJoined', compter);
    _api.addListener('participantLeft', compter);
    _api.addListener('videoConferenceLeft', () => {
      if (typeof options.onQuitte === 'function') options.onQuitte();
      quitter();
    });

    return _salle;
  }

  function quitter() {
    if (_api) {
      try { _api.dispose(); } catch (_) {}
      _api = null;
    }
    _salle = null;
  }

  function nomSalle() { return _salle; }
  function estActif() { return !!_api; }

  /**
   * Noms affichés des participants présents dans la salle.
   * Les patients rejoignent sous leur code d'étude (MRF-XXX) : cette liste
   * permet donc de n'afficher le monitoring que des patients réellement
   * connectés, et non de toutes les séances ouvertes en base.
   */
  function participants() {
    if (!_api) return [];
    try {
      const infos = _api.getParticipantsInfo() || [];
      return infos.map(p => (p.displayName || p.formattedDisplayName || '').trim()).filter(Boolean);
    } catch (_) { return []; }
  }

  /**
   * Diffuse une vidéo YouTube à tous les participants, en gardant la
   * visioconférence active : le soignant reste visible et audible pendant
   * que la vidéo d'entraînement se joue, de façon synchronisée pour tous.
   */
  function partagerVideo(url) {
    if (!_api) throw new Error("Aucune séance en cours. Démarrez d'abord la séance.");
    // Jitsi refuse de lancer une vidéo si une autre est déjà diffusée.
    // On arrête donc la précédente puis on lance la nouvelle : le soignant
    // enchaîne les exercices d'un simple clic, sans manipulation préalable.
    try { _api.executeCommand('stopShareVideo'); } catch (_) {}
    setTimeout(() => {
      try { _api.executeCommand('startShareVideo', url); }
      catch (e) { console.warn('[visio] partage vidéo :', e && e.message); }
    }, 400);
  }
  function arreterPartageVideo() {
    if (!_api) return;
    try { _api.executeCommand('stopShareVideo'); } catch (_) {}
  }
  /** Partage l'écran (utile pour un support autre qu'une vidéo YouTube) */
  function partagerEcran() {
    if (!_api) throw new Error("Aucune séance en cours.");
    _api.executeCommand('toggleShareScreen');
  }

  /**
   * Vue mosaïque : tous les participants côte à côte, à taille égale.
   * Indispensable pendant un exercice — le soignant doit voir ses patients
   * travailler, et non la seule vidéo de démonstration en plein écran.
   */
  function vueMosaique(actif) {
    if (!_api) throw new Error("Aucune séance en cours.");
    _api.executeCommand('setTileView', actif !== false);
  }

  /** Lien à transmettre à un participant qui ne passe pas par la plateforme */
  function lienSalle(cle) {
    return 'https://' + DOMAINE + '/' + construireNomSalle(cle);
  }

  window.VisioJitsi = {
    rejoindre, quitter, nomSalle, estActif, lienSalle, construireNomSalle,
    partagerVideo, arreterPartageVideo, partagerEcran, participants, vueMosaique,
    get domaine() { return DOMAINE; }
  };
})();
