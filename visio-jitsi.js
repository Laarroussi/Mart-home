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

  let _jaas = null;       // { token, app_id, moderateur } une fois récupéré
  let _jetonErreur = null; // raison précise de l'échec, affichée à l'écran

  /** Demande au serveur un jeton d'accès signé pour l'utilisateur connecté */
  async function obtenirJeton(salle) {
    _jetonErreur = null;
    if (!window.MarfanAPI || !window.MarfanAPI.visioJaas) {
      _jetonErreur = "Le module d'accès au serveur n'est pas chargé (api-client.js).";
      return null;
    }
    try {
      const r = await window.MarfanAPI.visioJaas.token(salle);
      if (r && r.token && r.app_id) return r;
      _jetonErreur = "Le serveur a répondu sans jeton ni identifiant d'application.";
    } catch (e) {
      _jetonErreur = (e && e.message) ? e.message : 'Erreur inconnue.';
      console.warn('[visio] jeton JaaS indisponible :', _jetonErreur);
    }
    return null;
  }

  /** Dernière raison connue d'un échec de jeton (diagnostic) */
  function diagnostic() { return _jetonErreur; }

  let _api = null;
  let _salle = null;
  let _scriptCharge = false;
  let _partageActif = false;

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

  /**
   * Demande l'accès caméra et micro AVANT d'ouvrir la salle.
   *
   * Sans cette étape, la demande est faite depuis l'iframe de Jitsi : si
   * l'utilisateur a refusé une fois, le navigateur mémorise ce refus et
   * n'affiche plus aucune demande. Les boutons micro et caméra deviennent
   * alors inopérants, sans le moindre message — c'est déroutant.
   *
   * En demandant depuis la page elle-même, la permission est explicite et
   * un refus peut être expliqué clairement.
   */
  async function verifierPermissions() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Ce navigateur ne permet pas d'accéder à la caméra. Utilisez Chrome, Edge ou Safari à jour.");
    }
    let flux;
    try {
      flux = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (e) {
      // Sans caméra, on tente au moins le micro : une séance audio reste utile
      try {
        flux = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        console.warn('[visio] caméra indisponible, séance en audio seul');
      } catch (e2) {
        const nom = (e2 && e2.name) || '';
        if (nom === 'NotAllowedError' || nom === 'SecurityError') {
          throw new Error(
            "L'accès à la caméra et au micro est bloqué pour ce site.\n\n" +
            "Pour le débloquer dans Chrome : cliquez sur l'icône à gauche de l'adresse " +
            "du site (cadenas ou curseurs), puis autorisez « Caméra » et « Microphone ». " +
            "Rechargez ensuite la page.\n\n" +
            "Sur Safari : menu Safari, puis « Réglages pour ce site web »."
          );
        }
        if (nom === 'NotFoundError' || nom === 'DevicesNotFoundError') {
          throw new Error("Aucune caméra ni microphone détecté sur cet appareil.");
        }
        if (nom === 'NotReadableError') {
          throw new Error(
            "La caméra est déjà utilisée par une autre application.\n\n" +
            "Fermez Zoom, Teams, FaceTime ou tout autre logiciel de visioconférence, puis réessayez."
          );
        }
        throw new Error("Accès caméra impossible : " + (e2 && e2.message ? e2.message : nom));
      }
    }
    // On relâche immédiatement : Jitsi ouvrira ses propres flux.
    try { flux.getTracks().forEach(t => t.stop()); } catch (_) {}
    return true;
  }

  // Jonction protégée contre les appels simultanés.
  //
  // rejoindre() est asynchrone : elle attend les autorisations caméra, puis le
  // jeton du serveur. Entre ces deux attentes, plusieurs secondes s'écoulent,
  // pendant lesquelles l'écran ne montre rien. Le soignant reclique — c'est
  // normal, rien ne bouge. Or chaque appel repartait du début : le quitter()
  // de sécurité s'exécutait AVANT que la conférence précédente n'existe, et
  // les deux appels finissaient par créer chacun leur instance. _api ne
  // retenait que la dernière ; la première restait dans la salle, orpheline,
  // visible de tous et fermable par personne.
  //
  // Le 13 octobre 2026, cela a donné trois « Administrateur Marfan APA » dans
  // la même séance, aucune caméra transmise — les instances se disputaient le
  // même objectif — et un partage d'écran envoyé à une instance fantôme que
  // personne ne regardait. Un seul défaut, trois symptômes.
  let _jonctionEnCours = null;

  // ================================================================
  // Verrou entre onglets
  // ----------------------------------------------------------------
  // Le verrou précédent protège une page contre elle-même. Il ne voit pas ce
  // que fait un AUTRE onglet du même navigateur — or deux onglets qui
  // rejoignent, ce sont deux participants, et le second n'obtient pas la
  // caméra : le premier la tient déjà. C'est la moitié des vignettes en trop
  // observées le 13 octobre, et l'explication du « personne ne me voyait ».
  //
  // On pose donc une revendication dans localStorage, partagée par tous les
  // onglets du même navigateur, rafraîchie tant que la séance dure. Un onglet
  // fermé brutalement cesse de la rafraîchir : elle expire d'elle-même, et la
  // salle redevient accessible. Un verrou qui ne sait pas mourir enfermerait
  // le soignant dehors — ce serait pire que le défaut qu'il corrige.
  const CLE_VERROU = 'marfan.visio.onglet';
  const VERROU_TTL_MS = 12000;
  const ID_ONGLET = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let _battement = null;

  function lireVerrou() {
    try { return JSON.parse(localStorage.getItem(CLE_VERROU) || 'null'); } catch (_) { return null; }
  }
  function poserVerrou(salle) {
    try {
      localStorage.setItem(CLE_VERROU,
        JSON.stringify({ onglet: ID_ONGLET, salle: salle, a: Date.now() }));
    } catch (_) {}
  }
  function libererVerrou() {
    if (_battement) { clearInterval(_battement); _battement = null; }
    try {
      const v = lireVerrou();
      if (!v || v.onglet === ID_ONGLET) localStorage.removeItem(CLE_VERROU);
    } catch (_) {}
  }
  /** Renvoie la revendication d'un autre onglet encore vivant, sinon null. */
  function verrouDUnAutreOnglet() {
    const v = lireVerrou();
    if (!v || v.onglet === ID_ONGLET) return null;
    if (Date.now() - (v.a || 0) > VERROU_TTL_MS) return null;   // onglet disparu
    return v;
  }
  // Un onglet qu'on ferme rend la main immédiatement, sans attendre l'expiration.
  try { window.addEventListener('pagehide', libererVerrou); } catch (_) {}

  async function rejoindre(conteneurId, options) {
    options = options || {};

    // Deuxième clic pendant la connexion : on rend la MÊME promesse. Celui qui
    // a cliqué deux fois attend la même salle, il n'en demande pas une seconde.
    if (_jonctionEnCours) return _jonctionEnCours;

    // Un autre onglet tient déjà la salle.
    if (!options.forcer && !_api) {
      const autre = verrouDUnAutreOnglet();
      if (autre) {
        const e = new Error(
          "Une séance est déjà ouverte dans un autre onglet de ce navigateur.\n\n" +
          "Deux onglets dans la même salle, ce sont deux participants : le second " +
          "n'obtient pas la caméra, et vos patients vous voient en double sans vous voir.\n\n" +
          "Revenez à l'onglet déjà ouvert, ou fermez-le avant de reprendre ici.");
        e.code = 'AUTRE_ONGLET';
        throw e;
      }
    }

    // Déjà dans la salle demandée : il n'y a rien à faire. Repartir d'un
    // dispose/recreate couperait la séance en cours pour y revenir à
    // l'identique — avec le risque de ne pas récupérer la caméra.
    if (_api && options.salle && _salle &&
        _salle.endsWith(construireNomSalle(options.salle))) {
      return _api;
    }

    _jonctionEnCours = _rejoindreVraiment(conteneurId, options);
    try { return await _jonctionEnCours; }
    finally { _jonctionEnCours = null; }
  }

  async function _rejoindreVraiment(conteneurId, options) {
    const conteneur = document.getElementById(conteneurId);
    if (!conteneur) throw new Error('Zone d\'affichage introuvable : ' + conteneurId);

    // Autorisations d'abord : un refus ici donne un message clair,
    // plutôt que des boutons muets une fois dans la salle.
    await verifierPermissions();

    // Une seule conférence à la fois
    quitter();

    conteneur.innerHTML =
      '<div style="display:flex; align-items:center; justify-content:center; height:100%; min-height:340px; color:#94a3b8; font-size:13.5px;">' +
      'Ouverture de la salle…</div>';

    // Jeton signé par notre serveur : il désigne le modérateur et porte
    // l'identifiant stable du participant. Sans lui, on bascule sur le
    // serveur public, qui ne permettra pas d'ouvrir la salle.
    // Le nom de salle est calculé AVANT la demande de jeton : le serveur
    // restreint désormais le jeton à la salle demandée, et ne peut le faire
    // que s'il sait laquelle. Auparavant il délivrait un passe-partout.
    const salleCourte = construireNomSalle(options.salle);
    _jaas = await obtenirJeton(salleCourte);
    if (!_jaas) {
      // Auparavant on basculait ici sur meet.jit.si. C'était trompeur : le
      // serveur public exige un modérateur authentifié, la salle affichait
      // « La conférence n'a pas encore commencé » et PERSONNE — pas même le
      // soignant — ne pouvait activer sa caméra. Mieux vaut dire pourquoi.
      conteneur.innerHTML = '';
      throw new Error(
        "La visioconférence n'est pas configurée sur le serveur.\n\n" +
        "Détail : " + (_jetonErreur || 'jeton refusé') + "\n\n" +
        "Vérifiez dans le fichier .env du serveur les valeurs JAAS_APP_ID, " +
        "JAAS_KID et JAAS_PRIVATE_KEY_PATH, puis redémarrez l'application Node."
      );
    }
    DOMAINE = DOMAINE_JAAS;
    SCRIPT = 'https://' + DOMAINE + '/external_api.js';

    await chargerScript();

    // Sur JaaS, le nom de salle doit être préfixé par l'identifiant
    // d'application, faute de quoi la salle n'appartient pas au compte.
    _salle = _jaas ? (_jaas.app_id + '/' + salleCourte) : salleCourte;

    // Le rôle vient du serveur, pas de la page : un patient ne peut pas
    // se déclarer modérateur en modifiant le code de son navigateur.
    const moderateur = _jaas ? !!_jaas.moderateur : !!options.moderateur;

    conteneur.innerHTML = '';

    // L'attribut « allow » doit être présent AVANT le chargement de l'iframe :
    // appliqué après coup, il est ignoré par le navigateur. On surveille donc
    // la création de l'iframe par Jitsi pour le poser immédiatement.
    const observateur = new MutationObserver(() => {
      const cadre = conteneur.querySelector('iframe');
      if (cadre && !cadre.dataset.permsOk) {
        cadre.dataset.permsOk = '1';
        cadre.setAttribute('allow',
          'camera; microphone; display-capture; autoplay; clipboard-write; fullscreen; speaker-selection');
        cadre.setAttribute('allowfullscreen', 'true');
        observateur.disconnect();
      }
    });
    observateur.observe(conteneur, { childList: true, subtree: true });
    setTimeout(() => { try { observateur.disconnect(); } catch (_) {} }, 5000);

    // La salle nous appartient à partir d'ici : on le fait savoir aux autres
    // onglets, et on le redit régulièrement. Cesser de le redire, c'est rendre
    // la main — y compris si cet onglet disparaît sans prévenir.
    poserVerrou(salleCourte);
    if (_battement) clearInterval(_battement);
    _battement = setInterval(() => { if (_api) poserVerrou(salleCourte); }, 4000);

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
        // Personne n'arrive micro coupé. Démarrer en sourdine empêchait les
        // patients de se réactiver : le navigateur n'ayant jamais demandé
        // l'autorisation d'accès au micro, les boutons restaient sans effet.
        startWithAudioMuted: false,
        startWithVideoMuted: false,
        // Le soignant garde la main s'il souhaite couper tout le monde
        startAudioOnly: false,
        disableDeepLinking: true,
        enableWelcomePage: false,
        defaultLanguage: 'fr',
        // Le partage d'écran sert ici à diffuser une vidéo d'exercice : des
        // corps en mouvement. Jitsi se limite par défaut à 5 images par
        // seconde, ce qui convient à une présentation mais rend un mouvement
        // saccadé — impossible de suivre un geste. On monte à 30.
        desktopSharingFrameRate: { min: 15, max: 30 },
        // Ne jamais proposer de couper le son du partage : la musique et les
        // consignes de la vidéo font partie de la séance.
        disableScreensharingVirtualBackground: true,
        startScreenSharing: false
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
          // « settings » permet au patient de choisir son micro et sa caméra
          // s'il en possède plusieurs, ou si le mauvais périphérique a été
          // sélectionné par défaut — cause fréquente d'un micro qui semble muet.
          : ['microphone','camera','fullscreen','hangup','chat','raisehand','tileview','settings']
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
    ['errorOccurred', 'cameraError', 'micError', 'screenSharingStatusChanged'].forEach(ev => {
      try { _api.addListener(ev, d => console.warn('[visio] ' + ev, d)); } catch (_) {}
    });

    // Canal de commande entre le soignant et les patients.
    //
    // Jitsi transporte de courts messages texte entre participants. On s'en
    // sert pour piloter la vidéo d'entraînement : le soignant annonce quelle
    // vidéo lancer et à quelle seconde, chaque patient s'y cale. La vidéo se
    // joue alors chez lui en pleine qualité, sans passer par le partage
    // d'écran — donc sans perte d'image ni manipulation à faire en séance.
    try {
      _api.addListener('endpointTextMessageReceived', e => {
        try {
          const brut = e && e.data && e.data.eventData && e.data.eventData.text;
          if (!brut) return;
          const msg = JSON.parse(brut);
          if (!msg || msg.canal !== 'marfan-video') return;
          if (typeof options.onCommandeVideo === 'function') options.onCommandeVideo(msg);
        } catch (_) {}
      });
    } catch (_) {}

    // État réel du partage d'écran. Sans ce retour, rien à l'écran ne distingue
    // « je crois partager » de « je partage vraiment » : c'est en séance de
    // groupe la différence entre un exercice suivi et vingt patients qui
    // attendent devant une image figée.
    try {
      _api.addListener('screenSharingStatusChanged', d => {
        _partageActif = !!(d && d.on);
        if (typeof options.onPartageEcran === 'function') options.onPartageEcran(_partageActif);
      });
    } catch (_) {}

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
    // On rend la main aux autres onglets avant toute chose : si dispose()
    // échoue, le verrou ne doit pas survivre à la séance qu'il protégeait.
    libererVerrou();
    if (_api) {
      try { _api.dispose(); } catch (_) {}
      _api = null;
    }
    _salle = null;
    _partageActif = false;
  }

  /** true si un partage d'écran est effectivement diffusé aux participants */
  function partageEnCours() { return _partageActif; }

  /**
   * Envoie une commande vidéo à TOUS les participants.
   * Le destinataire vide ('') signifie « diffusion générale » pour Jitsi.
   */
  function commanderVideo(objet) {
    if (!_api) throw new Error("Aucune séance en cours. Démarrez d'abord la séance.");
    const msg = Object.assign({ canal: 'marfan-video' }, objet || {});
    _api.executeCommand('sendEndpointTextMessage', '', JSON.stringify(msg));
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
    diagnostic, partageEnCours, commanderVideo,
    get domaine() { return DOMAINE; }
  };
})();
