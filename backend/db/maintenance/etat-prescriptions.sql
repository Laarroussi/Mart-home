-- ============================================================
-- Les séances prescrites existent-elles vraiment ? — lecture seule
-- ------------------------------------------------------------
-- « J'ai prescrit des séances à Lili, rien ne s'affiche. » Deux possibilités,
-- et elles n'appellent pas la même correction :
--
--   a) la prescription n'est jamais arrivée en base. L'affichage est alors
--      fidèle : il n'y a rien à montrer. C'est l'enregistrement qu'il faut
--      réparer.
--   b) elle est en base et l'écran ne la lit pas. C'est l'affichage.
--
-- On ne devine pas : on regarde. Le script vérifie aussi que les migrations
-- nécessaires sont passées — une table absente explique tout le reste, et
-- c'est arrivé avec la migration 006, écrite avec un BEGIN/COMMIT qui
-- l'empêchait de s'appliquer sans que rien ne le signale.
-- ============================================================

-- 1. Les tables existent-elles ?
DO $$
DECLARE t TEXT; n BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY['training_programs','training_program_videos',
                           'training_program_patients','training_sessions',
                           'carnet_actions','patient_photos'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE '% : TABLE ABSENTE — migration non appliquee', rpad(t, 28);
    ELSE
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      RAISE NOTICE '% : % ligne(s)', rpad(t, 28), n;
    END IF;
  END LOOP;
END $$;

-- 2. Les colonnes ajoutées par les migrations récentes sont-elles là ?
--    Leur absence est la cause exacte du message « la colonne a.type
--    n'existe pas ».
SELECT 'carnet_actions.type'      AS colonne,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name='carnet_actions' AND column_name='type')      AS presente
UNION ALL SELECT 'carnet_actions.heure',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name='carnet_actions' AND column_name='heure')
UNION ALL SELECT 'patient_photos.vignette',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name='patient_photos' AND column_name='vignette');

-- 3. Les séances prescrites, et à qui.
SELECT p.id, p.title, p.created_at::date AS creee_le, p.archived,
       (SELECT count(*) FROM training_program_videos v WHERE v.program_id = p.id)   AS videos,
       (SELECT count(*) FROM training_program_patients a WHERE a.program_id = p.id) AS patients
  FROM training_programs p
 ORDER BY p.created_at DESC
 LIMIT 20;

-- 4. Qui a reçu quoi — c'est la ligne qui manque quand « rien ne s'affiche ».
SELECT tpp.patient_id, p.title, tpp.assigned_at::date AS attribue_le,
       (SELECT count(*) FROM training_sessions s
         WHERE s.patient_id = tpp.patient_id
           AND s.training_program_id = p.id
           AND s.ended_at IS NOT NULL) AS realisees
  FROM training_program_patients tpp
  JOIN training_programs p ON p.id = tpp.program_id
 ORDER BY tpp.assigned_at DESC
 LIMIT 40;

-- 5. Récapitulatif par patient : prescrites, réalisées, entrées de carnet.
SELECT pa.id AS patient,
       (SELECT count(*) FROM training_program_patients t WHERE t.patient_id = pa.id)         AS prescrites,
       (SELECT count(*) FROM training_sessions s WHERE s.patient_id = pa.id AND s.ended_at IS NOT NULL) AS seances_faites,
       (SELECT count(*) FROM carnet_actions c WHERE c.patient_id = pa.id AND c.statut='a_faire') AS a_faire
  FROM patients pa
 ORDER BY prescrites DESC, pa.id;
