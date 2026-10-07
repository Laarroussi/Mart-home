-- ============================================================
-- 030 — Questionnaires libres
-- ------------------------------------------------------------
-- Un espace entièrement séparé du suivi clinique. Les questionnaires du
-- protocole — SF-36, GPAQ — sont envoyés automatiquement aux patients
-- inclus et leurs scores nourrissent les évaluations. Ceux-ci ne font rien
-- de tout cela : on les écrit soi-même, on les envoie à qui l'on veut, et
-- les réponses ne touchent à aucun dossier.
--
-- D'où le choix de tables distinctes plutôt qu'un drapeau « libre » sur les
-- tables existantes. Un drapeau aurait suffi techniquement, mais il aurait
-- fallu le vérifier dans chaque requête, chaque export, chaque calcul de
-- score — et il aurait suffi d'un oubli pour qu'une réponse libre se compte
-- comme un item de SF-36. Des tables séparées rendent la confusion
-- impossible plutôt que simplement improbable.
--
-- Le préfixe « ql_ » marque cette séparation jusque dans les noms.
--
-- ---- Sur les jetons ----
-- Le destinataire n'a pas de compte : il reçoit un lien et répond. Le jeton
-- qu'il porte est donc la seule chose qui protège la réponse. Il est long,
-- aléatoire, à usage unique et daté : une fois le questionnaire validé ou la
-- date passée, le lien ne rouvre plus rien. Un lien qui reste indéfiniment
-- valable finit par circuler dans des boîtes partagées.
--
-- ---- Sur le cloisonnement ----
-- Chaque questionnaire appartient à son créateur. Les routes filtrent sur
-- proprietaire ; l'administrateur principal, lui, voit tout, parce qu'il est
-- responsable des données de la plateforme et qu'un questionnaire orphelin
-- doit rester récupérable.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

CREATE TABLE IF NOT EXISTS ql_questionnaires (
  id             SERIAL PRIMARY KEY,
  proprietaire   TEXT NOT NULL,            -- users.id du créateur
  titre          TEXT NOT NULL,
  description    TEXT,
  consigne       TEXT,                     -- texte affiché en tête du formulaire
  message_fin    TEXT,                     -- remerciement affiché après validation
  validite_jours INTEGER NOT NULL DEFAULT 30,
  actif          BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  maj_le         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ql_q_proprietaire ON ql_questionnaires (proprietaire, cree_le DESC);

CREATE TABLE IF NOT EXISTS ql_questions (
  id              SERIAL PRIMARY KEY,
  questionnaire_id INTEGER NOT NULL REFERENCES ql_questionnaires(id) ON DELETE CASCADE,
  code            TEXT,                    -- identifiant de colonne pour l'export
  libelle         TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'texte',
                  -- texte | texte_long | nombre | date | choix | choix_multiple
                  -- | oui_non | echelle
  choix           TEXT,                    -- valeurs séparées par des points-virgules
  obligatoire     BOOLEAN NOT NULL DEFAULT FALSE,
  valeur_min      NUMERIC,
  valeur_max      NUMERIC,
  aide            TEXT,
  rang            INTEGER NOT NULL DEFAULT 0,
  cree_le         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ql_quest_q ON ql_questions (questionnaire_id, rang);

CREATE TABLE IF NOT EXISTS ql_envois (
  id              SERIAL PRIMARY KEY,
  questionnaire_id INTEGER NOT NULL REFERENCES ql_questionnaires(id) ON DELETE CASCADE,
  email           TEXT NOT NULL,
  nom             TEXT,
  jeton           TEXT NOT NULL UNIQUE,
  envoye_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expire_le       TIMESTAMPTZ NOT NULL,
  relances        INTEGER NOT NULL DEFAULT 0,
  derniere_relance TIMESTAMPTZ,
  repondu_le      TIMESTAMPTZ,             -- non nul = lien consommé
  mail_statut     TEXT,                    -- 'envoye', 'echec', ou la raison
  cree_par        TEXT
);
CREATE INDEX IF NOT EXISTS idx_ql_envois_q ON ql_envois (questionnaire_id, envoye_le DESC);
-- Le jeton est lu à chaque ouverture du lien : c'est la requête la plus
-- fréquente de cet espace, et elle vient d'un visiteur non authentifié.
CREATE INDEX IF NOT EXISTS idx_ql_envois_jeton ON ql_envois (jeton);

-- Une seule invitation en attente par adresse et par questionnaire : sans
-- cela, une relance maladroite crée un second lien, la personne répond deux
-- fois, et l'on compte deux participants là où il y en a un.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ql_envoi_attente
  ON ql_envois (questionnaire_id, lower(email)) WHERE repondu_le IS NULL;

CREATE TABLE IF NOT EXISTS ql_reponses (
  id          SERIAL PRIMARY KEY,
  envoi_id    INTEGER NOT NULL REFERENCES ql_envois(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES ql_questions(id) ON DELETE CASCADE,
  valeur      TEXT,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ql_reponses_envoi ON ql_reponses (envoi_id);
-- Une réponse par question et par envoi. Le renvoi d'un formulaire ne doit
-- pas empiler des lignes : il remplace, via ON CONFLICT.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ql_reponse ON ql_reponses (envoi_id, question_id);

SELECT 'OK migration 030 — questionnaires libres' AS msg;
