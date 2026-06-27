-- ============================================================
-- SCHEMA POSTGRESQL — Plateforme Marfan APA
-- Encodage UTF-8 · Timezone Europe/Paris
-- ============================================================
-- Note : aucune extension PostgreSQL requise. Tous les IDs sont
-- générés en JavaScript côté application (compatible mutualisé
-- type o2switch où CREATE EXTENSION exige les droits superuser).
-- ============================================================

-- ============================================================
-- USERS — Comptes (admin / principal / investigator / patient)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id            VARCHAR(50)  PRIMARY KEY,
    role          VARCHAR(20)  NOT NULL CHECK (role IN ('admin','principal','investigator','patient')),
    name          VARCHAR(200) NOT NULL,
    email         VARCHAR(200) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    phone         VARCHAR(50),
    service       VARCHAR(200),
    patient_id    VARCHAR(50),
    created_by    VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    active        BOOLEAN      DEFAULT TRUE,
    last_login    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================
-- PATIENTS — Dossiers cliniques
-- ============================================================
CREATE TABLE IF NOT EXISTS patients (
    id             VARCHAR(50)  PRIMARY KEY,
    sex            VARCHAR(20),
    age            INTEGER,
    gene           VARCHAR(50),
    aorta          NUMERIC(5,2),
    status         VARCHAR(50),
    status_class   VARCHAR(20),
    progress       INTEGER DEFAULT 50,
    connected      BOOLEAN DEFAULT FALSE,
    risk_factor    TEXT,
    risk_comment   TEXT,
    alterations    TEXT[],
    incidents      TEXT[],
    civil          JSONB DEFAULT '{}'::jsonb,
    medical        JSONB DEFAULT '{}'::jsonb,
    study          JSONB DEFAULT '{}'::jsonb,
    created_by     VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_patients_gene   ON patients(gene);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status_class);

-- Lien user → patient (cascade)
ALTER TABLE users
  ADD CONSTRAINT fk_users_patient
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
  DEFERRABLE INITIALLY DEFERRED;

-- ============================================================
-- EVALUATIONS — Visites longitudinales (illimitées par patient)
-- ============================================================
CREATE TABLE IF NOT EXISTS evaluations (
    id              SERIAL PRIMARY KEY,
    patient_id      VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    eval_id         INTEGER NOT NULL,
    label           VARCHAR(100) NOT NULL,
    eval_date       DATE NOT NULL,
    vo2             NUMERIC(6,2),
    sv1             NUMERIC(6,2),
    sv2             NUMERIC(6,2),
    ve_vco2_slope   NUMERIC(6,2),
    watts           INTEGER,
    fc_max          INTEGER,
    force_kg        NUMERIC(6,2),
    sf36            NUMERIC(5,2),
    gpaq            INTEGER,
    aorta           NUMERIC(5,2),
    validated       BOOLEAN DEFAULT FALSE,
    note            TEXT,
    vo2_data        JSONB,
    pulse_data      JSONB,
    thresholds      JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(patient_id, eval_id)
);
CREATE INDEX IF NOT EXISTS idx_eval_patient ON evaluations(patient_id);
CREATE INDEX IF NOT EXISTS idx_eval_date    ON evaluations(eval_date);

