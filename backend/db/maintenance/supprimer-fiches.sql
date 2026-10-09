-- ============================================================
-- Suppression de fiches patients désignées une par une
-- ------------------------------------------------------------
-- Pour retirer des fiches d'essai qui ne portent pas le marqueur is_demo :
-- créées à la main pendant la mise au point, elles sont indiscernables des
-- vraies pour la base, et seul vous savez lesquelles sont des essais.
--
-- D'où le choix d'une liste explicite plutôt que d'une règle automatique :
-- deviner qu'une fiche est un essai à son code ou à son adresse marcherait
-- neuf fois sur dix, et la dixième effacerait un patient réel.
--
-- ---- À MODIFIER : la liste ci-dessous, et elle seule ----
-- Écrivez les codes exacts, séparés par des virgules.
--
-- Attention : supprimer une fiche efface TOUT ce qui s'y rattache —
-- évaluations, consultations, synthèses, bilans, et le compte de connexion
-- du patient. C'est définitif.
--
-- SAUVEGARDEZ AVANT (bouton « 💾 Sauvegarde » dans l'interface).
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

DO $$
DECLARE
  -- ↓↓↓ LA SEULE LIGNE À MODIFIER ↓↓↓
  cibles TEXT[] := ARRAY['MRF-TEST1', 'MRF-021'];
  -- ↑↑↑ ------------------------- ↑↑↑

  t RECORD;
  n BIGINT;
  total BIGINT := 0;
  absentes TEXT[];
BEGIN
  -- On refuse d'agir si un code n'existe pas : une faute de frappe doit
  -- arrêter l'opération, pas la faire porter sur une liste incomplète.
  SELECT array_agg(c) INTO absentes
    FROM unnest(cibles) AS c
   WHERE NOT EXISTS (SELECT 1 FROM patients p WHERE p.id = c);
  IF absentes IS NOT NULL THEN
    RAISE EXCEPTION 'Code(s) introuvable(s) : %. Rien n''a été supprimé.',
      array_to_string(absentes, ', ');
  END IF;

  RAISE NOTICE 'Suppression de % fiche(s) : %',
    array_length(cibles, 1), array_to_string(cibles, ', ');

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

SELECT id, categorie,
       COALESCE(civil->>'lastName', '—') AS nom,
       created_at::date AS cree_le
  FROM patients ORDER BY categorie, created_at, id;
