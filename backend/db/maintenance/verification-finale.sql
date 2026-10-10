-- ============================================================
-- Vérification de bout en bout — lecture seule
-- ------------------------------------------------------------
-- À lancer APRÈS avoir versé un vrai fichier d'épreuve d'effort et un vrai
-- compte rendu d'échocardiographie. Ne modifie rien.
--
-- Chaque requête répond à une question qu'on se poserait de toute façon,
-- et à laquelle « ça a l'air de marcher » n'est pas une réponse : la donnée
-- est-elle arrivée jusqu'en base, complète, au bon endroit, et reliée au
-- reste ?
--
--   node /tmp/runsql.js db/maintenance/verification-finale.sql
-- ============================================================

-- ============================================================
-- 1. Les sept migrations ont-elles laissé leurs traces ?
-- ============================================================
SELECT 'evaluations.niveau_preuve (032)' AS verification,
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='evaluations' AND column_name='niveau_preuve')
            THEN 'OK' ELSE '✗ MANQUANTE' END AS etat
UNION ALL SELECT 'echo_reports.z_score_sinus (033)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='echo_reports' AND column_name='z_score_sinus')
            THEN 'OK' ELSE '✗ MANQUANTE' END
UNION ALL SELECT 'echo_reports.e_prime_septal_cm_s (033)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='echo_reports' AND column_name='e_prime_septal_cm_s')
            THEN 'OK' ELSE '✗ MANQUANTE' END
UNION ALL SELECT 'aortic_followup sans current_* (034)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM medical_records
              WHERE aortic_followup ? 'current_value_mm')
            THEN 'OK' ELSE '✗ RECOPIE ENCORE PRESENTE' END
UNION ALL SELECT 'training_sessions.modalite (035)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='training_sessions' AND column_name='modalite')
            THEN 'OK' ELSE '✗ MANQUANTE' END
UNION ALL SELECT 'training_program_patients.seances_par_semaine (035)',
       CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='training_program_patients' AND column_name='seances_par_semaine')
            THEN 'OK' ELSE '✗ MANQUANTE' END;

-- ============================================================
-- 2. L'épreuve d'effort est-elle arrivée complète ?
-- ------------------------------------------------------------
-- Une évaluation portant un VO2 mais pas de seuils signifierait que le
-- fichier a été lu sans être analysé : le défaut exact qu'on a corrigé.
-- ============================================================
SELECT patient_id, eval_date, niveau_preuve,
       vo2        AS vo2_ml_kg_min,
       watts, fc_max,
       thresholds->>'natureVo2'     AS nature,
       thresholds->>'vo2PctPredit'  AS pct_predit,
       thresholds->>'sv1Fc'         AS sv1_fc,
       thresholds->>'sv2Fc'         AS sv2_fc,
       thresholds->>'veVco2Pente'   AS ve_vco2,
       thresholds->>'poulsO2'       AS pouls_o2,
       thresholds->>'hrr1'          AS hrr1,
       CASE WHEN thresholds->>'sv1Fc' IS NULL THEN '✗ seuils absents : fichier non analysé'
            WHEN thresholds->>'zones' IS NULL THEN '⚠ zones d''entraînement absentes'
            ELSE 'OK' END AS controle
  FROM evaluations WHERE vo2 IS NOT NULL ORDER BY patient_id, eval_date;

-- Le fichier source est-il conservé ? Une mesure sans sa pièce justificative
-- n'est pas vérifiable.
SELECT patient_id, exam_type, exam_date, file_name,
       CASE WHEN raw_file IS NULL THEN '✗ fichier source non conservé' ELSE 'OK' END AS fichier,
       CASE WHEN parsed_summary ? 'vo2_pic_ml_kg_min' THEN 'OK' ELSE '⚠ analyse absente' END AS analyse
  FROM medical_exams ORDER BY patient_id, exam_date;

