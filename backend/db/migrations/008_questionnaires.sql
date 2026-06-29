-- ============================================================
-- Migration 008 — Questionnaires validés (SF-36 + GPAQ)
-- ============================================================
-- Table unique pour stocker TOUTES les réponses de questionnaires.
-- raw_answers (JSONB) contient toutes les réponses brutes du patient.
-- scores (JSONB) contient les scores calculés selon les barèmes officiels :
--   - SF-36 : { PF, RP, BP, GH, VT, SF, RE, MH, PCS, MCS, transition }
--   - GPAQ  : { work_metmin, transport_metmin, leisure_metmin, total_metmin,
--               sedentary_min_per_day, activity_level: 'low'|'moderate'|'high' }
--
-- mandatory = true → questionnaire OBLIGATOIRE (créé automatiquement à
--   la création du compte patient ; force le remplissage à la 1re connexion).
--
-- IDEMPOTENT.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS questionnaire_responses (
    id              SERIAL PRIMARY KEY,
    patient_id      VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    questionnaire_type VARCHAR(20) NOT NULL CHECK (questionnaire_type IN ('sf36', 'gpaq')),
    sent_at         TIMESTAMPTZ DEFAULT NOW(),
    sent_by         VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    due_date        DATE,
    completed_at    TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'completed', 'expired', 'cancelled')),
    mandatory       BOOLEAN NOT NULL DEFAULT FALSE,
    raw_answers     JSONB,
    scores          JSONB,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qresp_patient ON questionnaire_responses(patient_id);
CREATE INDEX IF NOT EXISTS idx_qresp_type    ON questionnaire_responses(questionnaire_type);
CREATE INDEX IF NOT EXISTS idx_qresp_status  ON questionnaire_responses(status);
CREATE INDEX IF NOT EXISTS idx_qresp_mandatory ON questionnaire_responses(mandatory);

DROP TRIGGER IF EXISTS set_qresp_updated ON questionnaire_responses;
CREATE TRIGGER set_qresp_updated
    BEFORE UPDATE ON questionnaire_responses
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- Création AUTO d'un SF-36 et d'un GPAQ obligatoire pour chaque patient existant
-- (uniquement si pas déjà présent → ON CONFLICT serait propre mais sans index unique on fait
--  un check via NOT EXISTS)
INSERT INTO questionnaire_responses (patient_id, questionnaire_type, status, mandatory, notes)
SELECT p.id, 'sf36', 'pending', TRUE, 'Auto-créé à l''inclusion (questionnaire à la 1re connexion)'
  FROM patients p
 WHERE NOT EXISTS (
    SELECT 1 FROM questionnaire_responses q
     WHERE q.patient_id = p.id AND q.questionnaire_type = 'sf36' AND q.mandatory = TRUE
 );

INSERT INTO questionnaire_responses (patient_id, questionnaire_type, status, mandatory, notes)
SELECT p.id, 'gpaq', 'pending', TRUE, 'Auto-créé à l''inclusion (questionnaire à la 1re connexion)'
  FROM patients p
 WHERE NOT EXISTS (
    SELECT 1 FROM questionnaire_responses q
     WHERE q.patient_id = p.id AND q.questionnaire_type = 'gpaq' AND q.mandatory = TRUE
 );

SELECT questionnaire_type, status, mandatory, COUNT(*) AS nb
  FROM questionnaire_responses
  GROUP BY questionnaire_type, status, mandatory
  ORDER BY questionnaire_type, status;

COMMIT;
-- Fin migration 008
