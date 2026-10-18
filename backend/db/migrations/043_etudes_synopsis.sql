-- ============================================================
-- Migration 043 — Synopsis d'une étude : schéma, catégorie RIPH, effectif
-- ------------------------------------------------------------
-- Ouvrir une étude donnait jusqu'ici le cahier d'observation : 57 champs de
-- saisie avant la première phrase de science. Ce qu'on veut lire en arrivant,
-- c'est le synopsis — ce qu'on mettrait sur une page devant un comité :
--
--   schema_etude                 observationnelle, cas-témoins, randomisée…
--   categorie_riph               1, 2, 3 ou hors RIPH
--   critere_jugement_principal   la variable sur laquelle l'étude se juge
--   effectif_calcule             le nombre de sujets nécessaires
--   puissance / alpha / effet    les hypothèses qui donnent ce nombre
--   calcul_effectif              la phrase de méthode, reproductible
--
-- Pourquoi séparer `effectif_calcule` de `objectif_inclusions`, qui existe
-- déjà ? Parce que ce ne sont pas les mêmes grandeurs. L'effectif calculé
-- sort du calcul de puissance : il ne bouge pas tant que les hypothèses ne
-- bougent pas. L'objectif d'inclusions est opérationnel : il majore souvent
-- l'effectif calculé pour absorber les perdus de vue, et il se révise. Les
-- confondre dans une seule colonne fait perdre la trace de l'un ou de
-- l'autre, et on ne sait plus si 24 est le nombre requis ou le nombre visé.
--
-- `puissance` et `alpha` sont stockés en fractions (0.80, 0.05), pas en
-- pourcentages : c'est la forme sous laquelle ils entrent dans les formules,
-- et la contrainte CHECK interdit qu'un 80 saisi par mégarde passe pour une
-- puissance de 8000 %.
--
-- La catégorie RIPH n'est pas décorative : elle détermine le circuit
-- réglementaire (CPP seul, CPP + ANSM, ou simple conformité à une méthodologie
-- de référence). L'écrire dans la fiche évite de la redécouvrir au dépôt.
--
-- IDEMPOTENT — rejouable. PostgreSQL 9.6.
-- ============================================================

ALTER TABLE etudes ADD COLUMN IF NOT EXISTS schema_etude VARCHAR(48);
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS categorie_riph VARCHAR(12);
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS critere_jugement_principal TEXT;
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS criteres_secondaires TEXT;
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS population_cible TEXT;
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS effectif_calcule INTEGER;
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS puissance NUMERIC(4,3);
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS alpha NUMERIC(4,3);
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS taille_effet TEXT;
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS calcul_effectif TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'etudes_riph_connue') THEN
    ALTER TABLE etudes ADD CONSTRAINT etudes_riph_connue
      CHECK (categorie_riph IS NULL
             OR categorie_riph IN ('riph1', 'riph2', 'riph3', 'hors_riph'));
  END IF;

  -- Une puissance de 0 ou de 1 n'existe pas, un alpha de 0 non plus : ces
  -- bornes attrapent le 80 saisi à la place de 0,80.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'etudes_puissance_fraction') THEN
    ALTER TABLE etudes ADD CONSTRAINT etudes_puissance_fraction
      CHECK (puissance IS NULL OR (puissance > 0 AND puissance < 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'etudes_alpha_fraction') THEN
    ALTER TABLE etudes ADD CONSTRAINT etudes_alpha_fraction
      CHECK (alpha IS NULL OR (alpha > 0 AND alpha < 1));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'etudes_effectif_positif') THEN
    ALTER TABLE etudes ADD CONSTRAINT etudes_effectif_positif
      CHECK (effectif_calcule IS NULL OR effectif_calcule > 0);
  END IF;
END $$;

-- On ne devine ni le schéma ni la catégorie des études déjà saisies : une
-- colonne vide se lit « à renseigner », une colonne remplie au hasard se lit
-- comme une décision prise. Rien n'est rétro-rempli ici.

SELECT id, intitule, schema_etude, categorie_riph, effectif_calcule
  FROM etudes ORDER BY id;
SELECT 'OK migration 043 — synopsis des etudes' AS msg;
