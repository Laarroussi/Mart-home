-- ============================================================
-- Migration 033 — Compléments échocardiographiques
-- ------------------------------------------------------------
-- `echo_reports` couvrait déjà les six niveaux aortiques, le ventricule
-- gauche, l'oreillette et les quatre valves. Manquaient le Z-score, la
-- déformation longitudinale globale, la fonction diastolique tissulaire et
-- les paramètres de paroi aortique.
--
-- ---- Un principe de conception, pas un détail technique ----
-- On enregistre les GRANDEURS MESURÉES, pas les rapports qu'on en tire.
--
-- La distensibilité aortique se calcule à partir de quatre nombres : les
-- diamètres systolique et diastolique, et la pression artérielle du moment.
-- Stocker le seul résultat, c'est perdre la possibilité de le recalculer, de
-- le vérifier, ou de constater qu'il reposait sur une pression relevée à un
-- autre moment de l'examen. Même chose pour E/e' : on garde E, e' septal et
-- e' latéral ; le rapport se recalcule à l'affichage et s'affiche comme
-- calculé.
--
-- C'est la règle posée dans REGLES-DONNEES.md : une donnée enregistrée une
-- seule fois, et la distinction mesuré / calculé tenue jusqu'au bout.
--
-- ---- Le Z-score ne vaut rien sans son référentiel ----
-- Les nomogrammes aortiques (Campens, Devereux, Boston, Gautier) donnent des
-- Z-scores qui diffèrent d'une unité entière pour le même patient. Un Z-score
-- seul n'est pas interprétable. La colonne `z_score_reference` est donc
-- ajoutée en même temps, et l'affichage les montrera ensemble.
--
-- IDEMPOTENT — pas de BEGIN/COMMIT (phpPgAdmin les rejette).
-- Aucune donnée existante n'est modifiée : uniquement des colonnes ajoutées.
-- ============================================================

-- ===== Racine aortique : Z-score et son référentiel =====
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS z_score_sinus      NUMERIC(4,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS z_score_anneau     NUMERIC(4,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS z_score_ascendante NUMERIC(4,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS z_score_reference  TEXT;

-- ===== Paroi aortique : les mesures, pas les rapports =====
-- Diamètres aux deux temps du cycle, et pression artérielle au moment de
-- l'examen. Distensibilité et compliance s'en déduisent à l'affichage.
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS aorte_systole_mm   NUMERIC(5,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS aorte_diastole_mm  NUMERIC(5,2);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS aorte_site_cycle   TEXT;
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS pa_systolique_mmhg  INTEGER;
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS pa_diastolique_mmhg INTEGER;

-- ===== Fonction systolique : déformation longitudinale =====
-- Le GLS est négatif par convention (−20 % est meilleur que −14 %). La
-- colonne accepte donc les négatifs, et l'affichage ne devra pas « corriger »
-- le signe : un GLS affiché en positif se compare à l'envers.
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS gls_pct        NUMERIC(4,1);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS gls_logiciel   TEXT;
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS fevg_methode   TEXT;

-- ===== Fonction diastolique : Doppler tissulaire =====
-- E et A existent déjà (vit_pic_e_vm_cm_s, vit_pic_a_vm_cm_s). On ajoute e'
-- aux deux sites : E/A et E/e' seront calculés, jamais saisis.
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS e_prime_septal_cm_s  NUMERIC(5,1);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS e_prime_lateral_cm_s NUMERIC(5,1);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS paps_mmhg            NUMERIC(5,1);

-- ===== Traçabilité d'un éventuel calcul déjà fait par l'appareil =====
-- Si le compte rendu donne lui-même une distensibilité, on la conserve pour
-- comparaison — sans l'utiliser à la place du calcul. Deux valeurs affichées
-- côte à côte se contrôlent ; une valeur unique ne se contrôle pas.
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS distensibilite_rapportee NUMERIC(6,3);
ALTER TABLE echo_reports ADD COLUMN IF NOT EXISTS compliance_rapportee     NUMERIC(6,3);

-- ===== Garde-fous de vraisemblance =====
-- Une contrainte vaut mieux qu'un contrôle d'interface : elle s'applique
-- aussi aux imports, aux scripts et aux corrections manuelles en base.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'echo_gls_chk') THEN
    -- Un GLS hors de −40 à 0 % n'est pas une déformation longitudinale.
    ALTER TABLE echo_reports ADD CONSTRAINT echo_gls_chk
      CHECK (gls_pct IS NULL OR (gls_pct >= -40 AND gls_pct <= 0));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'echo_aorte_cycle_chk') THEN
    -- Le diamètre systolique ne peut pas être inférieur au diastolique :
    -- l'aorte se dilate à l'éjection. L'inverse signe une inversion de saisie.
    ALTER TABLE echo_reports ADD CONSTRAINT echo_aorte_cycle_chk
      CHECK (aorte_systole_mm IS NULL OR aorte_diastole_mm IS NULL
             OR aorte_systole_mm >= aorte_diastole_mm);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'echo_pa_chk') THEN
    ALTER TABLE echo_reports ADD CONSTRAINT echo_pa_chk
      CHECK (pa_systolique_mmhg IS NULL OR pa_diastolique_mmhg IS NULL
             OR pa_systolique_mmhg > pa_diastolique_mmhg);
  END IF;
END $$;

SELECT count(*) AS colonnes_echo
  FROM information_schema.columns WHERE table_name = 'echo_reports';

SELECT 'OK migration 033 — compléments échocardiographiques' AS msg;
