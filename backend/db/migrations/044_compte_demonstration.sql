-- ============================================================
-- Migration 044 — Dossier et compte de démonstration
-- ------------------------------------------------------------
-- IDENTIFIANTS DU COMPTE (à utiliser sur la page de connexion)
--
--   Identifiant : demo.patient@marfan-apa.local
--   Mot de passe : Demo-Marfan-FB8NFM
--
-- Le domaine .local n'existe pas : aucun courriel ne partira jamais vers ce
-- compte, et c'est voulu — un compte d'essai ne doit pas pouvoir écrire à
-- une vraie boîte. Si ce dépôt devient public, changez ce mot de passe
-- depuis Paramètres : le hash ci-dessous, lui, ne révèle rien.
-- ------------------------------------------------------------
-- Pourquoi un dossier plutôt qu'un simple compte : un compte patient sans
-- dossier rattaché ne peut rien afficher. La plateforme lit `users.patient_id`
-- partout, et un compte orphelin produit des écrans vides qui ressemblent à
-- des pannes.
--
-- Pourquoi un NOUVEAU drapeau `bac_a_sable` plutôt que le `is_demo` qui
-- existe depuis la migration 012 : parce que les deux ne veulent pas dire la
-- même chose, et le vérifier a évité une erreur.
--
--   is_demo      = jeu de données initial, MASQUÉ par défaut. La liste des
--                  patients est demandée avec ?demo=false, donc un dossier
--                  is_demo n'apparaît pas tant qu'on n'active pas le mode
--                  démo. Un compte d'essai introuvable dans la liste serait
--                  inutilisable.
--   bac_a_sable  = dossier d'essai délibéré, VISIBLE et utilisable, mais
--                  jamais compté : ni dans les totaux, ni dans les moyennes,
--                  ni dans les effectifs d'étude, ni dans les exports.
--
-- La différence entre les deux est exactement la visibilité. Les réunir dans
-- une seule colonne obligerait à choisir entre « je le vois » et « il n'est
-- pas compté », alors qu'on veut les deux.
--
-- Pourquoi `categorie = 'AUT'` alors que l'identifiant commence par DEM :
-- les catégories sont une liste fermée côté code (MRF, OBE, ICA, DT2, TEM,
-- AUT) et en ajouter une ferait apparaître « Démonstration » dans les menus
-- de population réels. L'identifiant DEM-001 porte l'information à lui seul,
-- et le drapeau is_demo fait le travail de filtrage.
--
-- ── Les données ci-dessous sont FICTIVES ────────────────────────────────
-- Elles ne proviennent d'aucun examen. Conformément à REGLES-DONNEES.md,
-- chacune porte sa provenance, et cette provenance dit explicitement qu'elle
-- est fabriquée : `operateur`, `note` et `notes` contiennent la mention
-- « DONNÉES FICTIVES ». Un lecteur qui tomberait sur ces lignes dans un
-- export ne peut pas les prendre pour des mesures.
--
-- Valeurs choisies volontairement banales : un dossier de démonstration aux
-- chiffres spectaculaires sert de référence involontaire, et on finit par
-- comparer un vrai patient à un patient qui n'existe pas.
--
-- IDEMPOTENT — rejouable sans créer de doublon. PostgreSQL 9.6.
-- ============================================================

-- ------------------------------------------------------------
-- 0. Le drapeau « bac à sable »
-- ------------------------------------------------------------
ALTER TABLE patients ADD COLUMN IF NOT EXISTS bac_a_sable BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_patients_bac_a_sable ON patients (bac_a_sable)
  WHERE bac_a_sable;

-- ------------------------------------------------------------
-- 1. Le dossier
-- ------------------------------------------------------------
INSERT INTO patients
  (id, sex, age, gene, aorta, status, status_class, progress, connected,
   risk_factor, risk_comment, alterations, incidents, civil, medical, study,
   is_demo, bac_a_sable, categorie)
VALUES
  ('DEM-001', 'F', 36, NULL,
   -- aorta reste NULL : le diamètre aortique ne vit que dans echo_reports
   -- (migration 034, source unique). Le remplir ici recréerait la seconde
   -- source que cette migration-là avait supprimée.
   NULL,
   'Dossier de démonstration', 'ok', 60, FALSE,
   '', 'Dossier fictif destiné aux essais de l''interface. Aucune donnée réelle.',
   '{}', '{}',
   '{"firstName":"Démo","lastName":"Test","ipp":"DEMO-0001","email":"demo.patient@marfan-apa.local","birthDate":"1990-05-14"}'::jsonb,
   '{}'::jsonb, '{}'::jsonb,
   -- is_demo = FALSE : sinon le dossier disparaît de la liste, demandée avec
   -- ?demo=false. bac_a_sable = TRUE : il est visible, et hors statistiques.
   FALSE, TRUE, 'AUT')
