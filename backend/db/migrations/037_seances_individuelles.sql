-- ============================================================
-- Migration 037 — Séances individuelles
-- ------------------------------------------------------------
-- La plateforme ne connaissait qu'une seule salle de visioconférence, la même
-- pour tout le monde (une constante dans la page). Cela convient à une séance
-- de groupe où chacun sait qui est là. Cela ne convient pas à un entretien
-- individuel : la salle de groupe est ouverte à tous les comptes, et un
-- entretien qui s'y tiendrait serait, de fait, public.
--
-- Chaque séance individuelle reçoit donc SA salle, dérivée d'un jeton tiré au
-- hasard. Le jeton sert aussi de lien à transmettre : qui ne l'a pas ne peut
-- pas deviner le nom de la salle, et qui l'a doit encore être le soignant ou
-- l'invité pour que le serveur lui délivre un jeton de visioconférence.
--
-- `invite_id` référence users, et non patients : l'invité peut être un
-- patient comme un investigateur — un confrère qu'on forme, un collègue qui
-- observe une technique. La table des participants existante ne connaissait
-- que des patients, c'est pourquoi on ne la réutilise pas.
--
-- IDEMPOTENT — rejouable. PostgreSQL 9.6.
-- ============================================================

CREATE TABLE IF NOT EXISTS seances_individuelles (
    id            SERIAL PRIMARY KEY,
    jeton         VARCHAR(64)  NOT NULL UNIQUE,
    salle         VARCHAR(80)  NOT NULL UNIQUE,
    soignant_id   VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_id     VARCHAR(50)  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    titre         VARCHAR(200),
    cree_le       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    -- Une salle ouverte indéfiniment est une porte laissée entrouverte. Le
    -- lien cesse de fonctionner passé cette date, sans qu'on ait à y penser.
    expire_le     TIMESTAMPTZ  NOT NULL,
    ouverte_le    TIMESTAMPTZ,
    close_le      TIMESTAMPTZ,
    statut        VARCHAR(20)  NOT NULL DEFAULT 'ouverte'
                  CHECK (statut IN ('ouverte', 'terminee', 'expiree'))
);

CREATE INDEX IF NOT EXISTS idx_seances_indiv_jeton    ON seances_individuelles(jeton);
CREATE INDEX IF NOT EXISTS idx_seances_indiv_invite   ON seances_individuelles(invite_id, statut);
CREATE INDEX IF NOT EXISTS idx_seances_indiv_soignant ON seances_individuelles(soignant_id, cree_le DESC);

-- Un soignant ne peut pas être son propre invité : une séance à une personne
-- n'en est pas une, et le cas n'a pas de sens clinique.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seances_indiv_deux_personnes') THEN
    ALTER TABLE seances_individuelles ADD CONSTRAINT seances_indiv_deux_personnes
      CHECK (soignant_id <> invite_id);
  END IF;
END $$;

SELECT count(*) AS seances_individuelles_existantes FROM seances_individuelles;
SELECT 'OK migration 037 — seances individuelles' AS msg;
