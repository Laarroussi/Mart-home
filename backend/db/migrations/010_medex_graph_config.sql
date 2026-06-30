-- ============================================================
-- Migration 010 — Ajout graph_config aux examens médicaux
-- ============================================================
-- Stocke les positions des curseurs interactifs (SV1, SV2, VO2max) et
-- les zones d'analyse (énergie, coût énergétique) pour les CPET.
-- Permet de rouvrir un examen après validation et de retrouver les
-- curseurs à leur position d'origine.
--
-- Structure attendue de graph_config (JSONB) :
-- {
--   "cursor_sv1_t_s":    455,    // temps SV1 en secondes
--   "cursor_sv2_t_s":    777,    // temps SV2 en secondes
--   "cursor_vo2max_t_s": 1014,
--   "energy_zone_start_s": 0,
--   "energy_zone_end_s":   1014,
--   "cost_zone_start_s":   0,
--   "cost_zone_end_s":     1014,
--   "vo2_status":  "peak",      // 'max' | 'peak' | 'plateau' | 'submaximal' | 'uninterpretable'
--   "has_plateau": false,
--   "comments":    ""
-- }
--
-- IDEMPOTENT.
-- ============================================================

BEGIN;

ALTER TABLE medical_exams ADD COLUMN IF NOT EXISTS graph_config JSONB;

CREATE INDEX IF NOT EXISTS idx_medex_graph_config ON medical_exams ((graph_config IS NOT NULL));

SELECT 'OK migration 010' AS msg;

COMMIT;
-- Fin migration 010
