-- ============================================================
-- Migration 012 — Mode démonstration
-- ============================================================
-- Ajoute une colonne is_demo aux patients pour distinguer :
--   • Patients de démonstration (données fictives, seed)
--   • Vrais patients (créés via l'interface, réellement inclus)
--
-- L'interface expose un bouton "Mode Démo ON/OFF" qui filtre l'affichage.
-- Les patients déjà présents en BDD sont marqués comme démo par défaut
-- (puisqu'ils viennent du seed initial).
--
-- IDEMPOTENT.
-- NOTE : pas de BEGIN;/COMMIT; car phpPgAdmin ne les supporte pas
--        dans son éditeur SQL (il enveloppe la requête dans un SELECT COUNT).
--        PostgreSQL exécute chaque instruction en autocommit par défaut,
--        les IF NOT EXISTS assurent l'idempotence.
-- ============================================================

-- Ajout de la colonne is_demo (défaut FALSE pour tous les futurs patients)
ALTER TABLE patients ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

-- Marque tous les patients EXISTANTS comme démo (rétrocompatibilité).
-- Nouveaux patients créés après cette migration seront is_demo = FALSE par défaut.
UPDATE patients SET is_demo = TRUE
 WHERE created_at < NOW()
   AND is_demo = FALSE;

-- Index pour filtrer rapidement
CREATE INDEX IF NOT EXISTS idx_patients_is_demo ON patients (is_demo);

SELECT 'OK migration 012 — is_demo colonne ajoutée' AS msg,
       COUNT(*) FILTER (WHERE is_demo) AS nb_demo,
       COUNT(*) FILTER (WHERE NOT is_demo) AS nb_reels
  FROM patients;
-- Fin migration 012
