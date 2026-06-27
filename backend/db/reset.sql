-- ATTENTION : supprime toutes les données. À utiliser pour repartir de zéro.
DROP TABLE IF EXISTS analyses_files       CASCADE;
DROP TABLE IF EXISTS visio_sessions       CASCADE;
DROP TABLE IF EXISTS notification_log     CASCADE;
DROP TABLE IF EXISTS notifications        CASCADE;
DROP TABLE IF EXISTS education_records    CASCADE;
DROP TABLE IF EXISTS education_capsules   CASCADE;
DROP TABLE IF EXISTS evaluations          CASCADE;
DROP TABLE IF EXISTS users                CASCADE;
DROP TABLE IF EXISTS patients             CASCADE;
DROP VIEW  IF EXISTS v_cohort_overview;
DROP VIEW  IF EXISTS v_education_summary;
