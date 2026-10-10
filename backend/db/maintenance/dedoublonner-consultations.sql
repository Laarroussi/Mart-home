-- ============================================================
-- Consultations enregistrées deux fois
-- ------------------------------------------------------------
-- Un double clic, un retour en arrière du navigateur, un bouton qui ne
-- répond pas assez vite et sur lequel on réappuie : la même consultation se
-- retrouve enregistrée deux fois, à la même date et avec la même mesure.
--
-- Ce n'est pas anodin dans une cohorte de recherche. Deux lignes identiques
-- comptent pour deux : elles pèsent double dans une moyenne, et laissent
-- croire à deux examens là où il n'y en a eu qu'un.
--
-- ---- Ce que le script conserve ----
-- La PREMIÈRE ligne créée (le plus petit id), parce que c'est elle qui porte
-- l'horodatage de l'acte réel. Les suivantes sont des échos du même geste.
--
-- ---- Ce qu'il ne touche pas ----
-- Deux consultations de même date avec des valeurs DIFFÉRENTES : ce peut
-- être une mesure corrigée, ou deux sites mesurés le même jour. Le script
-- les signale et vous laisse trancher — fusionner à votre place reviendrait
-- à choisir laquelle est juste.
--
-- SAUVEGARDEZ AVANT.
-- IDEMPOTENT — rejouable sans effet une fois la base propre.
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

-- --- 1. Les doublons exacts, avant suppression ---
SELECT patient_id, consultation_date, aortic_value_mm,
       count(*) AS exemplaires, array_agg(id ORDER BY id) AS ids
  FROM consultations
 GROUP BY patient_id, consultation_date, aortic_value_mm,
          COALESCE(aortic_site, ''), COALESCE(comment, '')
HAVING count(*) > 1
 ORDER BY patient_id, consultation_date;

-- --- 2. Les cas AMBIGUS, que le script ne touchera pas ---
SELECT patient_id, consultation_date,
       array_agg(DISTINCT aortic_value_mm) AS valeurs_differentes,
       'À trancher à la main' AS remarque
  FROM consultations
 WHERE aortic_value_mm IS NOT NULL
 GROUP BY patient_id, consultation_date
HAVING count(DISTINCT aortic_value_mm) > 1;

DO $$
DECLARE
  n BIGINT;
BEGIN
  -- On ne supprime que les lignes strictement identiques sur tout ce qui a
  -- un sens clinique. COALESCE pour que deux NULL se reconnaissent : en SQL,
  -- NULL ne vaut pas NULL, et sans cela les doublons sans site échappaient
  -- au regroupement.
  WITH classees AS (
    SELECT id,
           row_number() OVER (
             PARTITION BY patient_id, consultation_date, aortic_value_mm,
                          COALESCE(aortic_site, ''), COALESCE(aortic_method, ''),
                          COALESCE(evolution, ''), COALESCE(comment, '')
             ORDER BY id
           ) AS rang
      FROM consultations
  )
  DELETE FROM consultations c
   USING classees x
   WHERE c.id = x.id AND x.rang > 1;
  GET DIAGNOSTICS n = ROW_COUNT;

  IF n = 0 THEN
    RAISE NOTICE 'Aucun doublon exact — rien à supprimer.';
  ELSE
    RAISE NOTICE 'Doublons supprimés : % (la première ligne de chaque groupe est conservée).', n;
  END IF;
END $$;

-- --- 3. Après ---
SELECT patient_id, consultation_date, aortic_value_mm, aortic_site
  FROM consultations ORDER BY patient_id, consultation_date, id;

SELECT patient_id, count(*) AS consultations
  FROM consultations GROUP BY patient_id ORDER BY patient_id;
