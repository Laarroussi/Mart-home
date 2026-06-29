-- ============================================================
-- Migration 006 — Programmes / séances prescrites d'entraînement
-- ============================================================
-- Modèle :
--   - training_programs       : 1 séance prescrite (titre + consignes + créateur)
--   - training_program_videos : N vidéos par programme (avec ordre)
--   - training_program_patients : attribution programme × patient
--
-- Permet à l'investigateur de regrouper plusieurs vidéos sous un titre/consignes
-- communs et de l'attribuer à des patients. Le patient voit alors "Séance 1"
-- avec son descriptif, puis peut lancer chaque vidéo qui la compose.
--
-- IDEMPOTENT.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. training_programs
-- ============================================================
CREATE TABLE IF NOT EXISTS training_programs (
    id           SERIAL PRIMARY KEY,
    title        VARCHAR(200) NOT NULL,
    description  TEXT,                              -- résumé court
    instructions TEXT,                              -- consignes générales pour le patient
    created_by   VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    archived     BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_training_programs_created_by ON training_programs(created_by);
CREATE INDEX IF NOT EXISTS idx_training_programs_archived   ON training_programs(archived);

DROP TRIGGER IF EXISTS set_training_programs_updated ON training_programs;
CREATE TRIGGER set_training_programs_updated
    BEFORE UPDATE ON training_programs
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- ============================================================
-- 2. training_program_videos (jointure many-to-many programme × vidéo, avec ordre)
-- ============================================================
CREATE TABLE IF NOT EXISTS training_program_videos (
    id          SERIAL PRIMARY KEY,
    program_id  INTEGER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    video_id    VARCHAR(50) NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    order_index INTEGER NOT NULL DEFAULT 0,
    note        TEXT,
    UNIQUE(program_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_tpv_program ON training_program_videos(program_id, order_index);
CREATE INDEX IF NOT EXISTS idx_tpv_video   ON training_program_videos(video_id);

-- ============================================================
-- 3. training_program_patients (attribution programme × patient)
-- ============================================================
CREATE TABLE IF NOT EXISTS training_program_patients (
    id          SERIAL PRIMARY KEY,
    program_id  INTEGER NOT NULL REFERENCES training_programs(id) ON DELETE CASCADE,
    patient_id  VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    assigned_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(program_id, patient_id)
);
CREATE INDEX IF NOT EXISTS idx_tpp_program ON training_program_patients(program_id);
CREATE INDEX IF NOT EXISTS idx_tpp_patient ON training_program_patients(patient_id);
CREATE INDEX IF NOT EXISTS idx_tpp_assigned_at ON training_program_patients(assigned_at);

-- ============================================================
-- 4. Vérification
-- ============================================================
SELECT 'training_programs' AS t, COUNT(*) AS rows FROM training_programs
UNION ALL SELECT 'training_program_videos', COUNT(*) FROM training_program_videos
UNION ALL SELECT 'training_program_patients', COUNT(*) FROM training_program_patients;

COMMIT;

-- Fin migration 006
