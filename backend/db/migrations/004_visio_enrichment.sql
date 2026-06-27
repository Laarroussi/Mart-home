-- ============================================================
-- Migration 004 — Enrichissement visio (planification + statut + lien) + table de jointure patients
-- ============================================================
-- AJOUTE à visio_sessions :
--   - scheduled_at        : date/heure prévue
--   - duration_min        : durée prévue en minutes
--   - meeting_link        : URL Jitsi / Zoom / Teams
--   - status              : 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
--   - description         : champ libre
--   - owner_id            : créateur de la séance (peut être différent de investigator_id)
--   - cancelled_at        : date d'annulation
--   - cancelled_by        : qui a annulé
--
-- CRÉE table visio_participants : jointure visio_session × patient
--   (en complément du tableau participants TEXT[] préexistant, pour requêtes "mes séances")
--
-- IDEMPOTENT.
-- ============================================================

BEGIN;

-- 1. Colonnes additionnelles
ALTER TABLE visio_sessions ADD COLUMN IF NOT EXISTS scheduled_at  TIMESTAMPTZ;
ALTER TABLE visio_sessions ADD COLUMN IF NOT EXISTS duration_min  INTEGER;
ALTER TABLE visio_sessions ADD COLUMN IF NOT EXISTS meeting_link  TEXT;
ALTER TABLE visio_sessions ADD COLUMN IF NOT EXISTS description   TEXT;
ALTER TABLE visio_sessions ADD COLUMN IF NOT EXISTS owner_id      VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE visio_sessions ADD COLUMN IF NOT EXISTS cancelled_at  TIMESTAMPTZ;
ALTER TABLE visio_sessions ADD COLUMN IF NOT EXISTS cancelled_by  VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL;

-- 2. Statut (avec CHECK, en plusieurs étapes pour idempotence)
ALTER TABLE visio_sessions ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'scheduled';

-- Drop l'ancienne contrainte si elle existe puis recrée
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'visio_sessions_status_check') THEN
        ALTER TABLE visio_sessions DROP CONSTRAINT visio_sessions_status_check;
    END IF;
    ALTER TABLE visio_sessions ADD CONSTRAINT visio_sessions_status_check
        CHECK (status IN ('scheduled','in_progress','completed','cancelled'));
END $$;

CREATE INDEX IF NOT EXISTS idx_visio_scheduled_at ON visio_sessions(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_visio_status       ON visio_sessions(status);
CREATE INDEX IF NOT EXISTS idx_visio_owner        ON visio_sessions(owner_id);

-- 3. Table de jointure patients × visio
CREATE TABLE IF NOT EXISTS visio_participants (
    id            SERIAL PRIMARY KEY,
    visio_id      INTEGER     NOT NULL REFERENCES visio_sessions(id) ON DELETE CASCADE,
    patient_id    VARCHAR(50) NOT NULL REFERENCES patients(id)       ON DELETE CASCADE,
    invited_at    TIMESTAMPTZ DEFAULT NOW(),
    joined_at     TIMESTAMPTZ,
    UNIQUE(visio_id, patient_id)
);
CREATE INDEX IF NOT EXISTS idx_visio_part_patient ON visio_participants(patient_id);
CREATE INDEX IF NOT EXISTS idx_visio_part_visio   ON visio_participants(visio_id);

-- 4. Backfill : pour les sessions existantes, si participants TEXT[] contient des IDs patient
--    présents dans la table patients, on crée les lignes dans visio_participants.
INSERT INTO visio_participants (visio_id, patient_id)
SELECT v.id, p.id
  FROM visio_sessions v, patients p
 WHERE p.id = ANY(v.participants)
ON CONFLICT (visio_id, patient_id) DO NOTHING;

-- 5. Backfill : owner_id = investigator_id si pas déjà rempli
UPDATE visio_sessions SET owner_id = investigator_id
 WHERE owner_id IS NULL AND investigator_id IS NOT NULL;

-- 6. Pour les sessions existantes terminées (ended_at IS NOT NULL), status = 'completed'
UPDATE visio_sessions SET status = 'completed'
 WHERE ended_at IS NOT NULL AND status = 'scheduled';

-- 7. Vérification finale
SELECT status, COUNT(*) AS nb FROM visio_sessions GROUP BY status ORDER BY status;

COMMIT;

-- ============================================================
-- Fin migration 004
-- ============================================================
