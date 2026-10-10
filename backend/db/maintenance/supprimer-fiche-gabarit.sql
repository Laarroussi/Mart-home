-- ============================================================
-- Retrait de la fiche médicale enregistrée sous le code gabarit
-- ------------------------------------------------------------
-- L'audit a fait apparaître une ligne de `medical_records` portant le
-- patient_id « MRF-00YY ». Ce n'est pas un code patient : c'est le modèle
-- affiché en exemple dans le formulaire, enregistré tel quel lors d'un essai.
--
-- Elle porte une valeur aortique de 34 mm qui n'appartient à personne. Tant
-- qu'elle reste en base, elle compte dans les exports, figure dans les
-- sauvegardes, et pourrait un jour être rapprochée d'un vrai patient.
--
-- Le script ne touche qu'aux lignes dont le patient_id n'existe pas dans
-- `patients` ET ressemble à un gabarit. Les deux conditions sont exigées
-- ensemble : un code orphelin mais plausible pourrait être un vrai patient
-- supprimé par erreur, et cela demanderait une récupération, pas un effacement.
--
-- SAUVEGARDEZ AVANT (bouton « 💾 Sauvegarde » dans l'interface).
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

-- --- 1. Avant : ce qui va être retiré ---
SELECT patient_id, aortic_followup->>'first_value_mm' AS valeur,
       created_at::date AS cree_le
  FROM medical_records
 WHERE patient_id ~ '[A-Z]{3}-[0-9]*[A-Z]+[0-9A-Z]*$'
   AND patient_id NOT IN (SELECT id FROM patients);

DO $$
DECLARE
  orphelines TEXT[];
  t RECORD;
  n BIGINT;
  total BIGINT := 0;
BEGIN
  -- Un code gabarit contient des lettres là où un vrai code n'a que des
  -- chiffres : MRF-00YY, OBE-XXX. Le motif ne peut pas atteindre MRF-003.
  SELECT array_agg(DISTINCT patient_id) INTO orphelines
    FROM medical_records
   WHERE patient_id ~ '[A-Z]{3}-[0-9]*[A-Z]+[0-9A-Z]*$'
     AND patient_id NOT IN (SELECT id FROM patients);

  IF orphelines IS NULL THEN
    RAISE NOTICE 'Aucune fiche gabarit — rien à faire.';
    RETURN;
  END IF;

  RAISE NOTICE 'Codes gabarits trouvés : %', array_to_string(orphelines, ', ');

  -- Toutes les tables rattachées, découvertes par le catalogue : une fiche
  -- gabarit a pu laisser des traces ailleurs que dans medical_records.
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
    EXECUTE format('DELETE FROM %I WHERE patient_id = ANY($1)', t.table_name) USING orphelines;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE '  % : % ligne(s)', rpad(t.table_name, 28), n;
      total := total + n;
    END IF;
  END LOOP;

  RAISE NOTICE 'Terminé — % ligne(s) retirée(s).', total;
END $$;

-- --- 2. Après : il ne doit plus rien rester ---
SELECT patient_id, aortic_followup->>'first_value_mm' AS valeur
  FROM medical_records
 WHERE patient_id NOT IN (SELECT id FROM patients);
