-- ============================================================
-- Quelles migrations ont réellement été appliquées ?
-- ------------------------------------------------------------
-- `pieces_patients` manquait : la migration 022 n'avait jamais tourné,
-- et personne ne s'en était aperçu. Rien ne tenait la liste de ce qui
-- avait été appliqué — on le découvrait au moment où une requête
-- échouait, c'est-à-dire trop tard.
--
-- Ce script sonde, pour chaque migration, la table ou la colonne
-- qu'elle crée. Lecture seule.
-- ============================================================

SELECT verification, etat FROM (VALUES
  ('002_username_birthdate_mustchange', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='username') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('003_videos_and_assignments', CASE WHEN to_regclass('public.videos') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('004_visio_enrichment', CASE WHEN to_regclass('public.visio_participants') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('005_training_sessions', CASE WHEN to_regclass('public.training_sessions') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('006_training_programs', CASE WHEN to_regclass('public.training_programs') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('007_training_sessions_enriched', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='training_sessions' AND column_name='session_type') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('008_questionnaires', CASE WHEN to_regclass('public.questionnaire_responses') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('009_medical_exams', CASE WHEN to_regclass('public.medical_exams') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('010_medex_graph_config', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='medical_exams' AND column_name='graph_config') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('011_medical_record', CASE WHEN to_regclass('public.medical_records') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('012_demo_mode', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='is_demo') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('013_aortic_consultations', CASE WHEN to_regclass('public.consultations') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('014_activation_tokens', CASE WHEN to_regclass('public.activation_tokens') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('015_medical_timeline', CASE WHEN to_regclass('public.medical_timeline') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('016_echo_reports', CASE WHEN to_regclass('public.echo_reports') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('017_syntheses', CASE WHEN to_regclass('public.syntheses') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('019_entretiens', CASE WHEN to_regclass('public.entretiens') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('020_evaluations_source', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluations' AND column_name='source') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('021_audit_donnees', CASE WHEN to_regclass('public.audit_donnees') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('022_pieces_patients', CASE WHEN to_regclass('public.pieces_patients') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('023_users_specialite', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='specialty') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('024_synthese_validation', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='syntheses' AND column_name='validee') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('026_bilans', CASE WHEN to_regclass('public.bilans') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('027_etudes', CASE WHEN to_regclass('public.etudes') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('029_categories', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='categorie') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('030_questionnaires_libres', CASE WHEN to_regclass('public.ql_questionnaires') IS NOT NULL THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('032_niveau_preuve', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluations' AND column_name='niveau_preuve') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('033_echo_complements', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='echo_reports' AND column_name='z_score_sinus') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('035_seances_modalite_assiduite', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='training_sessions' AND column_name='modalite') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END),
  ('036_echo_champs_compte_rendu', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='echo_reports' AND column_name='ccvg_mm') THEN 'appliquée' ELSE '*** NON APPLIQUÉE ***' END)
) AS t(verification, etat) ORDER BY verification;