ON CONFLICT (id) DO NOTHING;

-- Si le dossier existait déjà d'un essai précédent, on s'assure des deux
-- drapeaux : ce sont eux qui le rendent visible et le tiennent hors des
-- statistiques.
UPDATE patients SET is_demo = FALSE, bac_a_sable = TRUE WHERE id = 'DEM-001';

-- ------------------------------------------------------------
-- 2. Le compte
-- ------------------------------------------------------------
-- must_change_password = FALSE : contrairement à un vrai patient, ce compte
-- est réutilisé à chaque essai. Forcer le changement de mot de passe à la
-- première connexion le rendrait inutilisable dès le deuxième test.
INSERT INTO users
  (id, role, name, username, email, password_hash, birth_date, patient_id,
   active, must_change_password)
VALUES
  ('u-pat-DEM-001', 'patient', 'Démo Test', 'demo.patient',
   'demo.patient@marfan-apa.local',
   '$2a$10$oXByUR0dTIh/N4OATrBJQuZNs2ueTFBOZxT9wH4C6INdrrtbHhQ5C',
   '1990-05-14', 'DEM-001', TRUE, FALSE)
ON CONFLICT (id) DO UPDATE
  SET password_hash        = EXCLUDED.password_hash,
      active               = TRUE,
      must_change_password = FALSE,
      patient_id           = EXCLUDED.patient_id;

-- ------------------------------------------------------------
-- 3. Une évaluation — FICTIVE
-- ------------------------------------------------------------
-- Pas de colonne `aorta` renseignée ici non plus, pour la même raison qu'au
-- point 1.
INSERT INTO evaluations
  (patient_id, eval_id, label, eval_date, vo2, sv1, sv2, watts, fc_max,
   force_kg, sf36, gpaq, validated, note)
VALUES
  ('DEM-001', 1, 'Évaluation initiale (démonstration)', CURRENT_DATE - 120,
   26.40, 15.80, 21.90, 135, 162, 24.00, 68.00, 1680, TRUE,
   'DONNÉES FICTIVES — dossier de démonstration. Aucune épreuve d''effort n''a été réalisée.')
ON CONFLICT (patient_id, eval_id) DO NOTHING;

-- ------------------------------------------------------------
-- 4. Une échocardiographie — FICTIVE
-- ------------------------------------------------------------
INSERT INTO echo_reports
  (patient_id, exam_date, centre, operateur,
   taille_cm, poids_kg, surface_corporelle_m2,
   anneau_aortique_mm, sinus_valsalva_mm, jonction_sinotub_mm,
   aorte_ascendante_mm, aorte_max_mm, aorte_site_max)
SELECT
  'DEM-001', CURRENT_DATE - 110, 'Démonstration',
  'DONNÉES FICTIVES — compte de démonstration',
  168.0, 61.0, 1.69,
  23.0, 36.0, 28.0, 30.0, 36.0, 'Sinus de Valsalva'
WHERE NOT EXISTS (
  SELECT 1 FROM echo_reports WHERE patient_id = 'DEM-001'
);

-- ------------------------------------------------------------
-- 5. Trois séances d'entraînement — FICTIVES
-- ------------------------------------------------------------
-- Durées et fréquences cardiaques plausibles mais sans relief : ces lignes
-- servent à vérifier qu'un historique s'affiche, pas à illustrer un cas.
INSERT INTO training_sessions
  (patient_id, started_at, ended_at, duration_s, status, borg_cr10,
   hr_min, hr_avg, hr_max, energy_total_kcal, belt_connected, notes)
SELECT * FROM (VALUES
  ('DEM-001', NOW() - INTERVAL '21 days', NOW() - INTERVAL '21 days' + INTERVAL '42 minutes', 2520, 'completed', 4,  78,  104.0, 128, 182.0, FALSE, 'DONNÉES FICTIVES — démonstration.'),
  ('DEM-001', NOW() - INTERVAL '14 days', NOW() - INTERVAL '14 days' + INTERVAL '45 minutes', 2700, 'completed', 5,  80,  109.0, 131, 201.0, FALSE, 'DONNÉES FICTIVES — démonstration.'),
  ('DEM-001', NOW() - INTERVAL  '7 days', NOW() - INTERVAL  '7 days' + INTERVAL '48 minutes', 2880, 'completed', 4,  76,  106.0, 126, 207.0, FALSE, 'DONNÉES FICTIVES — démonstration.')
) AS s(patient_id, started_at, ended_at, duration_s, status, borg_cr10,
       hr_min, hr_avg, hr_max, energy_total_kcal, belt_connected, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM training_sessions WHERE patient_id = 'DEM-001'
);