-- ============================================================
-- 3. L'échocardiographie est-elle arrivée complète ?
-- ============================================================
SELECT patient_id, exam_date,
       sinus_valsalva_mm, aorte_max_mm, aorte_site_max,
       z_score_sinus, z_score_reference,
       fevg_bp_pct, fevg_methode, gls_pct,
       e_prime_septal_cm_s, e_prime_lateral_cm_s,
       aorte_systole_mm, aorte_diastole_mm, pa_systolique_mmhg,
       CASE WHEN sinus_valsalva_mm IS NULL THEN '✗ sinus de Valsalva absent'
            WHEN z_score_sinus IS NOT NULL AND z_score_reference IS NULL
                 THEN '⚠ Z-score sans référentiel : non interprétable'
            ELSE 'OK' END AS controle
  FROM echo_reports ORDER BY patient_id, exam_date;

-- ============================================================
-- 4. La projection suit-elle ses origines ?
-- ------------------------------------------------------------
-- Une mesure d'écho doit produire une évaluation de niveau « mesure ». Si
-- elle reste « declaree », la chaîne de provenance est rompue.
-- ============================================================
SELECT e.patient_id, e.exam_date,
       e.sinus_valsalva_mm AS mesure_echo,
       v.aorta             AS point_de_courbe,
       v.niveau_preuve,
       CASE WHEN v.id IS NULL THEN '✗ aucune évaluation créée pour cette écho'
            WHEN v.niveau_preuve <> 'mesure' THEN '✗ niveau incorrect : devrait être « mesure »'
            WHEN v.aorta IS DISTINCT FROM e.sinus_valsalva_mm THEN '⚠ valeur divergente'
            ELSE 'OK' END AS controle
  FROM echo_reports e
  LEFT JOIN evaluations v
    ON v.patient_id = e.patient_id AND v.eval_date = e.exam_date
 ORDER BY e.patient_id, e.exam_date;

-- ============================================================
-- 5. Reste-t-il des incohérences connues ?
-- ============================================================
SELECT 'valeurs aortiques invraisemblables' AS controle,
       COALESCE(string_agg(patient_id || ' : ' || valeur || ' mm' ||
                COALESCE(' (' || site || ')', ' (site non renseigné)'), ' · '), 'aucune') AS detail
  FROM (
    SELECT patient_id,
           (aortic_followup->>'first_value_mm')::numeric AS valeur,
           aortic_followup->>'first_site' AS site
      FROM medical_records WHERE aortic_followup->>'first_value_mm' IS NOT NULL
    UNION ALL
    SELECT patient_id, aortic_value_mm, aortic_site
      FROM consultations WHERE aortic_value_mm IS NOT NULL
  ) t
 WHERE (COALESCE(site, '') ILIKE '%anneau%' AND valeur < 14)
    OR (COALESCE(site, '') NOT ILIKE '%anneau%' AND valeur < 25)
    OR valeur > 90;

SELECT 'consultations en double' AS controle,
       COALESCE(string_agg(patient_id || ' le ' || consultation_date, ' · '), 'aucune') AS detail
  FROM (SELECT patient_id, consultation_date FROM consultations
         GROUP BY patient_id, consultation_date, aortic_value_mm,
                  COALESCE(aortic_site,''), COALESCE(comment,'')
        HAVING count(*) > 1) d;

SELECT 'faits de chronologie répétés le même jour' AS controle,
       COALESCE(string_agg(DISTINCT patient_id || ' : ' || label, ' · '), 'aucun') AS detail
  FROM (SELECT patient_id, label FROM medical_timeline
         GROUP BY patient_id, label, event_date HAVING count(*) >= 2) r;

-- ============================================================
-- 6. Volumétrie générale
-- ============================================================
SELECT 'patients' AS objet, count(*) AS n FROM patients
UNION ALL SELECT 'evaluations (toutes)',     count(*) FROM evaluations
UNION ALL SELECT '  dont niveau mesure',     count(*) FROM evaluations WHERE niveau_preuve='mesure'
UNION ALL SELECT '  dont portant un VO2',    count(*) FROM evaluations WHERE vo2 IS NOT NULL
UNION ALL SELECT 'echo_reports',             count(*) FROM echo_reports
UNION ALL SELECT 'medical_exams',            count(*) FROM medical_exams
UNION ALL SELECT 'consultations',            count(*) FROM consultations
UNION ALL SELECT 'medical_timeline',         count(*) FROM medical_timeline
UNION ALL SELECT 'training_sessions',        count(*) FROM training_sessions
UNION ALL SELECT 'bilans',                   count(*) FROM bilans;
