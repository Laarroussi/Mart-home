-- ============================================================
-- REMISE À ZÉRO DES PATIENTS RÉELS — DESTRUCTIF ET DÉFINITIF
-- ------------------------------------------------------------
-- Efface tous les patients dont is_demo est faux, et tout ce qui s'y
-- rattache : évaluations, consultations, échocardiographies, chronologie,
-- synthèses, bilans, entretiens, séances, questionnaires, documents, audit,
-- et les comptes de connexion de ces patients.
--
-- CE QUI EST CONSERVÉ :
--   • les patients de démonstration et tout ce qui s'y rattache ;
--   • les comptes administrateur et investigateur ;
--   • les capsules d'éducation thérapeutique, les vidéos, les études
--     cliniques et leurs cahiers, les questionnaires libres.
--
-- ---- Pourquoi la liste des tables n'est pas écrite à la main ----
-- Une partie des tables déclare une clé étrangère avec ON DELETE CASCADE,
-- une autre partie non — les migrations récentes stockent patient_id en
-- texte sans contrainte. Effacer les patients ne suffirait donc pas : il
-- resterait des lignes orphelines dans la moitié des tables, invisibles mais
-- bien présentes dans les exports et les comptages.
-- On interroge le catalogue pour trouver toutes les tables portant une
-- colonne patient_id. Une table ajoutée demain sera prise en compte sans que
-- personne ait à se souvenir de modifier ce fichier.
--
-- ---- Avant de lancer ----
--   1. Faites une sauvegarde (bouton « 💾 Sauvegarde » dans l'interface).
--   2. Lancez reset-reels--apercu.sql et lisez ce qu'il annonce.
--   3. Alors seulement, lancez ce fichier.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette. Le bloc DO constitue
-- néanmoins une transaction implicite — soit tout passe, soit rien.
-- ============================================================

DO $$
DECLARE
  cibles TEXT[];
  t RECORD;
  n BIGINT;
  total BIGINT := 0;
BEGIN
  SELECT array_agg(id) INTO cibles
    FROM patients WHERE NOT COALESCE(is_demo, FALSE);

  IF cibles IS NULL OR array_length(cibles, 1) IS NULL THEN
    RAISE NOTICE 'Aucun patient réel en base — rien à faire.';
    RETURN;
  END IF;

  RAISE NOTICE 'Suppression de % patient(s) réel(s)…', array_length(cibles, 1);

  -- Les dépendances d'abord, les patients ensuite. L'ordre compte pour les
  -- tables qui déclarent une clé étrangère sans cascade : les supprimer
  -- après le patient lèverait une violation de contrainte.
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
    EXECUTE format('DELETE FROM %I WHERE patient_id = ANY($1)', t.table_name)
      USING cibles;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE '  % : % ligne(s) effacée(s)', rpad(t.table_name, 28), n;
      total := total + n;
    END IF;
  END LOOP;

  DELETE FROM patients WHERE id = ANY(cibles);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE '  patients : % ligne(s) effacée(s)', n;
  RAISE NOTICE 'Terminé — % ligne(s) rattachées + % patient(s).', total, n;
END $$;

-- État après coup : c'est ce qu'il faut lire pour vérifier que la bonne
-- chose a été faite.
SELECT 'Patients restants' AS objet,
       COUNT(*) FILTER (WHERE COALESCE(is_demo, FALSE))::text     AS demonstration,
       COUNT(*) FILTER (WHERE NOT COALESCE(is_demo, FALSE))::text AS reels
  FROM patients;

SELECT 'Comptes restants' AS objet, role, COUNT(*)::text AS nb
  FROM users GROUP BY role ORDER BY role;