-- ------------------------------------------------------------
-- 6. Une prescription, seulement s'il existe déjà un programme
-- ------------------------------------------------------------
-- On ne crée PAS de programme de démonstration : il apparaîtrait dans la
-- liste des programmes réels, et celle-là n'a pas de drapeau is_demo pour
-- l'en écarter. On rattache donc le dossier à un programme existant, ou on
-- ne rattache rien.
DO $$
DECLARE prog INTEGER;
BEGIN
  SELECT id INTO prog FROM training_programs ORDER BY id LIMIT 1;
  IF FOUND THEN
    INSERT INTO training_program_patients (program_id, patient_id)
    VALUES (prog, 'DEM-001')
    ON CONFLICT (program_id, patient_id) DO NOTHING;
    RAISE NOTICE 'Dossier de demonstration rattache au programme %', prog;
  ELSE
    RAISE NOTICE 'Aucun programme existant : pas de prescription pour le dossier de demonstration.';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 7. Tenir le dossier de démonstration hors des statistiques
-- ------------------------------------------------------------
-- `is_demo` n'était appliqué qu'au total de patients de la page d'accueil.
-- Les séances, les heures, les moyennes de FC et de Borg, elles, comptaient
-- tout le monde — donc un dossier d'essai aurait déplacé les moyennes de la
-- cohorte réelle. Deux vues règlent le problème au bon endroit : en base, une
-- fois, plutôt que dans chaque requête qui pourrait l'oublier.
--
-- Le filtre porte sur les DEUX drapeaux. Si un troisième apparaissait un jour,
-- c'est ici qu'il faudrait l'ajouter, et nulle part ailleurs.

-- La vue ne renvoie QUE des identifiants, délibérément. Une vue définie par
-- `SELECT * FROM patients` fige la liste des colonnes au moment de sa
-- création : la prochaine colonne ajoutée à `patients` n'y apparaîtrait pas,
-- et l'export large de la base perdrait cette colonne sans rien signaler.
-- Une liste d'identifiants, elle, ne vieillit pas.
CREATE OR REPLACE VIEW v_dossiers_reels AS
SELECT id FROM patients
 WHERE NOT COALESCE(is_demo, FALSE)
   AND NOT COALESCE(bac_a_sable, FALSE);

CREATE OR REPLACE VIEW v_cohort_overview AS
SELECT
  COUNT(*)                                            AS total_patients,
  COUNT(*) FILTER (WHERE status_class = 'ok')         AS stable_count,
  COUNT(*) FILTER (WHERE status_class = 'watch')      AS watch_count,
  COUNT(*) FILTER (WHERE status_class = 'alert')      AS alert_count,
  ROUND(AVG(progress))                                AS avg_progress
FROM patients
WHERE id IN (SELECT id FROM v_dossiers_reels);

-- ------------------------------------------------------------
-- Vérification
-- ------------------------------------------------------------
-- Les deux totaux doivent différer d'exactement le nombre de dossiers de
-- démonstration : si c'est le cas, le filtre fonctionne.
SELECT (SELECT COUNT(*)::int FROM patients)                       AS dossiers_tous,
       (SELECT total_patients FROM v_cohort_overview)             AS dossiers_comptes,
       (SELECT COUNT(*)::int FROM patients WHERE is_demo)         AS dossiers_seed,
       (SELECT COUNT(*)::int FROM patients WHERE bac_a_sable)     AS dossiers_essai,
       (SELECT COUNT(*)::int FROM training_sessions)              AS seances_toutes,
       (SELECT COUNT(*)::int FROM training_sessions
          WHERE patient_id IN (SELECT id FROM v_dossiers_reels))   AS seances_comptees;

SELECT p.id, p.is_demo, p.bac_a_sable, p.categorie,
       p.civil->>'firstName' AS prenom,
       u.email AS identifiant, u.active, u.must_change_password,
       (SELECT COUNT(*)::int FROM evaluations      e WHERE e.patient_id = p.id) AS evaluations,
       (SELECT COUNT(*)::int FROM echo_reports     r WHERE r.patient_id = p.id) AS echos,
       (SELECT COUNT(*)::int FROM training_sessions t WHERE t.patient_id = p.id) AS seances
  FROM patients p
  LEFT JOIN users u ON u.patient_id = p.id
 WHERE p.id = 'DEM-001';

SELECT 'OK migration 044 — compte de demonstration' AS msg;
