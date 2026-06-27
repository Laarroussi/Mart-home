# Marfan APA — Plateforme numérique

Plateforme de suivi longitudinal pour patients atteints du syndrome de Marfan : dossier patient, analyses VO₂ et onde de pouls, visio APA collective, éducation thérapeutique (questionnaires diagnostiques/sommatifs), gestion de cohorte multi-rôles (admin / investigateur principal / investigateur / patient).

## Structure du dépôt

```
.
├── index.html             ← Application complète (front-end autonome, ~485 KB)
├── api-client.js          ← Wrapper JS d'appel API (utilisé quand le backend est actif)
├── .htaccess              ← Apache : HTTPS, sécurité, GZIP, cache, (proxy /api désactivé en phase 1)
├── CLAUDE.md              ← Règles de travail (ne pas modifier)
│
├── .github/workflows/
│   └── deploy-o2switch.yml   ← Pipeline CI/CD (ne pas modifier sans demande explicite)
│
└── backend/               ← Backend Node.js + PostgreSQL (à activer manuellement, voir phase 2)
    ├── package.json
    ├── server.js
    ├── .env.example
    ├── config/database.js
    ├── middleware/auth.js
    ├── routes/             (auth, users, patients, evaluations, notifications, education, analyses, visio, cohort)
    └── db/
        ├── schema.sql      (9 tables, 13 index, 2 vues, 2 triggers)
        ├── seed.js         (amorce 20 patients démo + comptes)
        └── reset.sql
```

## Déploiement en deux phases

### ⚡ Phase 1 — Frontend statique (actuel)

Le pipeline GitHub Actions `deploy-o2switch.yml` (déclenchement manuel via *Actions → Run workflow*) synchronise par `rsync` tous les fichiers du repo vers `/home/jost2290/public_html/marfantraining` sur o2switch.

Le frontend `index.html` est **autoporté** : il contient toute la logique métier en JavaScript et fonctionne avec des données de démonstration (20 patients fictifs, 95 évaluations, 6 capsules d'éducation thérapeutique). **Aucune base de données n'est requise pour cette phase.**

Comptes de démonstration (in-memory, dans le navigateur uniquement) :
- Administrateur, Investigateur principal, Investigateur, 20 Patients — tous accessibles depuis la page d'accueil

### 🔌 Phase 2 — Activation du backend Node.js + PostgreSQL (manuelle)

Quand vous voudrez passer des données démo à des données réelles, persistées en BDD :

1. **Créer la base PostgreSQL** dans cPanel → *Bases de données → PostgreSQL*
2. **Setup Node.js App** dans cPanel pointant vers le dossier `backend/`
3. Renseigner `.env` (copie de `.env.example`) avec les identifiants BDD + un `JWT_SECRET` fort
4. `npm install --production` puis `npm run db:init` puis `npm run db:seed`
5. **Décommenter** la ligne du proxy `/api` dans `.htaccess` :
   ```
   RewriteRule ^api/(.*)$ http://127.0.0.1:PORT/api/$1 [P,L]
   ```
6. **Redémarrer** l'application Node.js dans cPanel

Le frontend bascule automatiquement vers l'API si `MarfanAPI.tryConnect()` réussit — sinon il reste en mode démo.

## Fonctionnalités principales

- **Vue cohorte** : KPI, distribution par gène, tendances moyennes (VO₂, force, aorte, SF-36)
- **Dossier patient** : timeline longitudinale, synthèse, physiologie, aorte, questionnaires, comparaisons (Patient vs Groupe / Baseline → Dernière), analyse VO₂ détaillée avec curseurs SV1/SV2 interactifs + fit cinétique réel sur fichier importé, analyse onde de pouls (pOpmètre)
- **Création fiche patient** : formulaire en 5 blocs + auto-envoi SF-36/GPAQ obligatoires
- **Listing patients** : tableau + envoi groupé/individuel des questionnaires
- **Visio APA** : grille des participants avec **overlays physio temps réel** (FC, PA estimée, dépense énergétique)
- **Éducation thérapeutique** : workflow ordonné pré-vidéo → vidéo → post-vidéo, scores et validation thématique automatique
- **Base de données** : 3 vues (longitudinale, large multi-visites, éducation), export CSV avec BOM UTF-8

## Espaces

- **Page d'accueil** : 2 portails (Investigateur / Patient)
- **Espace investigateur** : 8 onglets fonctionnels (Accueil, Création fiche patient, Dossier patient, Base de données, Listing patients, Entraînement + Visio, Salle visio, Éducation thérapeutique)
- **Espace patient** : 4 onglets (Mes questionnaires, Séance en visio, Éducation thérapeutique, Mes données)

## Stack technique

| Couche | Technologie | Phase |
| --- | --- | --- |
| Frontend | HTML/CSS/JS pur (Chart.js + SheetJS via CDN) | 1 — actif |
| Backend | Node.js 18 + Express 4 | 2 — à activer |
| Base de données | PostgreSQL 12+ | 2 — à activer |
| Authentification | JWT + bcrypt | 2 — à activer |
| Visio (production) | Jitsi Meet recommandé (Zoom Web SDK ou Daily.co également possibles) | 3 — à intégrer |

## Conformité

Cette plateforme traite des données de santé. Pour un usage clinique réel :
- Hébergement HDS recommandé (au-delà de la maquette o2switch)
- Tracer les accès via la table `notification_log` (déjà en place dans le schéma)
- DPO et analyse PIA à prévoir

## Licence

Code et documentation : usage interne au projet de recherche.
