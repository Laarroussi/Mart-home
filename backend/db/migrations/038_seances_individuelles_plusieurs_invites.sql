-- ============================================================
-- Migration 038 — Plusieurs invités par séance individuelle
-- ------------------------------------------------------------
-- La migration 037 ne prévoyait qu'un invité : une colonne `invite_id`, une
-- personne. C'est le cas courant, mais pas le seul — un patient accompagné
-- d'un proche, un patient et le confrère qui reprend son suivi, deux patients
-- qui travaillent ensemble.
--
-- Une colonne ne peut pas porter deux valeurs. On passe donc à une table
-- d'invités, ce qui ne change rien au cas à une personne : une séance, une
-- ligne.
--
-- `invite_id` n'est pas supprimée tout de suite. Ses valeurs sont d'abord
-- recopiées dans la nouvelle table, puis la colonne devient facultative et
-- cesse d'être lue. La supprimer dans la même migration empêcherait de
-- revenir en arrière si quelque chose se passait mal — et les instructions du
-- dépôt demandent des modifications progressives et vérifiables. Elle sera
-- retirée par une migration ultérieure, une fois la bascule constatée.
--
-- IDEMPOTENT — rejouable. PostgreSQL 9.6.
-- ============================================================

CREATE TABLE IF NOT EXISTS seances_individuelles_invites (
    seance_id  INTEGER     NOT NULL REFERENCES seances_individuelles(id) ON DELETE CASCADE,
    user_id    VARCHAR(50) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ajoute_le  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (seance_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_seances_indiv_inv_user ON seances_individuelles_invites(user_id);

-- Reprise des séances déjà créées : aucune ne doit perdre son invité.
INSERT INTO seances_individuelles_invites (seance_id, user_id)
SELECT s.id, s.invite_id
  FROM seances_individuelles s
 WHERE s.invite_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM seances_individuelles_invites i
      WHERE i.seance_id = s.id AND i.user_id = s.invite_id
   );

-- La contrainte « deux personnes différentes » portait sur invite_id : elle
-- n'a plus de sens une fois les invités dans leur propre table, et elle
-- bloquerait une séance dont invite_id est vide.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seances_indiv_deux_personnes') THEN
    ALTER TABLE seances_individuelles DROP CONSTRAINT seances_indiv_deux_personnes;
  END IF;
END $$;

ALTER TABLE seances_individuelles ALTER COLUMN invite_id DROP NOT NULL;

-- Un soignant ne s'invite pas lui-même : la règle demeure, au bon endroit.
-- Une contrainte CHECK ne peut pas lire une autre table ; on passe par un
-- déclencheur, seul moyen en PostgreSQL 9.6 de comparer l'invité au soignant
-- de sa séance.
CREATE OR REPLACE FUNCTION seances_indiv_refuser_soi_meme() RETURNS trigger AS $f$
BEGIN
  IF EXISTS (SELECT 1 FROM seances_individuelles s
              WHERE s.id = NEW.seance_id AND s.soignant_id = NEW.user_id) THEN
    RAISE EXCEPTION 'Le soignant ne peut pas etre invite a sa propre seance';
  END IF;
  RETURN NEW;
END;
$f$ LANGUAGE plpgsql;

-- Un déclencheur se cherche dans pg_trigger, jamais dans pg_constraint : la
-- vérification qui s'y trompe croit l'objet absent et le recrée à chaque
-- passage, ce qui fait échouer la migration la deuxième fois.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'seances_indiv_inv_pas_soi_meme' AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER seances_indiv_inv_pas_soi_meme
      BEFORE INSERT OR UPDATE ON seances_individuelles_invites
      FOR EACH ROW EXECUTE PROCEDURE seances_indiv_refuser_soi_meme();
  END IF;
END $$;

SELECT count(*) AS invites_repris FROM seances_individuelles_invites;
SELECT 'OK migration 038 — plusieurs invites par seance' AS msg;
