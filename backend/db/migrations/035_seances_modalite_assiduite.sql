-- ============================================================
-- Migration 035 — Modalité des séances et calcul de l'assiduité
-- ------------------------------------------------------------
-- `training_sessions` enregistrait déjà la durée, les fréquences cardiaques,
-- le ressenti de Borg et la dépense estimée. Deux informations manquaient,
-- et leur absence rendait incalculables deux des indicateurs demandés.
--
-- ---- 1. La modalité ----
-- Endurance, renforcement musculaire, ou les deux. Sans elle, impossible de
-- dire comment se répartit le travail d'un patient — alors que c'est
-- justement ce qui distingue une prise en charge adaptée d'un simple volume
-- d'activité. Dans le syndrome de Marfan la question n'est pas théorique :
-- le renforcement en force maximale est contre-indiqué, et savoir ce qui a
-- réellement été fait engage la sécurité du patient.
--
-- Le champ existant `session_type` ne répond pas à cette question : il dit
-- par quel canal la séance a eu lieu (vidéo, visio, libre), pas ce qui y a
-- été travaillé. Les deux sont utiles, et distincts.
--
-- ---- 2. Le volume prescrit ----
-- Un taux d'assiduité est un rapport : séances réalisées sur séances
-- attendues. Sans dénominateur, il n'existe pas. On enregistre donc le
-- nombre de séances prescrites par semaine, au niveau de l'affectation d'un
-- patient à un programme — c'est là que la prescription est faite.
--
-- Choix assumé : pas de table de séances planifiées une par une. Elle serait
-- plus précise, et elle ne serait jamais tenue à jour. Un rythme
-- hebdomadaire se renseigne une fois et reste vrai.
--
-- ---- Ce qui n'est pas fait ----
-- Aucune modalité n'est devinée pour les séances passées. Il n'y en a aucune
-- en base aujourd'hui, et de toute façon reconstituer après coup ce qu'un
-- patient a travaillé reviendrait à inventer.
--
-- IDEMPOTENT — rejouable. Pas de BEGIN/COMMIT.
-- ============================================================

-- ===== Modalité de la séance =====
ALTER TABLE training_sessions
  ADD COLUMN IF NOT EXISTS modalite TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_sessions_modalite_chk') THEN
    -- NULL reste permis : une séance d'avant cette migration, ou dont la
    -- modalité n'a pas été renseignée, doit s'afficher comme « non précisée »
    -- et non se voir attribuer une valeur par défaut qui serait fausse.
    ALTER TABLE training_sessions ADD CONSTRAINT training_sessions_modalite_chk
      CHECK (modalite IS NULL OR modalite IN ('endurance', 'renforcement', 'combine', 'autre'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sessions_modalite
  ON training_sessions (patient_id, modalite);

-- ===== Volume prescrit, pour le dénominateur de l'assiduité =====
ALTER TABLE training_program_patients
  ADD COLUMN IF NOT EXISTS seances_par_semaine NUMERIC(3,1);
ALTER TABLE training_program_patients
  ADD COLUMN IF NOT EXISTS duree_seance_min INTEGER;
ALTER TABLE training_program_patients
  ADD COLUMN IF NOT EXISTS prescription_debut DATE;
ALTER TABLE training_program_patients
  ADD COLUMN IF NOT EXISTS prescription_fin DATE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tpp_rythme_chk') THEN
    -- Au-delà de quatorze séances par semaine, c'est une erreur de saisie :
    -- deux par jour tous les jours. La borne haute protège le calcul
    -- d'assiduité, qui deviendrait absurde sans elle.
    ALTER TABLE training_program_patients ADD CONSTRAINT tpp_rythme_chk
      CHECK (seances_par_semaine IS NULL
             OR (seances_par_semaine > 0 AND seances_par_semaine <= 14));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tpp_periode_chk') THEN
    ALTER TABLE training_program_patients ADD CONSTRAINT tpp_periode_chk
      CHECK (prescription_debut IS NULL OR prescription_fin IS NULL
             OR prescription_fin >= prescription_debut);
  END IF;
END $$;

SELECT 'training_sessions.modalite' AS colonne,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'training_sessions' AND column_name = 'modalite')
            THEN 'présente' ELSE 'ABSENTE' END AS etat
UNION ALL
SELECT 'training_program_patients.seances_par_semaine',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'training_program_patients'
                            AND column_name = 'seances_par_semaine')
            THEN 'présente' ELSE 'ABSENTE' END;

SELECT 'OK migration 035 — modalité et assiduité' AS msg;
