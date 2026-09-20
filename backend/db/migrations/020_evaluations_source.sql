-- ============================================================
-- 020 — Origine des évaluations et synchronisation documentaire
-- ------------------------------------------------------------
-- Jusqu'ici, une évaluation ne pouvait naître que d'une saisie manuelle ou
-- d'un import d'épreuve d'effort. Les mesures lues dans les comptes rendus
-- versés — diamètres aortiques, échocardiographies, consultations —
-- alimentaient le dossier mais restaient absentes des courbes longitudinales.
-- On pouvait donc avoir un diamètre à jour dans la fiche et une courbe qui
-- s'arrêtait deux ans plus tôt.
--
-- La colonne « source » distingue l'origine :
--   'manuel'   : saisie par le clinicien (valeur par défaut, comportement
--                inchangé pour tout l'existant)
--   'cpet'     : import d'une épreuve d'effort
--   'document' : déduite d'une pièce versée au dossier
--
-- L'index unique porte uniquement sur les évaluations d'origine documentaire.
-- Il garantit qu'un même jour ne produit qu'une ligne, quel que soit le
-- nombre de fois où la synchronisation est relancée — et il ne contraint
-- jamais les évaluations saisies à la main, dont plusieurs peuvent
-- légitimement partager une date.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manuel';
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS source_detail TEXT;
ALTER TABLE evaluations ADD COLUMN IF NOT EXISTS maj_le TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_eval_document
  ON evaluations (patient_id, eval_date)
  WHERE source = 'document';

CREATE INDEX IF NOT EXISTS idx_eval_patient_date
  ON evaluations (patient_id, eval_date);

SELECT 'OK migration 020 — origine des evaluations' AS msg;
