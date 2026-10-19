/**
 * aide-media.js — Pourquoi la caméra ou le micro ne marche pas
 * =============================================================
 *
 * Quand un patient n'arrive pas à être vu ni entendu, il y a quatre causes
 * possibles, et elles ne se corrigent pas au même endroit :
 *
 *   1. la page n'est pas ouverte dans un vrai navigateur, mais dans celui
 *      intégré à WhatsApp ou Facebook — aucun réglage ne débloquera ça ;
 *   2. le système d'exploitation interdit l'accès au navigateur lui-même
 *      (macOS, Windows, iOS) ;
 *   3. le site a été refusé une fois, et le navigateur s'en souvient ;
 *   4. le matériel est déjà pris par une autre application.
 *
 * Donner les quatre pistes à quelqu'un qui en a une seule, c'est le perdre.
 * Ce module reconnaît l'environnement et ne renvoie que les étapes qui
 * correspondent.
 *
 * Il ne devine rien sur l'état des autorisations : ça, c'est le rôle du
 * diagnostic, qui demande réellement l'accès et lit l'erreur renvoyée. Un
 * écran d'aide qui affirme « votre caméra est autorisée » sans avoir essayé
 * est la pire des aides.
 *
 * Expose window.AideMedia
 */
(function () {
  'use strict';

  /**
   * Reconnaît le navigateur, le système, et surtout les navigateurs
   * intégrés aux applications de messagerie.
   *
   * L'ordre des tests compte : Chrome sur iOS s'annonce « CriOS » tout en
   * étant un Safari déguisé, et Edge contient « Chrome » dans sa signature.
   * Tester Chrome en premier donnerait la mauvaise marche à suivre aux deux.
   */
  function environnement(ua, plateforme, tactile) {
    ua = String(ua || '');
    plateforme = String(plateforme || '');
    var iOS = /iPad|iPhone|iPod/.test(ua) ||
              (/Mac/.test(plateforme) && Number(tactile) > 1);   // iPad récent se dit « Mac »

    var inApp = null;
    if (/FBAN|FBAV|FB_IAB/.test(ua))      inApp = 'Facebook';
    else if (/Instagram/.test(ua))        inApp = 'Instagram';
    else if (/\bLine\//.test(ua))         inApp = 'LINE';
    else if (/WhatsApp/i.test(ua))        inApp = 'WhatsApp';
    else if (/; wv\)/.test(ua))           inApp = 'une application';   // WebView Android
    else if (/GSA\//.test(ua))            inApp = 'l\'application Google';

    var os = iOS ? 'iOS'
           : /Android/.test(ua) ? 'Android'
           : /Windows/.test(ua) ? 'Windows'
           : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
           : /Linux/.test(ua) ? 'Linux' : 'inconnu';

    var navigateur =
        /FxiOS/.test(ua) ? 'Firefox iOS'
      : /Firefox/.test(ua) ? 'Firefox'
      : /Edg\//.test(ua) ? 'Edge'
      : /CriOS/.test(ua) ? 'Chrome iOS'
      : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /Chrome/.test(ua) ? 'Chrome'
      : /Safari/.test(ua) ? 'Safari'
      : 'inconnu';

    return { os: os, navigateur: navigateur, iOS: iOS, inApp: inApp,
             mobile: iOS || os === 'Android' };
  }

  /**
   * Traduit l'erreur de getUserMedia en cause compréhensible.
   *
   * Les noms d'erreur du navigateur sont normalisés : s'appuyer dessus est
   * fiable, alors que lire le message — qui change d'une version à l'autre
   * et d'une langue à l'autre — ne l'est pas.
   */
  function interpreterErreur(err) {
    var nom = err && (err.name || err.code) || '';
    if (nom === 'NotAllowedError' || nom === 'PermissionDeniedError') {
      return { cause: 'refus',
               texte: 'L\'accès a été refusé — soit dans le navigateur, soit par le système.' };
    }
    if (nom === 'NotFoundError' || nom === 'DevicesNotFoundError') {
      return { cause: 'absent',
               texte: 'Aucune caméra ni micro n\'a été trouvé sur cet appareil.' };
    }
    if (nom === 'NotReadableError' || nom === 'TrackStartError') {
      return { cause: 'occupe',
               texte: 'La caméra est déjà utilisée par une autre application. ' +
                      'Fermez Zoom, Teams, FaceTime ou l\'appareil photo, puis réessayez.' };
    }
    if (nom === 'OverconstrainedError') {
      return { cause: 'reglage', texte: 'La caméra ne gère pas le réglage demandé.' };
    }
    if (nom === 'SecurityError') {
      return { cause: 'securite',
               texte: 'La page n\'est pas servie en HTTPS : le navigateur interdit la caméra.' };
    }
    if (nom === 'AbortError') {
      return { cause: 'interrompu', texte: 'La demande a été interrompue. Réessayez.' };
    }
    return { cause: 'inconnu',
             texte: 'Cause non identifiée' + (nom ? ' (' + nom + ')' : '') + '.' };
  }

  /**
   * Les étapes à suivre, et elles seules.
   *
   * Le navigateur intégré à une messagerie passe avant tout le reste : tant
   * que la page y est ouverte, aucun réglage ne sert à rien, et faire
   * chercher un réglage introuvable à quelqu'un qui attend sa séance est le
   * plus sûr moyen de le décourager.
   */
  function etapes(env) {
    env = env || environnement('');
    var blocs = [];
    var secours = null;

    if (env.inApp) {
      blocs.push({
        titre: 'Ouvrez la page dans votre navigateur',
        urgent: true,
        points: [
          'Vous avez ouvert le lien depuis ' + env.inApp + ', qui affiche les pages dans une ' +
            'fenêtre interne. Cette fenêtre n\'a pas le droit d\'utiliser la caméra.',
          env.iOS
            ? 'Touchez les trois points ou la flèche en haut à droite, puis « Ouvrir dans Safari ».'
            : 'Touchez les trois points en haut à droite, puis « Ouvrir dans Chrome » ' +
              'ou « Ouvrir dans le navigateur ».',
          'Reconnectez-vous ensuite sur la page ouverte, et rejoignez la séance depuis là.'
        ]
      });
      return { titre: 'La page est ouverte dans ' + env.inApp,
               intro: 'C\'est la cause la plus fréquente, et la plus simple à corriger.',
               blocs: blocs, secours: null };
    }

    if (env.iOS) {
      blocs.push({
        titre: 'Utilisez Safari',
        points: [
          'Sur iPhone et iPad, Safari est le navigateur qui gère le mieux la visioconférence.',
          'Si vous êtes dans Chrome ou Firefox et que rien ne marche, ouvrez la page dans Safari.'
        ]
      });
      blocs.push({
        titre: 'Réglages de l\'iPhone ou de l\'iPad',
        points: [
          'Réglages → Safari → faites défiler jusqu\'à « Réglages pour les sites web ».',
          'Appareil photo : choisissez « Demander » ou « Autoriser ».',
          'Microphone : choisissez « Demander » ou « Autoriser ».',
          'Puis Réglages → Confidentialité et sécurité → Appareil photo : vérifiez que Safari ' +
            'est activé. Faites de même pour Microphone.'
        ]
      });
      blocs.push({
        titre: 'Sur la page elle-même',
        points: [
          'Dans Safari, touchez « aA » à gauche de l\'adresse, puis « Réglages pour ce site web ».',
          'Mettez Appareil photo et Microphone sur « Autoriser ».',
          'Rechargez la page, puis rejoignez la séance.',
          'Quand la demande apparaît, touchez « Autoriser » — elle ne revient pas si vous refusez.'
        ]
      });
      blocs.push({
        titre: 'Si l\'image reste noire',
        points: [
          'Fermez les autres applications qui utilisent la caméra : FaceTime, Appareil photo, Zoom.',
          'Ne verrouillez pas l\'écran et ne changez pas d\'application pendant la séance : ' +
            'iOS coupe la caméra dès que la page n\'est plus au premier plan.'
        ]
      });
      return { titre: 'Caméra et micro sur iPhone ou iPad',
               intro: 'Trois endroits à vérifier, dans cet ordre.',
               blocs: blocs, secours: null };
    }

    if (env.navigateur === 'Firefox') {
      blocs.push({
        titre: 'Autorisez le site',
        points: [
          'Quand Firefox demande l\'accès, cliquez sur « Autoriser ».',
          'Cochez « Mémoriser cette décision » pour ne plus avoir la question.',
          'Si vous avez refusé une fois : cliquez sur le cadenas à gauche de l\'adresse, ' +
            'puis sur la croix à côté de « Bloqué » pour Caméra et Microphone.',
          'Rechargez la page (Cmd+R sur Mac, F5 sur Windows).'
        ]
      });
      return { titre: 'Caméra et micro dans Firefox',
               intro: 'Firefox demande l\'autorisation à chaque site, et retient votre réponse.',
               blocs: blocs, secours: null };
    }

    // Chrome, Edge, Opera, Safari de bureau : deux niveaux d'autorisation.
    var nav = env.navigateur === 'inconnu' ? 'votre navigateur' : env.navigateur;

    if (env.os === 'macOS') {
      blocs.push({
        titre: '1. Le Mac doit autoriser ' + nav,
        points: [
          'Menu Pomme → Réglages Système → Confidentialité et sécurité.',
          'Appareil photo : activez l\'interrupteur en face de ' + nav + '.',
          'Microphone : activez-le également.',
          'Quittez complètement ' + nav + ' (Cmd+Q) puis rouvrez-le. ' +
            'Sans cette fermeture, le réglage ne prend pas effet.'
        ]
      });
    } else if (env.os === 'Windows') {
      blocs.push({
        titre: '1. Windows doit autoriser ' + nav,
        points: [
          'Démarrer → Paramètres → Confidentialité et sécurité → Caméra.',
          'Activez « Autoriser les applications à accéder à votre caméra ».',
          'Vérifiez que ' + nav + ' est bien activé dans la liste en dessous.',
          'Faites la même chose pour le Microphone.'
        ]
      });
    }

    blocs.push({
      titre: (env.os === 'macOS' || env.os === 'Windows' ? '2. ' : '') + 'Le site doit être autorisé',
      points: [
        'Cliquez sur le cadenas (ou l\'icône de réglages) à gauche de l\'adresse du site.',
        'Caméra : choisissez « Autoriser ». Microphone : « Autoriser ».',
        'Rechargez la page, puis rejoignez la séance.',
        'Si une bannière propose de recharger, cliquez dessus : le réglage ne s\'applique ' +
          'qu\'après rechargement.'
      ]
    });

    blocs.push({
      titre: (env.os === 'macOS' || env.os === 'Windows' ? '3. ' : '') + 'Si l\'image reste noire',
      points: [
        'Fermez les autres applications qui utilisent la caméra : Zoom, Teams, FaceTime, Skype.',
        'Une seule application à la fois peut l\'utiliser.'
      ]
    });

    if (env.navigateur !== 'Firefox') {
      secours = 'Si rien n\'y fait, installez Firefox et ouvrez la séance dedans. ' +
                'Firefox gère les autorisations autrement, et débloque la plupart des cas ' +
                'où ' + nav + ' reste muet. C\'est le navigateur utilisé par votre soignant.';
    }

    return { titre: 'Caméra et micro dans ' + nav,
             intro: 'Il y a deux autorisations différentes : celle du système, et celle du site. ' +
                    'Les deux sont nécessaires.',
             blocs: blocs, secours: secours };
  }

  window.AideMedia = {
    environnement: environnement,
    interpreterErreur: interpreterErreur,
    etapes: etapes
  };
})();
