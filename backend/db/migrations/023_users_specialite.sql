-- ============================================================
-- 023 — Spécialité des comptes soignants
-- ------------------------------------------------------------
-- Le formulaire de création d'un compte investigateur comporte un champ
-- « Spécialité » (cardiologue, médecin du sport, enseignant en APA…) depuis
-- l'origine. Mais la colonne n'existait pas, et le serveur ne lisait même pas
-- ce champ : la valeur saisie était abandonnée en silence, sans la moindre
-- erreur à l'écran.
--
-- C'est le pire des cas — un champ qui accepte une saisie et la jette. On
-- croit l'information enregistrée, et elle ne l'est pas.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS specialty VARCHAR(200);

SELECT 'OK migration 023 — colonne specialty' AS msg;
