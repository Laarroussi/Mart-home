-- ============================================================
-- 031 — Adresses électroniques en minuscules
-- ------------------------------------------------------------
-- La connexion comparait l'adresse saisie, mise en minuscules, à l'adresse
-- stockée telle quelle. Un compte enregistré avec une capitale — par exemple
-- « Celia@gmail.com » au lieu de « celia@gmail.com » — devenait donc
-- inaccessible : aucune ligne n'était trouvée, et le message « Identifiants
-- invalides » laissait croire à une erreur de mot de passe. Le compte était
-- parfaitement valide ; il était simplement introuvable.
--
-- Le code est corrigé pour comparer en minuscules des deux côtés. Cette
-- migration remet de l'ordre dans les données existantes, pour que la valeur
-- affichée corresponde à ce qui sert à se connecter.
--
-- ---- Pourquoi l'index unique ----
-- Sans lui, rien n'empêche de créer demain « Marie@chu.fr » alors que
-- « marie@chu.fr » existe déjà. Les deux comptes seraient distincts en base
-- mais indiscernables à la connexion, et le code ne saurait pas lequel
-- ouvrir. Une contrainte vaut mieux qu'une convention qu'on oubliera.
--
-- ---- Les doublons éventuels ----
-- Si deux comptes ne diffèrent que par la casse, la mise en minuscules les
-- rendrait identiques et l'index échouerait. On les détecte AVANT et on
-- s'arrête en l'annonçant, plutôt que de choisir à l'aveugle lequel garder :
-- deux comptes qui se ressemblent peuvent appartenir à deux personnes.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

DO $$
DECLARE
  d RECORD;
  n INT := 0;
BEGIN
  -- 1. Refus net en cas de collision
  FOR d IN
    SELECT lower(email) AS adresse, COUNT(*) AS nb
      FROM users WHERE email IS NOT NULL AND email <> ''
     GROUP BY lower(email) HAVING COUNT(*) > 1
  LOOP
    RAISE EXCEPTION
      'Deux comptes ou plus partagent l''adresse % à la casse près. '
      'Corrigez-les dans Paramètres avant de rejouer cette migration.', d.adresse;
  END LOOP;

  -- 2. Normalisation
  UPDATE users
     SET email = lower(trim(email))
   WHERE email IS NOT NULL AND email <> lower(trim(email));
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Adresses normalisées : %', n;
END $$;

-- Les jetons d'activation portent aussi une adresse : elle sert à retrouver
-- le compte et doit suivre la même règle.
UPDATE activation_tokens
   SET email = lower(trim(email))
 WHERE email IS NOT NULL AND email <> lower(trim(email));

-- Unicité insensible à la casse, pour que le défaut ne revienne pas.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_minuscules
  ON users (lower(email)) WHERE email IS NOT NULL AND email <> '';

SELECT 'OK migration 031 — adresses en minuscules' AS msg,
       COUNT(*)::text AS comptes_avec_adresse
  FROM users WHERE email IS NOT NULL AND email <> '';
