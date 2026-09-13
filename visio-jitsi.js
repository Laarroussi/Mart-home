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

  // Instance Jitsi utilisée.
  //
  // meet.jit.si impose désormais qu'un compte authentifié ouvre la salle :
  // sans cela, tous les participants restent bloqués sur « Demander à
  // rejoindre une réunion ». On utilise donc une instance publique libre
  // d'accès. meet.ffmuc.net est opérée par Freifunk München (Allemagne),
  // sans compte requis — et hébergée dans l'Union européenne.
  //
  // Pour en changer, définir window.MARFAN_JITSI_DOMAIN avant le chargement.
  const DOMAINE = window.MARFAN_JITSI_DOMAIN || 'meet.ffmuc.net';
  const SCRIPT = 'https://' + DOMAINE + '/external_api.js';

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

    await chargerScript();

    _salle = construireNomSalle(options.salle);
    const moderateur = !!options.moderateur;

    conteneur.innerHTML = '';
    _api = new window.JitsiMeetExternalAPI(DOMAINE, {
      roomName: _salle,
      parentNode: conteneur,
      width: '100%',
      height: '100%',
      userInfo: { displayName: options.nomAffiche || (moderateur ? 'Soignant' : 'Patient') },
      configOverwrite: {
        // Jitsi a changé de clé de configuration au fil des versions :
        // on fournit les deux pour être sûr de sauter l'écran d'attente,
        // qui faisait croire que la connexion ne s'établissait pas.
        prejoinPageEnabled: false,
        prejoinConfig: { enabled: false },
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
        TOOLBAR_BUTTONS: moderateur
          ? ['microphone','camera','desktop','fullscreen','hangup','chat',
             'raisehand','tileview','settings','videoquality','filmstrip']
          : ['microphone','camera','fullscreen','hangup','chat','raisehand','tileview']
      }
    });

    // Nombre de participants, transmis à l'interface appelante
    const compter = () => {
      try {
        const n = _api.getNumberOfParticipants();
        if (typeof options.onParticipants === 'function') options.onParticipants(n);
      } catch (_) {}
    };
    _api.addListener('videoConferenceJoined', () => {
      compter();
      if (typeof options.onRejoint === 'function') options.onRejoint(_salle);
    });
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

  /** Lien à transmettre à un participant qui ne passe pas par la plateforme */
  function lienSalle(cle) {
    return 'https://' + DOMAINE + '/' + construireNomSalle(cle);
  }

  window.VisioJitsi = { rejoindre, quitter, nomSalle, estActif, lienSalle, construireNomSalle, DOMAINE };
})();
