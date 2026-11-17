/**
 * installation.js — Installer la plateforme comme une application
 * ================================================================
 *
 * ── Ce que l'installation règle, et ce qu'elle ne règle pas ─────────────
 * ELLE RÈGLE le chemin d'accès. Le patient lance depuis une icône au lieu
 * de cliquer un lien reçu dans WhatsApp. Or c'est ce lien qui ouvre le
 * navigateur interne de la messagerie, lequel n'a pas le droit d'utiliser
 * la caméra. C'est la panne la plus fréquente, et l'icône la supprime.
 *
 * ELLE NE RÈGLE PAS les autorisations. Une application installée depuis
 * Chrome tourne dans Chrome : macOS et Windows continuent de voir Chrome, et
 * l'autorisation caméra du système reste à donner une fois. Le dire ici
 * plutôt que de laisser croire le contraire évite la déception du patient
 * qui installe l'application en pensant que tout est réglé.
 *
 * ── Qui peut installer quoi ─────────────────────────────────────────────
 * Chrome et Edge (ordinateur et Android) proposent une vraie installation en
 * un clic. Firefox pour ordinateur ne le permet plus du tout. Safari sur
 * iPhone et iPad passe par « Partager → Sur l'écran d'accueil », geste
 * manuel qu'aucun site ne peut déclencher. Les instructions renvoyées
 * tiennent compte de ces trois mondes.
 *
 * Expose window.Installation
 */