-- ============================================================
-- EDUCATION_CAPSULES — Capsules vidéo éducatives
-- ============================================================
CREATE TABLE IF NOT EXISTS education_capsules (
    id                  VARCHAR(50) PRIMARY KEY,
    title               VARCHAR(200) NOT NULL,
    theme               VARCHAR(200),
    duration            VARCHAR(20),
    description         TEXT,
    english             VARCHAR(200),
    image_url           TEXT,
    video_url           TEXT,
    pre_questionnaire   JSONB,
    post_questionnaire  JSONB,
    active              BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- EDUCATION_RECORDS — Dossier éducation par patient × capsule
-- ============================================================
CREATE TABLE IF NOT EXISTS education_records (
    id                   SERIAL PRIMARY KEY,
    patient_id           VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    capsule_id           VARCHAR(50) NOT NULL REFERENCES education_capsules(id) ON DELETE CASCADE,
    sent_date            DATE,
    pre_status           VARCHAR(20) DEFAULT 'not-sent' CHECK (pre_status IN ('not-sent','pending','completed')),
    pre_score            INTEGER CHECK (pre_score BETWEEN 0 AND 100),
    pre_completed_date   DATE,
    video_watched        BOOLEAN DEFAULT FALSE,
    video_watched_date   DATE,
    post_status          VARCHAR(20) DEFAULT 'locked' CHECK (post_status IN ('locked','pending','completed')),
    post_score           INTEGER CHECK (post_score BETWEEN 0 AND 100),
    post_completed_date  DATE,
    validated            BOOLEAN DEFAULT FALSE,
    reminders            INTEGER DEFAULT 0,
    updated_at           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(patient_id, capsule_id)
);
CREATE INDEX IF NOT EXISTS idx_edu_patient   ON education_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_edu_capsule   ON education_records(capsule_id);
CREATE INDEX IF NOT EXISTS idx_edu_validated ON education_records(validated);

-- ============================================================
-- NOTIFICATIONS — Envois SF-36, GPAQ, capsules
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
    id              VARCHAR(100) PRIMARY KEY,
    patient_id      VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    type            VARCHAR(50) NOT NULL,
    subtype         VARCHAR(50),
    label           TEXT,
    capsule_id      VARCHAR(50) REFERENCES education_capsules(id),
    source          VARCHAR(50),
    status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','expired')),
    sent_date       DATE,
    completed_date  DATE,
    reminders       INTEGER DEFAULT 0,
    score           INTEGER,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_patient  ON notifications(patient_id);
CREATE INDEX IF NOT EXISTS idx_notif_status   ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notif_type     ON notifications(type);

-- ============================================================
-- NOTIFICATION_LOG — Traçabilité (audit trail RGPD)
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_log (
    id          SERIAL PRIMARY KEY,
    user_id     VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    patient_id  VARCHAR(50),
    action      VARCHAR(100),
    details     JSONB,
    ip_address  VARCHAR(45),
    timestamp   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_log_user      ON notification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_log_patient   ON notification_log(patient_id);
CREATE INDEX IF NOT EXISTS idx_log_timestamp ON notification_log(timestamp DESC);

-- ============================================================
-- VISIO_SESSIONS — Séances APA collectives
-- ============================================================
CREATE TABLE IF NOT EXISTS visio_sessions (
    id              SERIAL PRIMARY KEY,
    investigator_id VARCHAR(50) REFERENCES users(id),
    started_at      TIMESTAMPTZ,
    ended_at        TIMESTAMPTZ,
    title           VARCHAR(200),
    participants    TEXT[],
    avg_hr          NUMERIC(5,1),
    total_energy_kcal NUMERIC(8,2),
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ANALYSES_FILES — Fichiers CSV/XLSX uploadés (VO2, popmètre)
-- ============================================================
CREATE TABLE IF NOT EXISTS analyses_files (
    id            SERIAL PRIMARY KEY,
    patient_id    VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    evaluation_id INTEGER REFERENCES evaluations(id) ON DELETE SET NULL,
    file_type     VARCHAR(20) NOT NULL CHECK (file_type IN ('vo2','pulse')),
    file_name     VARCHAR(200),
    file_path     TEXT,
    file_size     INTEGER,
    metrics       JSONB,
    uploaded_by   VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_analyses_patient ON analyses_files(patient_id);
CREATE INDEX IF NOT EXISTS idx_analyses_eval    ON analyses_files(evaluation_id);

-- ============================================================
-- TRIGGERS — updated_at automatique
-- ============================================================
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_patients_updated   ON patients;
CREATE TRIGGER set_patients_updated   BEFORE UPDATE ON patients   FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

DROP TRIGGER IF EXISTS set_education_updated  ON education_records;
CREATE TRIGGER set_education_updated  BEFORE UPDATE ON education_records FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- ============================================================
-- VUES PRATIQUES
-- ============================================================
CREATE OR REPLACE VIEW v_cohort_overview AS
SELECT
  COUNT(*)                                            AS total_patients,
  COUNT(*) FILTER (WHERE status_class = 'ok')         AS stable_count,
  COUNT(*) FILTER (WHERE status_class = 'watch')      AS watch_count,
  COUNT(*) FILTER (WHERE status_class = 'alert')      AS alert_count,
  ROUND(AVG(progress))                                AS avg_progress
FROM patients;

CREATE OR REPLACE VIEW v_education_summary AS
SELECT
  c.id                                                AS capsule_id,
  c.title                                             AS capsule_title,
  c.theme                                             AS theme,
  COUNT(er.id)                                        AS records_count,
  COUNT(er.id) FILTER (WHERE er.pre_status = 'completed')  AS pre_completed,
  COUNT(er.id) FILTER (WHERE er.video_watched = true)      AS video_watched_count,
  COUNT(er.id) FILTER (WHERE er.post_status = 'completed') AS post_completed,
  COUNT(er.id) FILTER (WHERE er.validated = true)          AS validated_count,
  ROUND(AVG(er.pre_score) FILTER (WHERE er.pre_status = 'completed'))   AS avg_pre_score,
  ROUND(AVG(er.post_score) FILTER (WHERE er.post_status = 'completed')) AS avg_post_score
FROM education_capsules c
LEFT JOIN education_records er ON er.capsule_id = c.id
GROUP BY c.id, c.title, c.theme;

-- ============================================================
-- FIN
-- ============================================================
