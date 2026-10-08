-- ============================================================
-- APERÇU AVANT REMISE À ZÉRO — ne détruit rien
-- ------------------------------------------------------------
-- À exécuter AVANT reset-reels.sql. Il ne fait que compter : combien de
-- patients réels seraient effacés, combien de lignes dans chaque table en
-- dépendent, et ce qui serait conservé.
--
-- Regarder avant d'effacer n'est pas une précaution de principe. Une
-- suppression en base ne s'annule pas, et le seul moment où l'on peut
-- constater qu'on s'apprêtait à effacer le mauvais ensemble, c'est celui-ci.
--
-- Les patients de démonstration (is_demo = TRUE) ne sont jamais touchés, ni
-- par l'aperçu ni par la remise à zéro.
-- ============================================================

SELECT 'PATIENTS' AS objet,
       COUNT(*) FILTER (WHERE NOT COALESCE(is_demo, FALSE))::text AS a_effacer,
       COUNT(*) FILTER (WHERE COALESCE(is_demo, FALSE))::text     AS conserve
  FROM patients;

SELECT 'COMPTES' AS objet,
       COUNT(*) FILTER (WHERE u.patient_id IS NOT NULL
                          AND NOT COALESCE(p.is_demo, FALSE))::text AS a_effacer,
       COUNT(*) FILTER (WHERE u.patient_id IS NULL
                          OR COALESCE(p.is_demo, FALSE))::text      AS conserve
  FROM users u LEFT JOIN patients p ON p.id = u.patient_id;

-- Détail table par table. La liste n'est pas écrite à la main : on interroge
-- le catalogue, pour qu'une table ajoutée plus tard soit prise en compte
-- sans que personne ait à y penser.
DO $$
DECLARE
  t RECORD; n BIGINT; total BIGINT := 0;
BEGIN
  RAISE NOTICE '--- Lignes rattachées à des patients réels ---';
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables x
        ON x.table_schema = c.table_schema AND x.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'patient_id'
       AND x.table_type = 'BASE TABLE'
       AND c.table_name <> 'patients'
     ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'SELECT COUNT(*) FROM %I t WHERE t.patient_id IN
         (SELECT id FROM patients WHERE NOT COALESCE(is_demo, FALSE))',
      t.table_name) INTO n;
    IF n > 0 THEN
      RAISE NOTICE '  % : % ligne(s)', rpad(t.table_name, 28), n;
      total := total + n;
    END IF;
  END LOOP;
  RAISE NOTICE '--- Total : % ligne(s) seraient effacées ---', total;
END $$;

SELECT 'Apercu termine — rien n''a ete modifie.' AS msg;
