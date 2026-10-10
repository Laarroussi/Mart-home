-- ============================================================
-- Migration 032 — Niveau de preuve d'une mesure
-- ------------------------------------------------------------
-- Une valeur aortique peut venir d'un compte rendu d'échocardiographie, d'une
-- consultation retranscrite, ou du champ « dilatation au diagnostic » rempli
-- à la création de la fiche. Jusqu'ici, les trois se ressemblaient : même
-- point, même courbe, même poids dans l'interprétation.
--
-- Ce n'est pas tenable. Le clinicien crée souvent le dossier avant d'avoir les
-- examens sous la main — c'est le fonctionnement normal, pas un défaut. La
-- valeur qu'il saisit alors permet de travailler en attendant. Mais elle n'a
-- pas été mesurée, et la faire passer pour une mesure a déjà produit une
-- dilatation aortique que personne n'avait constatée.
--
-- D'où cette colonne. Deux valeurs seulement, parce qu'une échelle plus fine
-- ne serait pas tenue dans la durée :
--
--   'mesure'   — issue du document de référence de l'examen (echo_reports).
--   'declaree' — rapportée : consultation, document lu, formulaire. Affichée,
--                distinguée à l'écran, remplacée dès qu'une mesure arrive.
--
-- Le remplissage initial déduit le niveau de `source_detail`, déjà renseigné
-- par sync-evaluations. Aucune donnée n'est perdue ni modifiée.
--
-- IDEMPOTENT — pas de BEGIN/COMMIT (phpPgAdmin les rejette).
-- ============================================================

ALTER TABLE evaluations
  ADD COLUMN IF NOT EXISTS niveau_preuve TEXT NOT NULL DEFAULT 'declaree';

-- Reprise de l'existant : seule l'échocardiographie fait foi.
UPDATE evaluations
   SET niveau_preuve = 'mesure'
 WHERE niveau_preuve <> 'mesure'
   AND source_detail IS NOT NULL
   AND source_detail ILIKE '%échocardiographie%';

-- Une évaluation portant un VO2 vient nécessairement d'un fichier d'épreuve
-- d'effort analysé cycle par cycle : c'est une mesure.
UPDATE evaluations
   SET niveau_preuve = 'mesure'
 WHERE niveau_preuve <> 'mesure'
   AND vo2 IS NOT NULL;

-- Garde-fou : la colonne n'accepte que les deux valeurs prévues. Sans cette
-- contrainte, une troisième apparaîtrait un jour dans un correctif pressé, et
-- l'affichage la traiterait silencieusement comme « declaree ».
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evaluations_niveau_preuve_chk') THEN
    ALTER TABLE evaluations
      ADD CONSTRAINT evaluations_niveau_preuve_chk
      CHECK (niveau_preuve IN ('mesure', 'declaree'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_eval_niveau ON evaluations (patient_id, niveau_preuve);

SELECT niveau_preuve, count(*) AS n FROM evaluations GROUP BY niveau_preuve;

SELECT 'OK migration 032 — niveau_preuve' AS msg;
