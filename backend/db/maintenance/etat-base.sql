-- ============================================================
-- État de la base — lecture seule
-- ------------------------------------------------------------
-- À lancer quand on ne sait plus ce qui a été appliqué. Ne modifie rien,
-- ne supprime rien : six questions, six réponses.
--
-- Écrit parce que « je ne sais plus si j'ai fait la 032 » est une question
-- normale après trois jours de travail, et qu'y répondre de mémoire est le
-- meilleur moyen de relancer une opération destructive au mauvais moment.
--
--   node /tmp/runsql.js db/maintenance/etat-base.sql
-- depuis ~/public_html/marfantraining/backend, environnement Node activé.
-- ============================================================

-- 1. Les migrations ont-elles laissé leurs colonnes ?
SELECT 'evaluations.niveau_preuve (032)' AS verification,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'evaluations' AND column_name = 'niveau_preuve')
            THEN 'présente' ELSE 'ABSENTE — migration 032 non appliquée' END AS etat
UNION ALL
SELECT 'patients.categorie (029)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name = 'patients' AND column_name = 'categorie')
            THEN 'présente' ELSE 'ABSENTE' END
UNION ALL
SELECT 'audit_donnees (021)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                          WHERE table_name = 'audit_donnees')
            THEN 'présente' ELSE 'ABSENTE' END;

-- 2. Reste-t-il des fiches sous un code gabarit ?
SELECT 'fiches orphelines (code gabarit)' AS verification,
       COALESCE(string_agg(DISTINCT patient_id, ', '), 'aucune — propre') AS etat
  FROM medical_records
 WHERE patient_id NOT IN (SELECT id FROM patients);

-- 3. Combien de patients, et de quelles populations ?
SELECT COALESCE(categorie, '—') AS population, count(*) AS patients
  FROM patients GROUP BY categorie ORDER BY categorie;

-- 4. Les valeurs aortiques, et leur vraisemblance.
--    Hors de 15–90 mm, c'est une erreur de lecture ou de frappe, pas une mesure.
SELECT patient_id,
       aortic_followup->>'first_value_mm' AS valeur_mm,
       COALESCE(aortic_followup->>'first_site', '— site non renseigné') AS site,
       CASE
         WHEN (aortic_followup->>'first_value_mm')::numeric < 15 THEN 'INVRAISEMBLABLE (trop bas)'
         WHEN (aortic_followup->>'first_value_mm')::numeric > 90 THEN 'INVRAISEMBLABLE (trop haut)'
         WHEN (aortic_followup->>'first_value_mm')::numeric >= 45 THEN 'au seuil chirurgical'
         ELSE 'plausible'
       END AS jugement
  FROM medical_records
 WHERE aortic_followup->>'first_value_mm' IS NOT NULL
 ORDER BY patient_id;

-- 5. Ce que contiennent réellement les évaluations.
SELECT source,
       count(*) AS n,
       count(vo2)    AS avec_vo2,
       count(aorta)  AS avec_aorte,
       count(*) FILTER (WHERE thresholds IS NOT NULL AND thresholds <> '{}'::jsonb) AS avec_seuils
  FROM evaluations GROUP BY source ORDER BY n DESC;

-- 6. Les tables qui alimenteront les écrans à venir.
SELECT 'echo_reports'      AS table_source, count(*) AS lignes FROM echo_reports
UNION ALL SELECT 'medical_exams',      count(*) FROM medical_exams
UNION ALL SELECT 'consultations',      count(*) FROM consultations
UNION ALL SELECT 'medical_timeline',   count(*) FROM medical_timeline
UNION ALL SELECT 'training_sessions',  count(*) FROM training_sessions
UNION ALL SELECT 'bilans',             count(*) FROM bilans;
