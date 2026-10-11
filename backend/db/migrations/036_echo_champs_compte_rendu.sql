-- ============================================================
-- Migration 036 — Champs manquants d'un compte rendu ETT réel
-- ------------------------------------------------------------
-- Les colonnes avaient été dessinées d'après un modèle. La lecture d'un
-- compte rendu réel (ETT, AP-HP Bichat, 15/09/2026) montre que plusieurs
-- mesures effectivement rendues n'avaient nulle part où aller.
--
-- Le cas le plus parlant est la CCVG — chambre de chasse du ventricule
-- gauche. Le compte rendu la donne en premier dans la série aortique :
-- « Aorte mesurée au niveau de CCVG : 21 mm, Valsalva à 37 mm… ». Elle était
-- absente. Sans colonne, deux issues : la valeur se perd, ou elle atterrit
-- dans « anneau aortique » — qui n'est pas la même chose. On a vu où mène
-- la seconde : un dossier porte 19 mm de « sinus de Valsalva » qui sont en
-- réalité un anneau.
--
-- Même raisonnement pour le TAPSE, les débits et surfaces valvulaires :
-- une mesure rendue par l'opérateur et sans colonne est une mesure perdue.
--
-- IDEMPOTENT — rejouable. Aucune donnée existante modifiée.
-- ============================================================

-- ===== Aorte : la chambre de chasse, premier niveau du compte rendu =====
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS ccvg_mm NUMERIC(5,2);

-- ===== Ventricule droit =====
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS tapse_mm NUMERIC(5,1);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS vd_texte_dilate BOOLEAN;

-- ===== Oreillette gauche : la surface, rendue à côté du volume =====
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS surface_og_cm2 NUMERIC(5,1);

-- ===== Valve aortique et débits : la série CCVG du compte rendu =====
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS grad_moy_va_mmhg   NUMERIC(6,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS itv_ccvg_cm        NUMERIC(6,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS ve_ccvg_ml         NUMERIC(6,1);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS ve_ccvg_ind_ml_m2  NUMERIC(6,1);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS dc_ccvg_l_min      NUMERIC(5,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS ic_ccvg_l_min_m2   NUMERIC(5,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS sva_itv_cm2        NUMERIC(5,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS sva_itv_ind_cm2_m2 NUMERIC(5,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS ip_pct             NUMERIC(5,1);

-- ===== Pressions de remplissage : le rapport est rendu, on le conserve =====
-- Il reste recalculé à l'affichage depuis E, Ea med et Ea lat. Celui-ci est
-- la valeur telle que l'opérateur l'a écrite : les deux s'affichent côte à
-- côte, et un écart signale une mesure à revérifier.
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS e_sur_ea_moy_rapporte NUMERIC(5,2);

-- ===== Garde-fou =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'echo_ccvg_chk') THEN
    -- Une chambre de chasse hors de 10 à 40 mm n'en est pas une.
    ALTER TABLE echo_reports ADD CONSTRAINT echo_ccvg_chk
      CHECK (ccvg_mm IS NULL OR (ccvg_mm >= 10 AND ccvg_mm <= 40));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'echo_tapse_chk') THEN
    ALTER TABLE echo_reports ADD CONSTRAINT echo_tapse_chk
      CHECK (tapse_mm IS NULL OR (tapse_mm >= 3 AND tapse_mm <= 40));
  END IF;
END $$;

SELECT count(*) AS colonnes_echo_reports
  FROM information_schema.columns WHERE table_name = 'echo_reports';

SELECT 'OK migration 036 — champs du compte rendu ETT' AS msg;
