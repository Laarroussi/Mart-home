-- ============================================================
-- Migration 015 — Chronologie médicale extraite des documents
-- ============================================================
-- Une ligne = un fait médical daté, extrait d'un document versé
-- (compte-rendu hospitalier, biologie, imagerie, courrier...).
--
-- Types de faits :
--   mesure     : diamètre aortique, FEVG, VO2max, TA, poids, taille...
--   biologie   : NFS, CRP, créatinine, D-dimères...
--   traitement : molécule + dosage + posologie
--   operation  : chirurgie, intervention, pose de prothèse
--   examen     : ETT, IRM, angio-TDM, EFR, test d'effort
--   diagnostic : diagnostic posé, complication
--   autre
--
-- Toutes les lignes sont classées chronologiquement par event_date
-- et rattachées au patient : c'est ce qui alimente le tableau BDD.
--
-- IDEMPOTENT — pas de BEGIN/COMMIT.
-- ============================================================

CREATE TABLE IF NOT EXISTS medical_timeline (
  id            SERIAL PRIMARY KEY,
  patient_id    TEXT NOT NULL,
  event_date    DATE,                 -- date du fait médical (peut être NULL si illisible)
  date_precision TEXT,                -- 'jour' | 'mois' | 'annee' | 'inconnue'
  category      TEXT NOT NULL,        -- mesure | biologie | traitement | operation | examen | diagnostic | autre
  label         TEXT NOT NULL,        -- ex. "Diamètre sinus de Valsalva"
  value_num     NUMERIC,              -- valeur numérique si applicable
  value_text    TEXT,                 -- valeur textuelle (ex. "Bêta-bloquant")
  unit          TEXT,                 -- mm, mL/kg/min, mg, %, ...
  detail        TEXT,                 -- posologie, voie, site, précisions
  source_doc_id INTEGER,              -- document d'origine (medical_record_documents.id)
  source_extrait TEXT,                -- phrase d'origine, pour vérification humaine
  confiance     NUMERIC(3,2),         -- 0.00 à 1.00 : confiance de l'extraction
  statut        TEXT NOT NULL DEFAULT 'valide',   -- valide | a_verifier | rejete
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_timeline_patient  ON medical_timeline (patient_id);
CREATE INDEX IF NOT EXISTS idx_timeline_date     ON medical_timeline (event_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_timeline_category ON medical_timeline (category);

-- Journal des analyses IA (traçabilité : qui, quand, quel modèle, combien de faits)
CREATE TABLE IF NOT EXISTS ai_extraction_log (
  id            SERIAL PRIMARY KEY,
  patient_id    TEXT,
  doc_id        INTEGER,
  modele        TEXT,
  nb_faits      INTEGER,
  pseudonymise  BOOLEAN NOT NULL DEFAULT TRUE,
  duree_ms      INTEGER,
  erreur        TEXT,
  at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  par           TEXT
);
