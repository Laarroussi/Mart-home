-- ============================================================
-- Migration 014 — Jetons d'activation de compte patient
-- ============================================================
-- Le patient reçoit par e-mail un lien à usage unique contenant
-- un jeton aléatoire. Ce lien lui permet de définir lui-même son
-- mot de passe. Le mot de passe ne transite JAMAIS par e-mail.
--
-- Sécurité :
--   - jeton aléatoire de 32 octets (64 caractères hexadécimaux)
--   - durée de validité limitée (72 h par défaut)
--   - usage unique : used_at est renseigné à la première utilisation
--   - un seul jeton actif par utilisateur (les précédents sont invalidés)
--
-- IDEMPOTENT — pas de BEGIN/COMMIT (incompatibilité phpPgAdmin).
-- ============================================================

CREATE TABLE IF NOT EXISTS activation_tokens (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  patient_id  TEXT,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  TEXT,
  sent_ok     BOOLEAN,
  send_error  TEXT
);

CREATE INDEX IF NOT EXISTS idx_activation_user    ON activation_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_activation_expires ON activation_tokens (expires_at);

-- Journal des envois (traçabilité, sans donnée sensible)
CREATE TABLE IF NOT EXISTS activation_log (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT,
  patient_id TEXT,
  action     TEXT NOT NULL,
  detail     TEXT,
  at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
