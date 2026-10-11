-- ============================================================
-- Quelles migrations ont reellement ete appliquees ?
-- ------------------------------------------------------------
-- `pieces_patients` manquait : la migration 022 echouait sur un mot reserve
-- de PostgreSQL, et la 010 contenait un BEGIN/COMMIT que le client rejette.
-- Ni l'une ni l'autre n'avait jamais tourne, et personne ne s'en etait
-- apercu : rien ne tenait la liste de ce qui avait ete applique. On le
-- decouvrait au moment ou une requete echouait, c'est-a-dire trop tard.
--
-- Ce script sonde, pour chaque migration, la table, la colonne ou l'index
-- qu'elle cree — ou, pour celles qui suppriment, l'absence de ce qu'elles
-- ont retire. Lecture seule.
-- ============================================================

SELECT verification, etat FROM (VALUES
  ('001_consolidate_roles', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('002_username_birthdate_mustchange', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='username') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('003_videos_and_assignments', CASE WHEN to_regclass('public.videos') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('004_visio_enrichment', CASE WHEN to_regclass('public.visio_participants') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('005_training_sessions', CASE WHEN to_regclass('public.training_sessions') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('006_training_programs', CASE WHEN to_regclass('public.training_programs') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('007_training_sessions_enriched', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='training_sessions' AND column_name='session_type') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('008_questionnaires', CASE WHEN to_regclass('public.questionnaire_responses') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('009_medical_exams', CASE WHEN to_regclass('public.medical_exams') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('010_medex_graph_config', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='medical_exams' AND column_name='graph_config') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('011_medical_record', CASE WHEN to_regclass('public.medical_records') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('012_demo_mode', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='is_demo') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('013_aortic_consultations', CASE WHEN to_regclass('public.consultations') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('014_activation_tokens', CASE WHEN to_regclass('public.activation_tokens') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('015_medical_timeline', CASE WHEN to_regclass('public.medical_timeline') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('016_echo_reports', CASE WHEN to_regclass('public.echo_reports') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('017_syntheses', CASE WHEN to_regclass('public.syntheses') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('019_entretiens', CASE WHEN to_regclass('public.entretiens') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('020_evaluations_source', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluations' AND column_name='source') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('021_audit_donnees', CASE WHEN to_regclass('public.audit_donnees') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('022_pieces_patients', CASE WHEN to_regclass('public.pieces_patients') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('023_users_specialite', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='specialty') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('024_synthese_validation', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='syntheses' AND column_name='validee') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('025_capsules_education', CASE WHEN to_regclass('public.education_capsules') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('026_bilans', CASE WHEN to_regclass('public.bilans') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('027_etudes', CASE WHEN to_regclass('public.etudes') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('028_etude_demo', CASE WHEN to_regclass('public.etudes') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('029_categories', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='patients' AND column_name='categorie') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('030_questionnaires_libres', CASE WHEN to_regclass('public.ql_questionnaires') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('031_emails_minuscules', CASE WHEN to_regclass('public.uq_users_email_minuscules') IS NOT NULL THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('032_niveau_preuve', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='evaluations' AND column_name='niveau_preuve') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('033_echo_complements', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='echo_reports' AND column_name='z_score_sinus') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('034_aorte_source_unique', CASE WHEN NOT EXISTS (SELECT 1 FROM medical_records WHERE aortic_followup ? 'current_value_mm') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('035_seances_modalite_assiduite', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='training_sessions' AND column_name='modalite') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END),
  ('036_echo_champs_compte_rendu', CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='echo_reports' AND column_name='ccvg_mm') THEN 'appliquee' ELSE '*** NON APPLIQUEE ***' END)
) AS t(verification, etat) ORDER BY verification;
