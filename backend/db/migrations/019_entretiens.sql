-- ============================================================
-- 019 — Entretiens patients (enregistrés et transcrits)
-- ------------------------------------------------------------
-- Un entretien mené en consultation ou en visio, enregistré puis transcrit.
-- La transcription alimente la synthèse et pré-remplit les champs du dossier.
--
-- Ce que l'on conserve, et pourquoi :
--   transcription : le texte, qui reste la source vérifiable de ce qui a été
--                   porté au dossier. Sans lui, impossible de contrôler ce
--                   que l'IA a retenu ou déformé.
--   champs        : ce que l'IA en a extrait, avant relecture.
--   valide        : passe à TRUE quand le clinicien a relu et appliqué.
--
-- L'AUDIO N'EST PAS CONSERVÉ. La voix est une donnée biométrique au sens du
-- RGPD ; la stocker imposerait des obligations lourdes et sans intérêt ici,
-- puisque seul le texte sert. Le fichier est transcrit puis abandonné.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

CREATE TABLE IF NOT EXISTS entretiens (
  id            SERIAL PRIMARY KEY,
  patient_id    TEXT NOT NULL,
  date_entretien DATE NOT NULL DEFAULT CURRENT_DATE,
  duree_s       INTEGER,
  source        TEXT NOT NULL DEFAULT 'enregistrement'
                CHECK (source IN ('enregistrement', 'fichier', 'saisie')),
  transcription TEXT,
  champs        JSONB NOT NULL DEFAULT '{}'::jsonb,
  valide        BOOLEAN NOT NULL DEFAULT FALSE,
  cree_le       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cree_par      TEXT
);

CREATE INDEX IF NOT EXISTS idx_entretiens_patient
  ON entretiens (patient_id, date_entretien DESC);

SELECT 'OK migration 019 — table entretiens' AS msg;
