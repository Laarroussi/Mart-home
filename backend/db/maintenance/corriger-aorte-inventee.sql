-- ============================================================
-- Retrait d'une mesure aortique que personne n'a mesurée
-- ------------------------------------------------------------
-- Contexte : l'épreuve d'effort de MRF-003 a été versée dans la zone
-- « Documents & examens », qui envoyait alors le fichier à l'IA pour en
-- extraire du texte. Le modèle a lu le tableau COSMED, y a trouvé des
-- nombres, et en a déduit un « diamètre aortique de 45 mm ». Cette valeur
-- ne figure dans aucun examen : elle a été fabriquée par une lecture de
-- travers, et elle a été écrite dans un dossier clinique.
--
-- C'est pourquoi ce script existe. Une valeur fausse qu'on laisse en base
-- devient une valeur vraie au prochain regard : elle alimente la courbe de
-- suivi aortique, le seuil de 45 mm qui déclenche les alertes, et la
-- synthèse que l'IA rédigera ensuite en s'appuyant dessus.
--
-- ---- Ce que le script fait ----
-- 1. Il montre d'abord la ligne concernée, pour que vous la reconnaissiez.
-- 2. Il efface la mesure aortique SANS toucher au reste de l'évaluation.
--    Si l'évaluation ne contenait que cette valeur — c'est le cas ici, tous
--    les champs d'effort sont vides — la ligne entière est supprimée : une
--    évaluation sans aucune mesure n'a rien à dire.
-- 3. Il refuse d'agir si la valeur a été saisie à la main plus tard
--    (source différente de 'document') : dans ce cas, c'est une vraie mesure.
--
-- ---- À MODIFIER ----
-- Le code patient, et lui seul, sur la ligne marquée.
--
-- SAUVEGARDEZ AVANT (bouton « 💾 Sauvegarde » dans l'interface).
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette. Le bloc DO constitue
-- néanmoins une transaction implicite.
-- ============================================================

-- --- 1. Avant : ce que contient le dossier ---
SELECT id, eval_id, label, eval_date, source,
       aorta AS aorte_mm, vo2, sv1, sv2, watts, fc_max
  FROM evaluations
 WHERE patient_id = 'MRF-003'          -- ← LE CODE PATIENT
 ORDER BY eval_date, id;

DO $$
DECLARE
  -- ↓↓↓ LA SEULE LIGNE À MODIFIER ↓↓↓
  cible TEXT := 'MRF-003';
  -- ↑↑↑ ------------------------- ↑↑↑

  e RECORD;
  vide BOOLEAN;
  effacees INT := 0;
  supprimees INT := 0;
BEGIN
  FOR e IN
    SELECT * FROM evaluations
     WHERE patient_id = cible
       AND aorta IS NOT NULL
       AND source = 'document'
     ORDER BY id
  LOOP
    -- Y a-t-il autre chose à sauver dans cette évaluation ?
    vide := e.vo2 IS NULL AND e.sv1 IS NULL AND e.sv2 IS NULL
        AND e.watts IS NULL AND e.fc_max IS NULL
        AND COALESCE(e.force_kg, 0) = 0;

    IF vide THEN
      DELETE FROM evaluations WHERE id = e.id;
      supprimees := supprimees + 1;
      RAISE NOTICE 'Évaluation % (« % ») supprimée : elle ne contenait que la mesure inventée.',
        e.id, e.label;
    ELSE
      UPDATE evaluations SET aorta = NULL WHERE id = e.id;
      effacees := effacees + 1;
      RAISE NOTICE 'Évaluation % (« % ») : mesure aortique de % mm effacée, le reste est conservé.',
        e.id, e.label, e.aorta;
    END IF;
  END LOOP;

  IF effacees + supprimees = 0 THEN
    RAISE NOTICE 'Aucune mesure aortique issue d''une lecture de document pour % — rien à corriger.', cible;
  ELSE
    RAISE NOTICE 'Terminé : % ligne(s) nettoyée(s), % ligne(s) supprimée(s).', effacees, supprimees;
  END IF;
END $$;

-- --- 2. Après : le dossier tel qu'il est désormais ---
SELECT id, eval_id, label, eval_date, source,
       aorta AS aorte_mm, vo2, sv1, sv2, watts, fc_max
  FROM evaluations
 WHERE patient_id = 'MRF-003'          -- ← LE MÊME CODE PATIENT
 ORDER BY eval_date, id;
