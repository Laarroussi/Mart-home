-- ============================================================
-- Migration 016 — Comptes-rendus d'échocardiographie (ETT)
-- ============================================================
-- Une ligne = un examen échocardiographique complet.
-- Structure calquée sur les comptes-rendus standardisés AP-HP :
-- en-tête morphologique, mesures aortiques aux 6 niveaux, VG, OG,
-- les 4 valves, puis les paragraphes descriptifs et la conclusion.
--
-- Objectif : une ligne par examen et par patient, comparable d'un
-- patient à l'autre — indispensable pour l'exploitation statistique
-- d'une cohorte. Les mesures restent aussi versées dans
-- medical_timeline pour la vue chronologique du dossier.
--
-- IDEMPOTENT — pas de BEGIN/COMMIT.
-- ============================================================

CREATE TABLE IF NOT EXISTS echo_reports (
  id                    SERIAL PRIMARY KEY,
  patient_id            TEXT NOT NULL,
  exam_date             DATE,
  centre                TEXT,
  operateur             TEXT,              -- responsable du rapport

  -- Morphologie au moment de l'examen
  taille_cm             NUMERIC(5,1),
  poids_kg              NUMERIC(5,1),
  surface_corporelle_m2 NUMERIC(4,2),

  -- ===== AORTE : les 6 niveaux de mesure =====
  anneau_aortique_mm    NUMERIC(5,1),
  sinus_valsalva_mm     NUMERIC(5,1),      -- mesure clé du suivi Marfan
  jonction_sinotub_mm   NUMERIC(5,1),
  aorte_ascendante_mm   NUMERIC(5,1),
  crosse_aortique_mm    NUMERIC(5,1),
  aorte_descendante_mm  NUMERIC(5,1),
  aorte_abdominale_mm   NUMERIC(5,1),
  aorte_max_mm          NUMERIC(5,1),      -- diamètre maximal retenu
  aorte_site_max        TEXT,              -- niveau où le maximum est mesuré

  -- ===== VENTRICULE GAUCHE =====
  divgd_cm              NUMERIC(5,2),      -- diamètre télédiastolique
  divgs_cm              NUMERIC(5,2),      -- diamètre télésystolique
  sivgd_cm              NUMERIC(5,2),      -- septum interventriculaire
  ppvgd_cm              NUMERIC(5,2),      -- paroi postérieure
  fr_teicholz_pct       NUMERIC(5,1),      -- fraction de raccourcissement
  fe_teicholz_pct       NUMERIC(5,1),      -- fraction d'éjection Teicholz
  fevg_bp_pct           NUMERIC(5,1),      -- FEVG biplan (Simpson)
  mvg_g                 NUMERIC(6,1),      -- masse VG
  mvg_ind_g_m2          NUMERIC(6,1),      -- masse VG indexée
  h_sur_r               NUMERIC(4,2),      -- rapport h/R
  vtd_a4c_ml            NUMERIC(6,1),
  vts_a4c_ml            NUMERIC(6,1),
  vtd_a2c_ml            NUMERIC(6,1),
  vts_a2c_ml            NUMERIC(6,1),
  vtd_bp_ml             NUMERIC(6,1),
  vts_bp_ml             NUMERIC(6,1),
  vtd_bp_ind_ml_m2      NUMERIC(6,1),
  vts_bp_ind_ml_m2      NUMERIC(6,1),
  ve_bp_ml              NUMERIC(6,1),      -- volume d'éjection
  ve_bp_ind_ml_m2       NUMERIC(6,1),

  -- ===== OREILLETTE GAUCHE =====
  vts_og_bp_ml          NUMERIC(6,1),
  vts_og_bp_ind_ml_m2   NUMERIC(6,1),

  -- ===== VALVES =====
  vit_pic_e_vm_cm_s     NUMERIC(6,1),      -- mitrale, onde E
  vit_pic_a_vm_cm_s     NUMERIC(6,1),      -- mitrale, onde A
  td_vm_s               NUMERIC(4,2),      -- temps de décélération
  vmax_va_cm_s          NUMERIC(6,1),      -- aortique, vitesse max
  itv_va_cm             NUMERIC(6,1),
  grad_max_va_mmhg      NUMERIC(6,1),
  vmax_it_cm_s          NUMERIC(6,1),      -- tricuspide, vitesse max
  grad_max_it_mmhg      NUMERIC(6,1),

  -- ===== PARAGRAPHES DESCRIPTIFS =====
  vg_texte              TEXT,
  vd_texte              TEXT,
  oreillettes_texte     TEXT,
  valve_mitrale_texte   TEXT,
  valve_tricuspide_texte TEXT,
  valve_aortique_texte  TEXT,
  gros_vaisseaux_texte  TEXT,
  conclusion            TEXT,

  -- ===== TRAÇABILITÉ =====
  source_doc_id         INTEGER,
  source_nom_fichier    TEXT,
  confiance             NUMERIC(3,2),
  statut                TEXT NOT NULL DEFAULT 'valide',   -- valide | a_verifier
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by            TEXT
);

CREATE INDEX IF NOT EXISTS idx_echo_patient ON echo_reports (patient_id);
CREATE INDEX IF NOT EXISTS idx_echo_date    ON echo_reports (exam_date DESC NULLS LAST);

-- Antécédent chirurgical aortique : information à afficher en évidence
ALTER TABLE patients ADD COLUMN IF NOT EXISTS aorte_operee BOOLEAN;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS aorte_operee_date DATE;
ALTER TABLE patients ADD COLUMN IF NOT EXISTS aorte_operee_type TEXT;
