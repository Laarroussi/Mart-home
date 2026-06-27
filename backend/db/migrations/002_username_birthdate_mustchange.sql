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
-- Utilisation :
--   psql "$DBURL" -v ON_ERROR_STOP=1 -f db/migrations/002_username_birthdate_mustchange.sql
-- ============================================================

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS username             VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date           DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- Pour les comptes existants : username = partie locale de l'email (avant @)
-- (on évite NULL pour pouvoir mettre la contrainte UNIQUE)
UPDATE users
   SET username = split_part(email, '@', 1)
 WHERE username IS NULL;

-- Contrainte UNIQUE sur username (en ignorant le cas où elle existe déjà)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_username_unique'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_username_unique UNIQUE (username);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Comptes existants : pas obligés de changer (déjà actifs avec mot de passe choisi)
UPDATE users SET must_change_password = FALSE WHERE must_change_password IS NULL;

-- Vérif finale
SELECT id, role, username, email, must_change_password FROM users ORDER BY role, username;

COMMIT;

-- ============================================================
-- Fin migration 002
-- ============================================================
