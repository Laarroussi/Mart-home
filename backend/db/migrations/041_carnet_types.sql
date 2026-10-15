-- ============================================================
-- Migration 041 — Trois natures d'entrées dans le carnet
-- ------------------------------------------------------------
-- Le carnet ne connaissait qu'une sorte de ligne : une action à faire. À
-- l'usage, trois choses s'y mélangeaient sans se distinguer :
--
--   tache        ce que je dois faire       « relancer pour la spirométrie »
--   rendez_vous  ce qui est fixé avec qqn   « consultation le 12 à 14 h 30 »
--   prevu        ce qui est attendu         « échocardiographie à 6 mois »
--
-- La différence n'est pas cosmétique. Une tâche se coche quand elle est faite.
-- Un rendez-vous a une heure, et il arrive qu'on s'y rende sans rien avoir à
-- « faire ». Une prévision n'appelle aucune action aujourd'hui : elle sert à
-- voir venir. Les mélanger produisait une liste où l'urgent et l'attendu se
-- ressemblaient, et c'est précisément ce qu'on cherchait à éviter.
--
-- `heure` n'existe que pour les rendez-vous, et reste facultative : un
-- rendez-vous dont on ne connaît pas encore l'heure est un rendez-vous quand
-- même. Vide, elle s'affiche vide — jamais 00:00, qui serait un horaire.
--
-- IDEMPOTENT — rejouable. PostgreSQL 9.6.
-- ============================================================

ALTER TABLE carnet_actions ADD COLUMN IF NOT EXISTS type VARCHAR(12) NOT NULL DEFAULT 'tache';
ALTER TABLE carnet_actions ADD COLUMN IF NOT EXISTS heure TIME;
ALTER TABLE carnet_actions ADD COLUMN IF NOT EXISTS lieu TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carnet_type_connu') THEN
    ALTER TABLE carnet_actions ADD CONSTRAINT carnet_type_connu
      CHECK (type IN ('tache', 'rendez_vous', 'prevu'));
  END IF;
END $$;

-- Les lignes créées avant cette migration sont des tâches : c'est la seule
-- chose qu'on pouvait noter jusqu'ici. On ne devine pas mieux que ça.
UPDATE carnet_actions SET type = 'tache' WHERE type IS NULL;

-- La page lit « ce qui est à faire pour ce patient, par nature ».
CREATE INDEX IF NOT EXISTS idx_carnet_type_patient
  ON carnet_actions(type, patient_id, echeance) WHERE statut = 'a_faire';

SELECT type, count(*) AS lignes FROM carnet_actions GROUP BY type ORDER BY type;
SELECT 'OK migration 041 — types du carnet' AS msg;
