-- ============================================================
-- Suppression des patients de démonstration
-- ------------------------------------------------------------
-- Miroir exact de reset-reels.sql, mais dans l'autre sens : efface les
-- patients marqués is_demo, et conserve les patients réels.
--
-- À lancer quand la plateforme passe en usage réel. Les vingt fiches de
-- démonstration occupent MRF-001 à MRF-020 : tant qu'elles sont là, le
-- prochain code attribué est MRF-021 et les premiers vrais patients portent
-- des numéros qui laissent croire à vingt inclusions antérieures.
--
-- Les comptes de connexion rattachés à ces fiches partent avec elles : ils
-- n'ont jamais servi à personne.
--
-- La liste des tables n'est pas écrite à la main. Une partie déclare une clé
-- étrangère en cascade, une autre non — les migrations récentes stockent
-- patient_id en texte sans contrainte. On interroge donc le catalogue, et une
-- table ajoutée plus tard sera traitée sans que personne ait à y penser.
--
-- SAUVEGARDEZ AVANT (bouton « 💾 Sauvegarde » dans l'interface).
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

DO $$
DECLARE
  cibles TEXT[];
  t RECORD;
  n BIGINT;
  total BIGINT := 0;
BEGIN
  SELECT array_agg(id) INTO cibles FROM patients WHERE COALESCE(is_demo, FALSE);

  IF cibles IS NULL OR array_length(cibles, 1) IS NULL THEN
    RAISE NOTICE 'Aucun patient de démonstration — rien à faire.';
    RETURN;
  END IF;

  RAISE NOTICE 'Suppression de % fiche(s) de démonstration…', array_length(cibles, 1);

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
    EXECUTE format('DELETE FROM %I WHERE patient_id = ANY($1)', t.table_name) USING cibles;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE '  % : % ligne(s)', rpad(t.table_name, 28), n;
      total := total + n;
    END IF;
  END LOOP;

  DELETE FROM patients WHERE id = ANY(cibles);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Terminé — % ligne(s) rattachées + % fiche(s).', total, n;
END $$;

SELECT 'Patients restants' AS objet,
       COUNT(*) FILTER (WHERE COALESCE(is_demo, FALSE))::text     AS demonstration,
       COUNT(*) FILTER (WHERE NOT COALESCE(is_demo, FALSE))::text AS reels
  FROM patients;

SELECT id, categorie, created_at::date AS cree_le
  FROM patients ORDER BY categorie, created_at;
