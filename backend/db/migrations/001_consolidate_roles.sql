-- ============================================================
-- Migration 001 — Consolidation des rôles
-- ============================================================
-- AVANT : roles = ('admin', 'principal', 'investigator', 'patient')
-- APRÈS : roles = ('principal_admin', 'investigator', 'patient')
--
-- Logique :
--   admin     → principal_admin (droits maximums)
--   principal → principal_admin (fusion avec admin)
--   investigator → investigator (inchangé)
--   patient   → patient (inchangé)
--
-- Cette migration est IDEMPOTENTE : elle peut être ré-exécutée sans risque.
-- Si elle a déjà été appliquée, les UPDATE ne font rien et l'ALTER CHECK
-- est protégé par DROP IF EXISTS.
--
-- Utilisation sur o2switch :
--   1. Se connecter au terminal cPanel
--   2. cd ~/public_html/marfantraining/backend
--   3. psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/001_consolidate_roles.sql
-- ============================================================

BEGIN;

-- 1. Supprime l'ancienne contrainte CHECK
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. Remappe les rôles existants
UPDATE users SET role = 'principal_admin'
 WHERE role IN ('admin', 'principal');

-- 3. Recrée la contrainte CHECK avec les 3 rôles consolidés
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('principal_admin', 'investigator', 'patient'));

-- 4. Vérification : afficher la répartition des rôles
SELECT role, COUNT(*) AS nb FROM users GROUP BY role ORDER BY role;

COMMIT;

-- ============================================================
-- Fin migration 001
-- ============================================================
