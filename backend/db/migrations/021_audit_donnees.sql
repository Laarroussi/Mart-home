-- ============================================================
-- 021 — Journal des modifications de données cliniques
-- ------------------------------------------------------------
-- Répond à l'exigence des bonnes pratiques cliniques : toute correction
-- apportée à une donnée doit être datée, attribuée à son auteur, motivée,
-- et NE DOIT PAS effacer la valeur d'origine (ICH-GCP E6, §4.9.3).
--
-- Jusqu'ici, corriger un diamètre aortique de 42 en 38 faisait disparaître
-- définitivement le 42. Aucune trace de qui, quand, ni pourquoi. Sur des
-- données destinées à publication, c'est le point qu'un moniteur d'étude
-- examine en premier.
--
-- UNE LIGNE PAR CHAMP MODIFIÉ, et non par enregistrement. Corriger deux
-- valeurs dans une même évaluation produit deux lignes : on doit pouvoir
-- suivre l'histoire d'une valeur précise, pas celle d'un formulaire.
--
-- Les valeurs sont stockées en texte : le journal doit rester lisible même
-- si le type d'une colonne change un jour. Un journal d'audit survit au
-- schéma qu'il documente.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_donnees (
  id              BIGSERIAL PRIMARY KEY,

  -- Quoi : localisation exacte de la valeur modifiée
  table_cible     TEXT NOT NULL,          -- 'evaluations', 'consultations'…
  enregistrement  TEXT NOT NULL,          -- identifiant de la ligne
  patient_id      TEXT,                   -- pour filtrer par dossier
  champ           TEXT NOT NULL,

  -- Avant / après. NULL est une valeur légitime : on distingue
  -- « champ vidé » de « champ inchangé » par la présence même de la ligne.
  ancienne_valeur TEXT,
  nouvelle_valeur TEXT,

  -- Pourquoi : motif codé pour l'analyse, texte libre pour le détail
  motif_code      TEXT NOT NULL,
  motif_texte     TEXT,

  -- Qui, quand, d'où
  auteur_id       TEXT,
  auteur_nom      TEXT,
  auteur_role     TEXT,
  fait_le         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  adresse_ip      TEXT,

  -- 'modification' | 'creation' | 'suppression'
  operation       TEXT NOT NULL DEFAULT 'modification'
);

-- Consultation par dossier : c'est l'usage courant, à l'ouverture d'un patient.
CREATE INDEX IF NOT EXISTS idx_audit_patient
  ON audit_donnees (patient_id, fait_le DESC);

-- Histoire d'une valeur précise : « qu'est devenue cette mesure ? »
CREATE INDEX IF NOT EXISTS idx_audit_cible
  ON audit_donnees (table_cible, enregistrement, champ, fait_le DESC);

-- Analyse des motifs : combien de corrections viennent d'une mauvaise
-- lecture automatique ? La réponse oriente les améliorations à faire.
CREATE INDEX IF NOT EXISTS idx_audit_motif
  ON audit_donnees (motif_code, fait_le DESC);

-- ------------------------------------------------------------
-- Un journal d'audit ne se modifie pas et ne se supprime pas.
-- Ces deux règles le disent au niveau de la base, et non seulement
-- dans le code applicatif : une ligne d'audit qu'on peut réécrire
-- ne vaut rien devant un auditeur.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit est immuable : ni modification ni suppression.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_pas_de_maj ON audit_donnees;
CREATE TRIGGER trg_audit_pas_de_maj
  BEFORE UPDATE OR DELETE ON audit_donnees
  FOR EACH ROW EXECUTE FUNCTION audit_immuable();

SELECT 'OK migration 021 — journal daudit immuable' AS msg;
