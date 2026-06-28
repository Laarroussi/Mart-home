-- ============================================================
-- Migration 005 — Séances d'entraînement patient
-- ============================================================
-- Crée 2 tables :
--   - training_sessions : 1 ligne par séance, métadonnées + stats agrégées
--   - training_samples  : N lignes par séance, échantillons temporels (FC/PA/énergie)
--
-- Les samples servent à reconstruire les cinétiques sur la fiche résumé.
-- Pour limiter la volumétrie : 1 sample toutes les 5 secondes (configurable côté frontend).
--
-- IDEMPOTENT.
-- ============================================================

BEGIN;

-- ============================================================
-- training_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS training_sessions (
    id                  SERIAL PRIMARY KEY,
    patient_id          VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    investigator_id     VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,  -- investigateur en charge (optionnel)
    visio_session_id    INTEGER     REFERENCES visio_sessions(id) ON DELETE SET NULL,  -- si liée à une visio
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at            TIMESTAMPTZ,
    duration_s          INTEGER,                                              -- durée totale en secondes
    status              VARCHAR(20) NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress','completed','interrupted','cancelled')),
    borg_cr10           INTEGER CHECK (borg_cr10 BETWEEN 0 AND 10),           -- ressenti à la fin
    -- Statistiques agrégées (calculées au moment du end)
    hr_min              INTEGER,
    hr_avg              NUMERIC(5,1),
    hr_max              INTEGER,
    pa_estimated_min    INTEGER,
    pa_estimated_avg    NUMERIC(5,1),
    pa_estimated_max    INTEGER,
    energy_total_kcal   NUMERIC(8,2),
    -- Métadonnées techniques
    belt_connected      BOOLEAN DEFAULT FALSE,                                -- ceinture FC connectée pendant la séance
    pa_method           VARCHAR(50) DEFAULT 'estimated_from_hr',              -- méthode d'estimation PA
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_patient    ON training_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_training_started_at ON training_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_training_status     ON training_sessions(status);
CREATE INDEX IF NOT EXISTS idx_training_visio      ON training_sessions(visio_session_id);

DROP TRIGGER IF EXISTS set_training_updated ON training_sessions;
CREATE TRIGGER set_training_updated
    BEFORE UPDATE ON training_sessions
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- ============================================================
-- training_samples (échantillons temporels)
-- ============================================================
CREATE TABLE IF NOT EXISTS training_samples (
    id              BIGSERIAL PRIMARY KEY,
    session_id      INTEGER NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
    t_seconds       INTEGER NOT NULL,             -- secondes depuis le début de la séance
    hr              INTEGER,                       -- fréquence cardiaque bpm
    pa_estimated    INTEGER,                       -- pression artérielle estimée mmHg
    energy_kcal     NUMERIC(7,3),                  -- dépense énergétique cumulée à cet instant
    recorded_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, t_seconds)
);
CREATE INDEX IF NOT EXISTS idx_training_samples_session ON training_samples(session_id, t_seconds);

-- ============================================================
-- Vérification
-- ============================================================
SELECT 'training_sessions' AS table_name, COUNT(*) AS rows FROM training_sessions
UNION ALL
SELECT 'training_samples', COUNT(*) FROM training_samples;

COMMIT;

-- ============================================================
-- Fin migration 005
-- ============================================================
