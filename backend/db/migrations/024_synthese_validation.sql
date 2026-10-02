-- ============================================================
-- 024 — Validation explicite de la synthèse clinique
-- ------------------------------------------------------------
-- Jusqu'ici, une synthèse était simplement « enregistrée ». Rien ne
-- distinguait un brouillon en cours d'écriture d'un document relu et assumé
-- par l'investigateur.
--
-- La différence compte. Une synthèse rédigée avec l'aide d'un modèle de
-- langage puis enregistrée sans relecture n'a pas la même valeur qu'un texte
-- validé par un professionnel. Si cette synthèse est remise à un patient,
-- versée à un dossier ou citée dans une publication, savoir qui l'a validée
-- et quand n'est pas un détail administratif.
--
-- Toute modification ultérieure ramène la synthèse à l'état de brouillon :
-- une validation porte sur un texte précis, pas sur un document qui continue
-- de changer après coup.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

ALTER TABLE syntheses ADD COLUMN IF NOT EXISTS validee BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE syntheses ADD COLUMN IF NOT EXISTS validee_le TIMESTAMPTZ;
ALTER TABLE syntheses ADD COLUMN IF NOT EXISTS validee_par TEXT;
ALTER TABLE syntheses ADD COLUMN IF NOT EXISTS validee_par_nom TEXT;

SELECT 'OK migration 024 — validation de la synthese' AS msg;
