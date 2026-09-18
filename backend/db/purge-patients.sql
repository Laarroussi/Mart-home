-- ============================================================
-- PURGE DES DONNÉES PATIENTS — données d'essai uniquement
-- ------------------------------------------------------------
-- Supprime tous les patients et tout ce qui leur est rattaché.
--
-- CONSERVE volontairement :
--   • les comptes principal_admin et investigator (dont le vôtre),
--   • les capsules d'éducation thérapeutique (contenu pédagogique),
--   • les vidéos d'entraînement,
--   • la structure des tables.
--
-- Supprime les comptes de rôle « patient », qui n'ont plus d'objet
-- une fois les fiches effacées.
--
-- L'ordre suit les dépendances. ON DELETE CASCADE couvre la plupart des
-- cas, mais plusieurs tables récentes référencent patient_id en TEXT sans
-- contrainte : elles sont vidées explicitement.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

DELETE FROM syntheses_versions;
DELETE FROM syntheses;
DELETE FROM echo_reports;
DELETE FROM medical_timeline;
DELETE FROM ai_extraction_log;
DELETE FROM consultations;
DELETE FROM medical_records;
DELETE FROM activation_tokens;
DELETE FROM activation_log;
DELETE FROM questionnaire_responses;
DELETE FROM training_samples;
DELETE FROM training_sessions;
DELETE FROM education_records;
DELETE FROM notifications;
DELETE FROM evaluations;
DELETE FROM patients;

-- Comptes de connexion des patients : sans fiche, ils ne servent plus.
DELETE FROM users WHERE role = 'patient';

SELECT 'Purge terminée' AS etape,
       (SELECT COUNT(*) FROM patients) AS patients_restants,
       (SELECT COUNT(*) FROM users)    AS comptes_conserves;
