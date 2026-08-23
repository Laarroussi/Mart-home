-- ============================================================
-- Migration 013 — Suivi aortique + Consultations chronologiques
-- ============================================================
-- 1. Ajoute le suivi de la dilatation aortique (racine / sinus de Valsalva)
--    dans medical_records : valeur initiale + valeur actuelle
-- 2. Crée la table consultations : une ligne par consultation,
--    historique conservé, jamais écrasé.
--
-- NOTE : pas de BEGIN;/COMMIT; (phpPgAdmin ne les supporte pas).
--        Les IF NOT EXISTS assurent l'idempotence.
-- ============================================================

-- ====== 1. Suivi aortique dans medical_records ======
-- Stocké en JSONB pour rester flexible :
-- {
--   "first_diagnosis_date": "2019-03-15",
--   "first_value_mm": 38.5,
--   "first_site": "Sinus de Valsalva",
--   "current_value_mm": 42.0,
--   "current_date": "2026-08-23",
--   "current_site": "Sinus de Valsalva",
--   "notes": "Progression lente sous bêta-bloquants"
-- }
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS aortic_followup JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ====== 2. Table consultations ======
CREATE TABLE IF NOT EXISTS consultations (
  id                SERIAL PRIMARY KEY,
  patient_id        TEXT NOT NULL,
  consultation_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Mesure aortique du jour (optionnelle)
  aortic_value_mm   NUMERIC(5,2),
  aortic_site       TEXT,          -- ex. 'Sinus de Valsalva', 'Jonction sino-tubulaire', 'Aorte ascendante'
  aortic_method     TEXT,          -- ex. 'ETT', 'Angio-TDM', 'IRM'

  -- Évolution clinique
  evolution         TEXT,          -- 'stable' | 'amelioration' | 'aggravation' | 'non_evaluable'
  evolution_detail  TEXT,          -- texte libre sur l'évolution depuis la dernière consult

  -- Adaptation de la prise en charge
  apa_adaptation    TEXT,          -- adaptation de l'activité physique adaptée
  treatment_change  TEXT,          -- modification thérapeutique éventuelle

  -- Commentaire libre du praticien
  comment           TEXT,

  -- Résumé auto des séances récentes (snapshot au moment de la consultation)
  -- { "sessions_count": 4, "avg_hr": 118, "avg_rpe": 13, "total_duration_min": 145, "last_session": "2026-08-18" }
  sessions_summary  JSONB,

  -- Traçabilité
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by        TEXT,
  updated_at        TIMESTAMPTZ,
  updated_by        TEXT
);

CREATE INDEX IF NOT EXISTS idx_consult_patient ON consultations (patient_id);
CREATE INDEX IF NOT EXISTS idx_consult_date    ON consultations (consultation_date DESC);

SELECT 'OK migration 013 — aortic_followup + table consultations' AS msg;
-- Fin migration 013
