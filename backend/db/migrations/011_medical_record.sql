-- ============================================================
-- Migration 011 — Dossier médical structuré + documents importés
-- ============================================================
-- 1 ligne par patient dans medical_records :
--   8 sections JSONB (identity, history, antecedents, patient_goals,
--   clinician_goals, key_points, evaluations_summary, sessions_summary)
--   + sources (qui/quand/par où chaque champ a été renseigné)
--   + modifications (historique global, append-only)
--
-- N lignes par patient dans medical_record_documents :
--   PDF importés (raw_file en base64) + texte extrait + données
--   extraites par section + statut (pending/reviewed/integrated/rejected)
--
-- IDEMPOTENT.
-- ============================================================

BEGIN;

-- ====== TABLE medical_records ======
CREATE TABLE IF NOT EXISTS medical_records (
  patient_id          TEXT PRIMARY KEY,
  identity            JSONB NOT NULL DEFAULT '{}'::jsonb,
  history             JSONB NOT NULL DEFAULT '{}'::jsonb,
  antecedents         JSONB NOT NULL DEFAULT '{}'::jsonb,
  patient_goals       JSONB NOT NULL DEFAULT '{}'::jsonb,
  clinician_goals     JSONB NOT NULL DEFAULT '{}'::jsonb,
  key_points          JSONB NOT NULL DEFAULT '{}'::jsonb,
  evaluations_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  sessions_summary    JSONB NOT NULL DEFAULT '{}'::jsonb,
  sources             JSONB NOT NULL DEFAULT '{}'::jsonb,
  modifications       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by          TEXT
);

-- ====== TABLE medical_record_documents ======
CREATE TABLE IF NOT EXISTS medical_record_documents (
  id              SERIAL PRIMARY KEY,
  patient_id      TEXT NOT NULL,
  file_name       TEXT,
  file_size_kb    INTEGER,
  file_mime       TEXT,
  raw_file        TEXT,     -- base64 du PDF
  extracted_text  TEXT,     -- texte brut extrait
  extracted_data  JSONB,    -- données par section après classification
  integrated_data JSONB,    -- données validées et intégrées
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','reviewed','integrated','rejected','partial')),
  ocr_used        BOOLEAN NOT NULL DEFAULT FALSE,
  notes           TEXT,
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     TEXT
);

CREATE INDEX IF NOT EXISTS idx_medrec_doc_patient ON medical_record_documents (patient_id);
CREATE INDEX IF NOT EXISTS idx_medrec_doc_status  ON medical_record_documents (status);

SELECT 'OK migration 011' AS msg;

COMMIT;
-- Fin migration 011
