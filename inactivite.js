/* ============================================================
   DÉCONNEXION AUTOMATIQUE APRÈS INACTIVITÉ
   ------------------------------------------------------------
   Un poste laissé ouvert sur un dossier patient est le risque le plus banal
   et le plus fréquent : personne n'a besoin de forcer quoi que ce soit, il
   suffit de passer derrière la chaise. Au bout d'une heure sans la moindre
   action, la session se ferme et le jeton est effacé.

   Deux précautions valent d'être expliquées.

   D'abord l'avertissement. Déconnecter sans prévenir fait perdre une saisie
   en cours, et l'utilisateur apprend vite à contourner la mesure — il garde
   un onglet qu'il « réveille » toutes les cinquante minutes. Deux minutes
   avant l'échéance, une fenêtre propose donc de rester connecté.

   Ensuite le partage entre onglets. L'activité est écrite dans le stockage
   local : travailler dans un onglet maintient la session de tous les autres.
   Sans cela, un second onglet ouvert en arrière-plan se déconnectait seul et
   emportait la session commune.

   Limite à connaître : ce minuteur vit dans le navigateur. Il efface le
   jeton du poste, ce qui est l'essentiel contre un accès opportuniste, mais
   un jeton déjà copié ailleurs resterait valable jusqu'à son échéance
   propre. La protection côté serveur est la durée de vie du jeton.
   ============================================================ */
(function () {
  'use strict';

  var DELAI_MS   = 60 * 60 * 1000;   // une heure sans activité
  var AVERT_MS   = 2 * 60 * 1000;    // avertissement deux minutes avant
  var CLE        = 'marfan_derniere_activite';
  var CLE_MOTIF  = 'marfan_motif_deconnexion';
  var PERIODE_MS = 15 * 1000;        // fréquence de vérification

  var actif = false;
  var minuteur = null;
  var dernierEcrit = 0;
  var modale = null;

  function maintenant() { return Date.now(); }

  function lireDerniere() {
    try {
      var v = parseInt(localStorage.getItem(CLE), 10);
      return isNaN(v) ? maintenant() : v;
    } catch (_) { return maintenant(); }
  }

  /** Écrire à chaque mouvement de souris saturerait le stockage : on ne
   *  rafraîchit qu'une fois toutes les dix secondes, ce qui suffit
   *  largement pour un seuil d'une heure. */
  function signalerActivite() {
    if (!actif) return;
    var t = maintenant();
    if (t - dernierEcrit < 10000) return;
    dernierEcrit = t;
    try { localStorage.setItem(CLE, String(t)); } catch (_) {}
    fermerModale();
  }

  function fermerModale() {
    if (modale && modale.parentNode) modale.parentNode.removeChild(modale);
    modale = null;
  }

  function resterConnecte() {
    dernierEcrit = 0;
    signalerActivite();
  }

  function afficherAvertissement(secondes) {
    if (modale) {
      var c = modale.querySelector('[data-compte]');
      if (c) c.textContent = secondes;
      return;
    }
    modale = document.createElement('div');
    modale.style.cssText = 'position:fixed; inset:0; z-index:100001; background:rgba(11,21,48,.72); ' +
      'backdrop-filter:blur(6px); display:flex; align-items:center; justify-content:center; ' +
      "font-family:-apple-system,'Segoe UI',system-ui,sans-serif;";
    modale.innerHTML =
      '<div style="background:#fff; border-radius:16px; padding:28px 32px; width:390px; max-width:92vw; ' +
      'box-shadow:0 30px 80px rgba(0,0,0,.28); text-align:center;">' +
        '<div style="font-size:34px; margin-bottom:8px;">🔒</div>' +
        '<h3 style="margin:0 0 8px; font-size:17px; font-weight:800; color:#0b1530;">Toujours là ?</h3>' +
        '<p style="margin:0 0 18px; font-size:13px; line-height:1.6; color:#5a6280;">' +
          'Sans activité de votre part, la session se fermera dans ' +
          '<strong data-compte style="color:#dc2626;">' + secondes + '</strong> secondes, ' +
          'pour protéger les données affichées à l\'écran.' +
        '</p>' +
        '<button type="button" data-rester style="width:100%; padding:11px; border:none; border-radius:9px; ' +
        'background:linear-gradient(135deg,#0f766e,#14b8a6); color:#fff; font-weight:700; font-size:13.5px; ' +
        'cursor:pointer;">Je suis là, garder la session ouverte</button>' +
        '<button type="button" data-partir style="width:100%; padding:9px; margin-top:8px; border:1px solid #e3e7ef; ' +
        'border-radius:9px; background:#fff; color:#5a6280; font-weight:600; font-size:12.5px; cursor:pointer;">' +
        'Me déconnecter maintenant</button>' +
      '</div>';
    modale.querySelector('[data-rester]').addEventListener('click', resterConnecte);
    modale.querySelector('[data-partir]').addEventListener('click', function () { deconnecter('manuelle'); });
    document.body.appendChild(modale);
  }

  async function deconnecter(motif) {
    if (!actif) return;
    actif = false;
    fermerModale();
    try { sessionStorage.setItem(CLE_MOTIF, motif || 'inactivite'); } catch (_) {}
    try { localStorage.removeItem(CLE); } catch (_) {}
    try {
      if (window.MarfanAPI && window.MarfanAPI.logout) await window.MarfanAPI.logout();
    } catch (_) { /* le rechargement coupe la session de toute façon */ }
    window.location.reload();
  }

  function verifier() {
    if (!actif) return;
    var inactif = maintenant() - lireDerniere();
    if (inactif >= DELAI_MS) { deconnecter('inactivite'); return; }
    if (inactif >= DELAI_MS - AVERT_MS) {
      afficherAvertissement(Math.max(1, Math.round((DELAI_MS - inactif) / 1000)));
    } else {
      fermerModale();
    }
  }

  var EVENEMENTS = ['mousedown', 'mousemove', 'keydown', 'wheel', 'scroll', 'touchstart', 'focus'];

  function demarrer() {
    if (actif) return;
    actif = true;
    dernierEcrit = 0;
    signalerActivite();
    EVENEMENTS.forEach(function (e) {
      window.addEventListener(e, signalerActivite, { passive: true, capture: true });
    });
    // Revenir sur l'onglet après une longue absence doit faire constater
    // l'expiration tout de suite, sans attendre le prochain tour de minuteur.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) verifier();
    });
    if (minuteur) clearInterval(minuteur);
    minuteur = setInterval(verifier, PERIODE_MS);
  }

  function arreter() {
    actif = false;
    if (minuteur) { clearInterval(minuteur); minuteur = null; }
    fermerModale();
    try { localStorage.removeItem(CLE); } catch (_) {}
  }

  /** Message à afficher après le rechargement qui suit une expiration. */
  function motifPrecedent() {
    try {
      var m = sessionStorage.getItem(CLE_MOTIF);
      if (m) sessionStorage.removeItem(CLE_MOTIF);
      return m;
    } catch (_) { return null; }
  }

  window.Inactivite = {
    demarrer: demarrer,
    arreter: arreter,
    motifPrecedent: motifPrecedent,
    delaiMinutes: Math.round(DELAI_MS / 60000)
  };
})();
