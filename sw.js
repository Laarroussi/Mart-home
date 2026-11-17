/**
 * sw.js — Service worker volontairement minimal
 * ==============================================
 *
 * Il existe pour UNE raison : rendre le site installable. Chrome n'autorise
 * l'installation que si un service worker sait répondre quelque chose quand
 * le réseau est coupé.
 *
 * ── Ce qu'il ne fait pas, et pourquoi ───────────────────────────────────
 * Il ne met EN CACHE NI index.html, NI les fichiers .js, NI les appels à
 * l'API. C'est délibéré, et c'est le point important de ce fichier.
 *
 * Ce projet a déjà perdu deux jours sur un correctif pourtant déployé : le
 * navigateur servait une ancienne copie, et rien à l'écran ne le disait. La
 * parade retenue a été le paramètre ?v=phaseNN et le numéro de version
 * affiché en bas de page. Un service worker qui mettrait l'application en
 * cache rendrait cette parade inopérante : il servirait sa copie AVANT même
 * de regarder l'URL, et la version affichée deviendrait un mensonge.
 *
 * Entre « le site fonctionne hors ligne » et « le soignant est certain de
 * voir la version qu'il vient de déployer », le second compte davantage ici.
 * Une plateforme de suivi clinique sans réseau ne sert de toute façon à
 * rien : ni visioconférence, ni dossier, ni enregistrement de séance.
 *
 * Il se contente donc de laisser passer, et de montrer une page d'attente
 * lisible quand la connexion manque.
 */
'use strict';

const CACHE = 'marfan-apa-hors-ligne-v1';
const PAGE_HORS_LIGNE = 'hors-ligne.html';

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll([PAGE_HORS_LIGNE, 'icones/icone-192.png']))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // Tout part au réseau, sans exception. Rien de l'application n'est servi
  // depuis le cache : voir l'en-tête de ce fichier.
  if (req.method !== 'GET') return;

  e.respondWith(
    fetch(req).catch(() => {
      // Hors ligne. Une navigation reçoit la page d'attente ; le reste
      // échoue franchement plutôt que de renvoyer une copie périmée.
      if (req.mode === 'navigate') {
        return caches.match(PAGE_HORS_LIGNE)
          .then((r) => r || new Response('Hors ligne.', {
            status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          }));
      }
      return new Response('', { status: 503 });
    })
  );
});
