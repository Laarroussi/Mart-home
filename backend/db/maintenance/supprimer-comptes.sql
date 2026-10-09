-- ============================================================
-- Suppression de comptes désignés, par adresse
-- ------------------------------------------------------------
-- Pour retirer définitivement de la base les comptes du jeu de données
-- initial : « Dr. Camille Dupont », « Pr. Jean Martin », « Jean Dupont ».
-- Les masquer dans l'interface ne suffit pas — ils restent en base, comptent
-- dans les exports, et figurent dans toute sauvegarde.
--
-- Ce script ne touche QUE des comptes de connexion. Aucun dossier patient
-- n'est concerné : ces trois-là n'en ont aucun.
--
-- ---- À MODIFIER : la liste ci-dessous, et elle seule ----
--
-- ---- Deux garde-fous ----
-- Un compte rattaché à un dossier patient est refusé : le supprimer priverait
-- le patient de son accès sans que rien ne le signale. Archivez-le plutôt.
-- Et le dernier administrateur actif est protégé, pour ne pas se verrouiller
-- dehors.
--
-- SAUVEGARDEZ AVANT (bouton « 💾 Sauvegarde » dans l'interface).
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

DO $$
DECLARE
  -- ↓↓↓ LA SEULE LIGNE À MODIFIER ↓↓↓
  adresses TEXT[] := ARRAY[
    'c.dupont@bichat.fr',
    'j.martin@bichat.fr',
    'jean.dupont.test@example.fr'
  ];
  -- ↑↑↑ ------------------------- ↑↑↑

  cibles TEXT[];
  bloquants TEXT;
  n BIGINT;
BEGIN
  SELECT array_agg(id) INTO cibles
    FROM users WHERE lower(email) = ANY (SELECT lower(a) FROM unnest(adresses) AS a);

  IF cibles IS NULL THEN
    RAISE NOTICE 'Aucun compte ne correspond à ces adresses — rien à faire.';
    RETURN;
  END IF;

  -- Refus : compte rattaché à un dossier patient.
  SELECT string_agg(email || ' (' || patient_id || ')', ', ') INTO bloquants
    FROM users WHERE id = ANY(cibles) AND patient_id IS NOT NULL;
  IF bloquants IS NOT NULL THEN
    RAISE EXCEPTION
      'Ces comptes donnent accès à un dossier patient : %. '
      'Archivez-les depuis Paramètres plutôt que de les supprimer.', bloquants;
  END IF;

  -- Refus : dernier administrateur actif.
  IF EXISTS (SELECT 1 FROM users WHERE id = ANY(cibles) AND role = 'principal_admin')
     AND NOT EXISTS (SELECT 1 FROM users
                      WHERE role = 'principal_admin' AND active
                        AND NOT (id = ANY(cibles))) THEN
    RAISE EXCEPTION 'Suppression refusée : il ne resterait aucun administrateur actif.';
  END IF;

  RAISE NOTICE 'Suppression de % compte(s).', array_length(cibles, 1);

  -- visio_sessions.investigator_id est la seule référence sans règle de
  -- suppression : elle bloquerait l'opération. On la détache explicitement,
  -- comme le font automatiquement les quinze autres.
  UPDATE visio_sessions SET investigator_id = NULL WHERE investigator_id = ANY(cibles);
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN RAISE NOTICE '  séances visio détachées : %', n; END IF;

  DELETE FROM users WHERE id = ANY(cibles);
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Terminé — % compte(s) supprimé(s).', n;
END $$;

SELECT name AS nom, email AS adresse, role AS role,
       COALESCE(patient_id, '—') AS dossier,
       CASE WHEN active THEN 'actif' ELSE 'archivé' END AS etat
  FROM users ORDER BY role, name;
