-- ============================================================
-- Migration 002 — Username automatique + date de naissance + must_change_password
-- ============================================================
-- AJOUTE 3 colonnes à la table users :
--   - username             : login alphanumérique unique (prenom.nom normalisé)
--   - birth_date           : date de naissance (sert à générer le mot de passe initial)
--   - must_change_password : doit changer son mot de passe à la prochaine connexion
--
-- IDEMPOTENT : peut être ré-exécutée sans risque grâce à IF NOT EXISTS.
--
-- Ordre IMPORTANT : on AJOUTE la contrainte UNIQUE AVANT l'UPDATE, car PostgreSQL
-- refuse un ALTER TABLE après un UPDATE dans la même transaction si la table a des
-- événements de triggers en attente. UNIQUE accepte les NULL multiples, donc OK.
--
-- Utilisation :
--   psql "$DBURL" -v ON_ERROR_STOP=1 -f db/migrations/002_username_birthdate_mustchange.sql
-- ============================================================

BEGIN;

-- 1. Ajout des colonnes
ALTER TABLE users ADD COLUMN IF NOT EXISTS username             VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date           DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Contrainte UNIQUE sur username (avant l'UPDATE, donc table = tous NULL pour ce champ)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_username_unique'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
    END IF;
END $$;

-- 3. Index username
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- 4. PUIS l'UPDATE qui remplit les valeurs (split_part de l'email avant @)
--    Pour éviter les collisions improbables (jean.dupont@a.com vs jean.dupont@b.com),
--    on suffixe par l'id du user en cas de besoin. Mais pour les comptes seed actuels,
--    il n'y a pas de collision possible (emails uniques avec préfixes distincts).
UPDATE users
   SET username = split_part(email, '@', 1)
 WHERE username IS NULL;

-- 5. Force must_change_password = FALSE pour les comptes existants (pas de migration forcée)
UPDATE users SET must_change_password = FALSE WHERE must_change_password IS NULL;

-- 6. Vérification finale
SELECT id, role, username, email, must_change_password FROM users ORDER BY role, username;

COMMIT;

-- ============================================================
-- Fin migration 002
-- ============================================================
