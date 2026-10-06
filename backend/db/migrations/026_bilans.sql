-- ============================================================
-- 026 — Bilans datés : entrée, intermédiaires, sortie
-- ------------------------------------------------------------
-- La table `syntheses` ne garde qu'une ligne vivante par patient. C'était
-- juste tant que le document décrivait un état d'entrée. Ça ne l'est plus
-- dès lors qu'on mène des entretiens en cours d'année : chaque bilan décrit
-- une période, et réécrire le précédent efface ce qu'on voulait justement
-- pouvoir relire — ce que le patient disait six mois plus tôt, et ce qu'il
-- faisait alors.
--
-- Un bilan est donc une ligne à part, datée, qui couvre un intervalle.
--
--   type = 'entree'        le bilan d'inclusion ; un seul par patient.
--   type = 'intermediaire' autant que d'entretiens menés en cours d'année.
--   type = 'sortie'        le bilan final ; un seul par patient.
--
-- Les deux unicités sont posées par index partiels plutôt que par contrainte
-- de table : seuls 'entree' et 'sortie' sont uniques, 'intermediaire' ne
-- l'est pas, et un CHECK ne sait pas exprimer cela.
--
-- `periode_debut` et `periode_fin` délimitent ce que le bilan raconte. Pour
-- un bilan intermédiaire, le début est la date du bilan précédent : sans
-- cela, chaque bilan réaffirmerait depuis l'origine le même nombre de
-- séances, et l'on perdrait la progression d'une période à l'autre.
--
-- `donnees` conserve l'agrégat chiffré qui a servi à rédiger — séances,
-- intensités, CR10, modules suivis, évaluations comparées. On le fige : un
-- bilan validé doit rester lisible même si les séances sont corrigées
-- ensuite, et l'on doit pouvoir vérifier sur quoi le texte reposait.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

CREATE TABLE IF NOT EXISTS bilans (
  id               SERIAL PRIMARY KEY,
  patient_id       TEXT NOT NULL,
  type             TEXT NOT NULL DEFAULT 'intermediaire',
  titre            TEXT,
  date_bilan       DATE NOT NULL DEFAULT CURRENT_DATE,
  periode_debut    DATE,
  periode_fin      DATE,

  -- Rubriques rédigées. Les deux premières reprennent la grammaire de la
  -- fiche d'entrée ; `activite` est propre au suivi et n'existe pas à
  -- l'inclusion, puisqu'aucune séance n'a encore eu lieu.
  contexte         TEXT,   -- éléments médicaux et évolution depuis le dernier bilan
  activite         TEXT,   -- pratique réalisée : séances, intensités, ressenti, éducation
  objectifs        TEXT,   -- difficultés, progression, objectifs pour la suite

  bilan_entretien  TEXT,   -- notes du professionnel, non publiées telles quelles
  donnees          JSONB NOT NULL DEFAULT '{}'::jsonb,

  generee_le       TIMESTAMPTZ,
  modele           TEXT,
  validee          BOOLEAN NOT NULL DEFAULT FALSE,
  validee_le       TIMESTAMPTZ,
  validee_par      TEXT,
  validee_par_nom  TEXT,

  cree_le          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cree_par         TEXT,
  maj_le           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  maj_par          TEXT
);

CREATE INDEX IF NOT EXISTS idx_bilans_patient ON bilans (patient_id, date_bilan DESC);
CREATE INDEX IF NOT EXISTS idx_bilans_type    ON bilans (patient_id, type);

-- Un seul bilan d'entrée et un seul bilan de sortie par patient.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bilan_entree
  ON bilans (patient_id) WHERE type = 'entree';
CREATE UNIQUE INDEX IF NOT EXISTS uq_bilan_sortie
  ON bilans (patient_id) WHERE type = 'sortie';

-- Reprise de l'existant : la synthèse d'entrée déjà rédigée devient le bilan
-- d'entrée, pour que le parcours imprimé ne commence pas par un trou. On ne
-- reprend que les dossiers qui portent un texte, et jamais deux fois.
INSERT INTO bilans (patient_id, type, titre, date_bilan, contexte, objectifs,
                    bilan_entretien, generee_le, validee, validee_le, validee_par,
                    validee_par_nom, cree_par, maj_par)
SELECT s.patient_id, 'entree', 'Bilan d''entrée',
       COALESCE(s.generee_le::date, s.maj_le::date, CURRENT_DATE),
       s.entree, s.objectifs, s.bilan_entretien, s.generee_le,
       COALESCE(s.validee, FALSE), s.validee_le, s.validee_par, s.validee_par_nom,
       s.maj_par, s.maj_par
  FROM syntheses s
 WHERE (COALESCE(s.entree, '') <> '' OR COALESCE(s.objectifs, '') <> '')
   AND NOT EXISTS (SELECT 1 FROM bilans b
                    WHERE b.patient_id = s.patient_id AND b.type = 'entree');

SELECT 'OK migration 026 — bilans dates (entree, intermediaires, sortie)' AS msg;
