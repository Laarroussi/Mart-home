-- ============================================================
-- 017 — Synthèse clinique du patient
-- ------------------------------------------------------------
-- Une seule synthèse vivante par patient, en trois rubriques :
--
--   entree          : qui est le patient, sa pathologie, son gène, sa
--                     profession, ses diamètres aortiques et leur évolution,
--                     ses opérations. Rédigée à l'inclusion, rarement modifiée.
--   objectifs       : ce qu'il ressent comme difficultés, ce qu'on vise avec
--                     lui, et la façon dont l'activité physique adaptée en
--                     ligne est mise en place.
--   suivi_activite  : l'état de sa pratique, remis à jour à chaque
--                     consultation — nombre de séances, durée moyenne,
--                     intensités, CR10, éducation thérapeutique suivie.
--
--   bilan_entretien : notes libres de l'investigateur. Elles ne sont PAS
--                     publiées telles quelles : l'IA s'en sert pour nourrir
--                     les rubriques « entree » et « objectifs ». Certains
--                     éléments d'un entretien n'ont pas vocation à figurer
--                     dans une synthèse partagée.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

CREATE TABLE IF NOT EXISTS syntheses (
  id               SERIAL PRIMARY KEY,
  patient_id       TEXT NOT NULL UNIQUE,
  entree           TEXT,
  objectifs        TEXT,
  suivi_activite   TEXT,
  bilan_entretien  TEXT,
  generee_le       TIMESTAMPTZ,
  maj_le           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  maj_par          TEXT
);

CREATE INDEX IF NOT EXISTS idx_syntheses_patient ON syntheses (patient_id);

-- Historique des générations : utile pour comparer ce que l'IA a proposé et
-- ce que le clinicien a finalement retenu. Une synthèse reste un document
-- signé par un humain, pas une sortie de modèle.
CREATE TABLE IF NOT EXISTS syntheses_versions (
  id            SERIAL PRIMARY KEY,
  patient_id    TEXT NOT NULL,
  entree        TEXT,
  objectifs     TEXT,
  suivi_activite TEXT,
  origine       TEXT NOT NULL DEFAULT 'ia',  -- 'ia' ou 'manuel'
  modele        TEXT,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cree_par      TEXT
);

CREATE INDEX IF NOT EXISTS idx_syntheses_versions_patient
  ON syntheses_versions (patient_id, cree_le DESC);