(function () {
  'use strict';

  var _invite = null;        // l'événement beforeinstallprompt, mis de côté
  var _ecoutes = [];

  function prevenir() { _ecoutes.forEach(function (f) { try { f(etat()); } catch (_) {} }); }

  // Chrome n'émet cet événement qu'une fois, et seulement si le site est
  // installable. On le capture dès le chargement : attendre que l'utilisateur
  // clique pour l'écouter, c'est l'avoir déjà manqué.
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      _invite = e;
      prevenir();
    });
    window.addEventListener('appinstalled', function () {
      _invite = null;
      prevenir();
    });
  }

  /** L'application tourne-t-elle déjà en fenêtre autonome ? */
  function estInstallee() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.navigator && window.navigator.standalone === true) return true;   // iOS
    } catch (_) {}
    return false;
  }

  function env() {
    if (window.AideMedia && window.AideMedia.environnement) {
      return window.AideMedia.environnement(
        navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
    }
    return { os: 'inconnu', navigateur: 'inconnu', iOS: false, inApp: null, mobile: false };
  }

  function etat() {
    var e = env();
    return {
      installee: estInstallee(),
      invitePrete: !!_invite,
      os: e.os, navigateur: e.navigateur, iOS: e.iOS, inApp: e.inApp
    };
  }

  function surChangement(f) { if (typeof f === 'function') _ecoutes.push(f); }

  /**
   * Déclenche l'installation si le navigateur l'a proposée.
   * Résout avec 'acceptee', 'refusee' ou 'indisponible' — jamais en silence :
   * un bouton qui ne fait rien et ne dit rien est pire que pas de bouton.
   */
  function installer() {
    if (!_invite) return Promise.resolve('indisponible');
    var p = _invite;
    _invite = null;
    try {
      p.prompt();
      return p.userChoice
        .then(function (r) { prevenir(); return r && r.outcome === 'accepted' ? 'acceptee' : 'refusee'; })
        .catch(function () { prevenir(); return 'indisponible'; });
    } catch (_) {
      prevenir();
      return Promise.resolve('indisponible');
    }
  }

  /**
   * Les gestes à faire, selon l'appareil. Un seul chemin à la fois.
   */
  function instructions(e) {
    e = e || env();

    if (e.inApp) {
      return {
        titre: 'Ouvrez d\'abord la page dans votre navigateur',
        possible: false,
        etapes: [
          'Cette page est affichée par ' + e.inApp + ', qui ne permet ni l\'installation ni la caméra.',
          e.iOS ? 'Touchez le menu en haut à droite, puis « Ouvrir dans Safari ».'
                : 'Touchez le menu en haut à droite, puis « Ouvrir dans Chrome ».',
          'Reprenez l\'installation depuis la page ainsi ouverte.'
        ]
      };
    }

    if (e.iOS) {
      return {
        titre: 'Ajouter à l\'écran d\'accueil',
        possible: true, manuel: true,
        etapes: [
          'Dans Safari, touchez le bouton Partager (le carré avec une flèche vers le haut).',
          'Faites défiler, puis touchez « Sur l\'écran d\'accueil ».',
          'Touchez « Ajouter » en haut à droite.',
          'Une icône Marfan APA apparaît sur votre écran. Lancez la séance depuis elle.'
        ],
        note: 'Sur iPhone et iPad, seul Safari sait ajouter une application à l\'écran d\'accueil. ' +
              'Depuis Chrome, le bouton Partager ne propose pas cette option.'
      };
    }

    if (e.navigateur === 'Firefox') {
      return {
        titre: 'Firefox ne sait pas installer les applications web',
        possible: false,
        etapes: [
          'Firefox pour ordinateur a retiré cette fonction : il n\'y a rien à installer.',
          'Ce n\'est pas gênant — Firefox gère bien la caméra et le micro, c\'est le ' +
            'navigateur conseillé quand Chrome refuse.',
          'Pour retrouver la séance facilement, ajoutez la page aux marque-pages : Cmd+D ou Ctrl+D.'
        ]
      };
    }

    if (e.navigateur === 'Chrome' || e.navigateur === 'Edge' || e.navigateur === 'Opera') {
      return {
        titre: 'Installer l\'application',
        possible: true,
        etapes: [
          'Cliquez sur le bouton « Installer » ci-dessus.',
          'S\'il ne répond pas : cherchez l\'icône d\'installation (un écran avec une flèche) ' +
            'à droite de l\'adresse du site, et cliquez dessus.',
          'Sinon, menu ⋮ en haut à droite → « Installer Marfan APA… » ' +
            '(ou « Applications » → « Installer ce site »).',
          'L\'application s\'ouvre alors dans sa propre fenêtre, et une icône est ajoutée ' +
            (e.os === 'macOS' ? 'au Launchpad et au Dock.' :
             e.os === 'Windows' ? 'au menu Démarrer et au bureau.' : 'à votre écran d\'accueil.')
        ]
      };
    }

    if (e.navigateur === 'Safari' && !e.iOS) {
      return {
        titre: 'Ajouter au Dock',
        possible: true, manuel: true,
        etapes: [
          'Dans Safari, menu Fichier → « Ajouter au Dock… » (macOS Sonoma ou plus récent).',
          'Validez : l\'icône Marfan APA s\'ajoute à votre Dock.',
          'Si cette option n\'existe pas, votre version de macOS est trop ancienne — ' +
            'utilisez Chrome, ou gardez simplement un marque-page.'
        ]
      };
    }

    return {
      titre: 'Installation non proposée par ce navigateur',
      possible: false,
      etapes: [
        'Ce navigateur ne propose pas d\'installer les sites comme des applications.',
        'Ouvrez la page dans Chrome ou Edge pour en profiter, ou gardez un marque-page.'
      ]
    };
  }

  /**
   * Enregistre le service worker, sans lequel Chrome ne propose pas
   * l'installation. Il ne met rien de l'application en cache — voir sw.js.
   */
  function demarrer() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
    // Chemin relatif : le site peut être servi depuis un sous-dossier.
    navigator.serviceWorker.register('sw.js').catch(function (e) {
      console.warn('[pwa] service worker non enregistré :', e && e.message);
    });
  }

  window.Installation = {
    etat: etat, estInstallee: estInstallee, installer: installer,
    instructions: instructions, surChangement: surChangement, demarrer: demarrer
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', demarrer);
  } else {
    demarrer();
  }
})();
