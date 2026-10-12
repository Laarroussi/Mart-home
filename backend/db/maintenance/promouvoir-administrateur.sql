-- ============================================================
-- Promouvoir un compte au rôle Administrateur principal
-- ------------------------------------------------------------
-- Pourquoi ce script existe.
--
-- Le serveur réserve la création d'un compte investigateur au rôle
-- `principal_admin` : un investigateur ne peut créer que des patients
-- (middleware/auth.js, canManageRole). La règle est saine — on ne veut pas
-- que n'importe quel compte soignant s'octroie des collègues — mais elle
-- suppose qu'au moins une personne porte le rôle d'administrateur.
--
-- L'installation crée bien un compte `u-admin-001` à partir des variables
-- ADMIN_EMAIL / ADMIN_PASSWORD. Ce compte est souvent resté inutilisé, son
-- mot de passe oublié, pendant que le travail réel se faisait depuis un
-- compte investigateur. D'où le blocage : la personne qui pilote l'étude
-- n'a pas les droits de l'administrer.
--
-- Ce script ne crée rien et ne supprime rien. Il change un rôle, et il
-- affiche l'état avant et après pour que le changement soit vérifiable.
--
-- ADRESSE À PROMOUVOIR — c'est la seule ligne à adapter si besoin.
-- Elle est comparée en minuscules, les espaces de bord sont ignorés.
-- ============================================================

-- 1. Qui existe aujourd'hui, côté soignants ? (les patients sont exclus :
--    ils ne sont jamais concernés par ce rôle, et ils sont nombreux)
SELECT id, role, name, username, email, active,
       created_at::date AS cree_le
  FROM users
 WHERE role <> 'patient'
 ORDER BY role, created_at;

-- 2. La promotion elle-même.
DO $$
DECLARE
  cible_email TEXT := 'laarroussi@gmail.com';   -- <<< adresse à promouvoir
  compte      RECORD;
  nb_admins   INT;
BEGIN
  SELECT id, role, name, email INTO compte
    FROM users
   WHERE lower(btrim(email)) = lower(btrim(cible_email))
   LIMIT 1;

  -- On teste FOUND, et non « compte IS NULL ». Sur une variable RECORD non
  -- affectee, lire un champ leve « record is not assigned yet » et le script
  -- s'arreterait sur une erreur technique au lieu d'expliquer le probleme.
  -- FOUND est le seul test fiable apres un SELECT INTO.
  IF NOT FOUND THEN
    RAISE NOTICE '---';
    RAISE NOTICE 'AUCUN COMPTE avec l''adresse « % ».', cible_email;
    RAISE NOTICE 'Regardez le premier tableau ci-dessus : il liste les adresses';
    RAISE NOTICE 'réellement enregistrées. Corrigez la ligne « cible_email »';
    RAISE NOTICE 'de ce fichier, puis relancez. Rien n''a été modifié.';
    RAISE NOTICE '---';
    RETURN;
  END IF;

  IF compte.role = 'principal_admin' THEN
    RAISE NOTICE '% est DEJA Administrateur principal. Rien a changer.', compte.email;
  ELSE
    UPDATE users
       SET role = 'principal_admin'
     WHERE id = compte.id;

    RAISE NOTICE 'PROMU : % (%) passe de « % » a « principal_admin ».',
                 compte.name, compte.email, compte.role;
  END IF;

  -- Garde-fou de relecture : une base sans administrateur actif serait
  -- ingérable, et c'est exactement la situation qu'on vient de corriger.
  SELECT count(*) INTO nb_admins
    FROM users WHERE role = 'principal_admin' AND active = TRUE;
  RAISE NOTICE 'Administrateurs principaux actifs en base : %', nb_admins;
END $$;

-- 3. L'état après coup, à comparer avec le premier tableau.
SELECT id, role, name, username, email, active
  FROM users
 WHERE role <> 'patient'
 ORDER BY role, created_at;
