-- ============================================================
-- 027 — Études cliniques et cahier d'observation (eCRF)
-- ------------------------------------------------------------
-- Jusqu'ici la plateforme suivait des patients. Elle doit maintenant aussi
-- porter des protocoles : une file active peut relever de plusieurs études,
-- et un même patient pris en charge en APA n'est pas nécessairement inclus
-- dans un protocole de recherche.
--
-- Trois tables, et une colonne.
--
--   etudes            la fiche du protocole : intitulé, résumé, numéro CPP,
--                     numéro NCT, promoteur, statut, dates.
--   ecrf_sections     les chapitres du cahier d'observation, ordonnés.
--   ecrf_variables    les données à recueillir, ordonnées dans leur section.
--   patients.etude_id le rattachement, nul par défaut.
--
-- Le rattachement est volontairement SIMPLE : un patient appartient à zéro ou
-- une étude. Une table de liaison permettrait l'inclusion multiple, mais
-- celle-ci pose aussitôt des questions auxquelles on ne sait pas encore
-- répondre — quel numéro d'inclusion, quel consentement, quel eCRF prévaut.
-- Mieux vaut une structure juste pour l'usage réel qu'une structure générale
-- qu'on remplirait mal. ON DELETE SET NULL : supprimer une étude ne doit
-- jamais supprimer un patient.
--
-- Pour le cahier, la distinction section/variable n'est pas cosmétique. Un
-- dictionnaire de données se relit par chapitres, et l'ordre d'apparition
-- fait partie du protocole : c'est lui qu'on retrouve dans le cahier papier
-- et dans l'export. D'où la colonne `rang` des deux côtés.
--
-- `code` est l'identifiant de la variable dans les exports statistiques. On
-- le laisse libre plutôt que de le dériver du libellé : les équipes ont
-- leurs conventions, et un code calculé automatiquement se révèle toujours
-- faux pour quelqu'un.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

CREATE TABLE IF NOT EXISTS etudes (
  id             SERIAL PRIMARY KEY,
  intitule       TEXT NOT NULL,
  acronyme       TEXT,
  resume         TEXT,
  numero_cpp     TEXT,
  numero_nct     TEXT,
  promoteur      TEXT,
  investigateur_principal TEXT,
  type_etude     TEXT,
  statut         TEXT NOT NULL DEFAULT 'preparation',
  date_debut     DATE,
  date_fin       DATE,
  objectif_inclusions INTEGER,
  notes          TEXT,
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  cree_le        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cree_par       TEXT,
  maj_le         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  maj_par        TEXT
);

CREATE INDEX IF NOT EXISTS idx_etudes_statut ON etudes (statut) WHERE active;

-- Un numéro NCT et un numéro CPP identifient un protocole : deux études ne
-- peuvent pas les partager. Index partiels, parce qu'une étude en préparation
-- n'a souvent ni l'un ni l'autre, et que plusieurs NULL doivent cohabiter.
CREATE UNIQUE INDEX IF NOT EXISTS uq_etudes_nct
  ON etudes (numero_nct) WHERE numero_nct IS NOT NULL AND numero_nct <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_etudes_cpp
  ON etudes (numero_cpp) WHERE numero_cpp IS NOT NULL AND numero_cpp <> '';

-- ====== CAHIER D'OBSERVATION ======

CREATE TABLE IF NOT EXISTS ecrf_sections (
  id          SERIAL PRIMARY KEY,
  etude_id    INTEGER NOT NULL REFERENCES etudes(id) ON DELETE CASCADE,
  titre       TEXT NOT NULL,
  description TEXT,
  visite      TEXT,          -- 'Inclusion', 'M3', 'M6', 'Sortie'… libre
  rang        INTEGER NOT NULL DEFAULT 0,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ecrf_sections_etude ON ecrf_sections (etude_id, rang);

CREATE TABLE IF NOT EXISTS ecrf_variables (
  id          SERIAL PRIMARY KEY,
  section_id  INTEGER NOT NULL REFERENCES ecrf_sections(id) ON DELETE CASCADE,
  code        TEXT,
  libelle     TEXT NOT NULL,
  type        TEXT NOT NULL DEFAULT 'texte',
                -- texte | nombre | date | choix | choix_multiple | oui_non | fichier
  unite       TEXT,
  choix       TEXT,          -- valeurs possibles, séparées par des points-virgules
  obligatoire BOOLEAN NOT NULL DEFAULT FALSE,
  valeur_min  NUMERIC,
  valeur_max  NUMERIC,
  aide        TEXT,          -- consigne de recueil, lue par celui qui remplit
  rang        INTEGER NOT NULL DEFAULT 0,
  cree_le     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ecrf_variables_section ON ecrf_variables (section_id, rang);

-- ====== RATTACHEMENT DU PATIENT ======
-- NULL = ne participe à aucune étude. C'est la valeur par défaut, et elle le
-- restera : inclure un patient dans un protocole est un acte, pas un état
-- que l'on hérite d'une case cochée par inadvertance.
ALTER TABLE patients ADD COLUMN IF NOT EXISTS etude_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patients_etude_id_fkey'
  ) THEN
    ALTER TABLE patients
      ADD CONSTRAINT patients_etude_id_fkey
      FOREIGN KEY (etude_id) REFERENCES etudes(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_patients_etude ON patients (etude_id);

SELECT 'OK migration 027 — etudes cliniques et cahier eCRF' AS msg;
