-- ============================================================
-- Migration 007 — Enrichissement training_sessions
-- ============================================================
-- Permet de tracer le TYPE de séance + son CONTEXTE :
--   - session_type      : 'video' | 'visio' | 'libre' | 'autre'
--   - content           : contenu de la séance (auto-rempli ou saisi par le patient)
--   - patient_comment   : commentaire libre du patient à la fin
--   - video_id          : si type=video, lien vers la vidéo regardée
--   - training_program_id : si la séance fait partie d'un programme prescrit
--
-- visio_session_id existe déjà depuis migration 005.
--
-- Ajoute aussi 'prepared' aux statuts (séance créée mais pas démarrée).
--
-- IDEMPOTENT.
-- ============================================================

BEGIN;

ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS session_type        VARCHAR(20) DEFAULT 'libre';
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS content             TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS patient_comment     TEXT;
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS video_id            VARCHAR(50);
ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS training_program_id INTEGER;

-- Contraintes FK (avec garde idempotente)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_sessions_video_fk') THEN
        ALTER TABLE training_sessions
            ADD CONSTRAINT training_sessions_video_fk
            FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_sessions_program_fk') THEN
        ALTER TABLE training_sessions
            ADD CONSTRAINT training_sessions_program_fk
            FOREIGN KEY (training_program_id) REFERENCES training_programs(id) ON DELETE SET NULL;
    END IF;
END $$;

-- CHECK session_type — drop ancienne contrainte si existe, recrée
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_sessions_type_check') THEN
        ALTER TABLE training_sessions DROP CONSTRAINT training_sessions_type_check;
    END IF;
    ALTER TABLE training_sessions ADD CONSTRAINT training_sessions_type_check
        CHECK (session_type IN ('video','visio','libre','autre'));
END $$;

-- Étend les statuts pour accepter 'prepared' (séance créée mais pas démarrée)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'training_sessions_status_check') THEN
        ALTER TABLE training_sessions DROP CONSTRAINT training_sessions_status_check;
    END IF;
    ALTER TABLE training_sessions ADD CONSTRAINT training_sessions_status_check
        CHECK (status IN ('prepared','in_progress','completed','interrupted','cancelled'));
END $$;

CREATE INDEX IF NOT EXISTS idx_training_type    ON training_sessions(session_type);
CREATE INDEX IF NOT EXISTS idx_training_video   ON training_sessions(video_id);
CREATE INDEX IF NOT EXISTS idx_training_program ON training_sessions(training_program_id);

-- Backfill : essaie de deviner le type pour les séances existantes
UPDATE training_sessions
   SET session_type = CASE
     WHEN visio_session_id IS NOT NULL THEN 'visio'
     ELSE 'libre'
   END
 WHERE session_type IS NULL OR session_type = 'libre';

SELECT session_type, status, COUNT(*) AS nb
  FROM training_sessions
  GROUP BY session_type, status
  ORDER BY session_type, status;

COMMIT;

-- Fin migration 007
