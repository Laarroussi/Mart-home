-- ============================================================
-- Migration 039 — Carnet de suivi : les actions à ne pas oublier
-- ------------------------------------------------------------
-- La base sait déjà consigner ce qui est clinique : `consultations` porte les
-- mesures, `entretiens` les transcriptions validées, `syntheses` les textes
-- rédigés, `medical_timeline` les faits datés extraits des documents.
--
-- Il manquait l'ordinaire du suivi. « Relancer Marc pour sa spirométrie »,
-- « revoir Célia dans trois semaines », « Léa n'a pas fait ses séances, lui
-- écrire ». Ces phrases ne sont ni une mesure ni un compte rendu : elles
-- n'avaient donc aucun endroit où aller, et finissaient sur un papier ou dans
-- une mémoire. Avec vingt patients, la mémoire ne suffit plus — et un suivi
-- oublié ne se voit pas : rien ne signale ce qui n'a pas été fait.
--
-- Le carnet est PARTAGÉ entre investigateurs : un confrère qui reprend un
-- patient doit voir ce qui l'attend. D'où `cree_par` sur chaque ligne — dans
-- une équipe, savoir qui a demandé quoi fait partie de l'information.
--
-- `echeance` peut rester vide. Une action sans date ne revient pas vers vous
-- d'elle-même : elle s'affiche dans une rubrique à part, « sans échéance »,
-- plutôt que de recevoir une date inventée qui la ferait sonner au hasard.
--
-- IDEMPOTENT — rejouable. PostgreSQL 9.6.
-- ============================================================

CREATE TABLE IF NOT EXISTS carnet_actions (
    id          SERIAL PRIMARY KEY,
    -- Facultatif : une action peut concerner l'étude et non un patient
    -- (« commander des ceintures »), et on ne va pas l'attacher de force à
    -- quelqu'un pour satisfaire une contrainte.
    patient_id  TEXT         REFERENCES patients(id) ON DELETE CASCADE,
    texte       TEXT         NOT NULL,
    note        TEXT,
    echeance    DATE,
    statut      VARCHAR(12)  NOT NULL DEFAULT 'a_faire'
                CHECK (statut IN ('a_faire', 'faite', 'annulee')),
    cree_par    VARCHAR(50)  NOT NULL REFERENCES users(id),
    cree_le     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    faite_par   VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
    faite_le    TIMESTAMPTZ,
    motif       TEXT
);

-- Une action vide ne veut rien dire et serait invisible à l'écran.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carnet_texte_non_vide') THEN
    ALTER TABLE carnet_actions ADD CONSTRAINT carnet_texte_non_vide
      CHECK (btrim(texte) <> '');
  END IF;
END $$;

-- La page du matin lit « ce qui est à faire, par échéance ». C'est la seule
-- requête qui doit être instantanée : elle est ouverte tous les jours.
CREATE INDEX IF NOT EXISTS idx_carnet_a_faire
  ON carnet_actions(echeance, cree_le) WHERE statut = 'a_faire';
CREATE INDEX IF NOT EXISTS idx_carnet_patient
  ON carnet_actions(patient_id, statut);

SELECT count(*) AS actions_existantes FROM carnet_actions;
SELECT 'OK migration 039 — carnet de suivi' AS msg;
