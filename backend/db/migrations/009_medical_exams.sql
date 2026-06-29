-- ============================================================
-- Migration 009 — Examens médicaux importés (CPET, Onde de pouls, etc.)
-- ============================================================
-- Table générique pour tous types d'examens cliniques importés via CSV/XLSX :
--   - CPET (Test d'effort cardio-pulmonaire) — fichiers XLSX (COSMED) ou CSV
--   - Pulse Wave Analysis (Onde de pouls / VOP / Rigidité artérielle) — CSV
--   - Échocardiographie, Biologie, ECG, ... (à venir)
--
-- raw_file (TEXT base64) : fichier original conservé pour traçabilité scientifique
-- parsed_summary (JSONB) : synthèse extraite automatiquement par le parseur frontend
-- validated_data (JSONB) : valeurs corrigées/validées manuellement par l'investigateur
-- modifications (JSONB) : historique [{ field, old, new, by, at, reason }, ...]
--
-- IDEMPOTENT.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS medical_exams (
    id              SERIAL PRIMARY KEY,
    patient_id      VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    exam_type       VARCHAR(30) NOT NULL
                    CHECK (exam_type IN ('cpet', 'pulse_wave', 'echocardiography', 'biology', 'ecg', 'spirometry', 'other')),
    exam_date       DATE,
    file_name       VARCHAR(255),
    file_size_kb    INTEGER,
    file_mime       VARCHAR(100),
    raw_file        TEXT,                          -- base64 du fichier original
    parsed_summary  JSONB,                         -- synthèse extraite : { vo2_max, vo2_peak, hr_max, ... } pour CPET ; { vop, aix, csp, ... } pour pulse_wave
    parsed_full     JSONB,                         -- données complètes parsées (cycles CPET, signaux onde de pouls, etc.)
    validated_data  JSONB,                         -- valeurs corrigées par l'investigateur (write-only)
    modifications   JSONB DEFAULT '[]'::jsonb,    -- historique des modifications
    notes           TEXT,                          -- commentaires / interprétation
    status          VARCHAR(30) NOT NULL DEFAULT 'imported'
                    CHECK (status IN ('imported', 'parsed', 'pending_validation', 'validated', 'modified_after_validation', 'error', 'incomplete')),
    error_message   TEXT,                          -- si status = 'error'
    imported_by     VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    imported_at     TIMESTAMPTZ DEFAULT NOW(),
    validated_by    VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    validated_at    TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_medex_patient    ON medical_exams(patient_id);
CREATE INDEX IF NOT EXISTS idx_medex_type       ON medical_exams(exam_type);
CREATE INDEX IF NOT EXISTS idx_medex_status     ON medical_exams(status);
CREATE INDEX IF NOT EXISTS idx_medex_exam_date  ON medical_exams(exam_date);
CREATE INDEX IF NOT EXISTS idx_medex_imported_at ON medical_exams(imported_at);

DROP TRIGGER IF EXISTS set_medex_updated ON medical_exams;
CREATE TRIGGER set_medex_updated
    BEFORE UPDATE ON medical_exams
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

SELECT exam_type, status, COUNT(*) AS nb
  FROM medical_exams GROUP BY exam_type, status ORDER BY exam_type, status;

COMMIT;
-- Fin migration 009
