-- ============================================================
-- 022 — Pièces versées par les patients eux-mêmes
-- ------------------------------------------------------------
-- Un patient peut désormais déposer un compte rendu depuis son espace :
-- échocardiographie, épreuve d'effort, courrier de consultation. La pièce est
-- lue immédiatement par l'IA, mais ses données N'ENTRENT PAS dans la base
-- tant que l'investigateur ne les a pas validées.
--
-- POURQUOI CETTE FILE D'ATTENTE, et non une intégration directe :
--
--   • un patient peut verser le compte rendu d'un proche, par erreur ;
--   • une lecture automatique se trompe, et l'erreur deviendrait une donnée
--     d'étude sans qu'aucun soignant ne l'ait vue ;
--   • en bonnes pratiques cliniques, une donnée doit être vérifiable à sa
--     source par une personne qualifiée.
--
-- Le principe de la plateforme est préservé : l'IA propose, le soignant valide.
--
-- Le fichier lui-même n'est pas conservé en base : seuls le texte extrait et
-- l'analyse le sont. Stocker des PDF médicaux en base alourdit les
-- sauvegardes sans bénéfice — l'information utile est déjà extraite, et la
-- traçabilité est assurée par la conservation du texte source.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

CREATE TABLE IF NOT EXISTS pieces_patients (
  id            SERIAL PRIMARY KEY,
  patient_id    TEXT NOT NULL,

  -- Ce que le patient a déposé
  nom_fichier   TEXT,
  mime          TEXT,
  taille_ko     INTEGER,
  commentaire   TEXT,              -- mot libre du patient à l'intention du soignant

  -- Ce que la lecture automatique en a tiré
  texte_source  TEXT,              -- texte extrait : la source vérifiable
  analyse       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { faits:[], echo:{}, genetique:{} }
  nb_faits      INTEGER DEFAULT 0,
  erreur_lecture TEXT,

  -- Cycle de vie
  statut        TEXT NOT NULL DEFAULT 'en_attente'
                CHECK (statut IN ('en_attente', 'validee', 'rejetee', 'erreur')),
  deposee_le    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  traitee_le    TIMESTAMPTZ,
  traitee_par   TEXT,
  motif_rejet   TEXT,
  nb_faits_retenus INTEGER
);

-- La file d'attente est l'usage principal : « qu'ai-je à relire ? »
CREATE INDEX IF NOT EXISTS idx_pieces_statut
  ON pieces_patients (statut, deposee_le DESC);

CREATE INDEX IF NOT EXISTS idx_pieces_patient
  ON pieces_patients (patient_id, deposee_le DESC);

-- Origine d'un fait de la chronologie : saisi par un soignant, ou issu d'une
-- pièce déposée par le patient. L'information compte à l'analyse — on doit
-- pouvoir distinguer ce qui vient du dossier hospitalier de ce qu'a transmis
-- le participant lui-même.
ALTER TABLE medical_timeline ADD COLUMN IF NOT EXISTS source_role TEXT DEFAULT 'soignant';
ALTER TABLE medical_timeline ADD COLUMN IF NOT EXISTS piece_patient_id INTEGER;

SELECT 'OK migration 022 — pieces versees par les patients' AS msg;
