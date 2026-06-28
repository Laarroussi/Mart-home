-- ============================================================
-- SCHEMA POSTGRESQL — Plateforme Marfan APA
-- Encodage UTF-8 · Timezone Europe/Paris
-- ============================================================
-- Note : aucune extension PostgreSQL requise. Tous les IDs sont
-- générés en JavaScript côté application (compatible mutualisé
-- type o2switch où CREATE EXTENSION exige les droits superuser).
-- ============================================================

-- ============================================================
-- USERS — Comptes (3 rôles : principal_admin / investigator / patient)
--   principal_admin = Investigateur principal / Administrateur (droits max)
--   investigator    = Investigateur (suivi patients, peut créer comptes patients)
--   patient         = Patient (espace personnel uniquement)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id                   VARCHAR(50)  PRIMARY KEY,
    role                 VARCHAR(20)  NOT NULL CHECK (role IN ('principal_admin','investigator','patient')),
    name                 VARCHAR(200) NOT NULL,
    username             VARCHAR(100) UNIQUE,           -- login auto-généré : prenom.nom
    email                VARCHAR(200) UNIQUE NOT NULL,
    password_hash        VARCHAR(255) NOT NULL,
    phone                VARCHAR(50),
    service              VARCHAR(200),
    birth_date           DATE,                          -- sert à générer le mot de passe initial
    patient_id           VARCHAR(50),
    created_by           VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ  DEFAULT NOW(),
    active               BOOLEAN      DEFAULT TRUE,
    last_login           TIMESTAMPTZ,
    must_change_password BOOLEAN      NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

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
-- VIDEOS — Vidéos d'entraînement, info, etc. (gérées par principal_admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS videos (
    id             VARCHAR(50)  PRIMARY KEY,
    title          VARCHAR(300) NOT NULL,
    description    TEXT,
    category       VARCHAR(100),
    video_type     VARCHAR(30)  NOT NULL DEFAULT 'training'
                   CHECK (video_type IN ('training','education','info')),
    source         VARCHAR(20)  NOT NULL DEFAULT 'youtube'
                   CHECK (source IN ('youtube','upload','external')),
    youtube_id     VARCHAR(50),
    url            TEXT,
    interval_label VARCHAR(20),
    duration_min   INTEGER,
    english_title  VARCHAR(300),
    thumbnail_url  TEXT,
    visibility     VARCHAR(20)  NOT NULL DEFAULT 'all'
                   CHECK (visibility IN ('all','patient','staff','assigned')),
    order_index    INTEGER      NOT NULL DEFAULT 0,
    archived       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_by     VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ  DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_videos_category   ON videos(category);
CREATE INDEX IF NOT EXISTS idx_videos_type       ON videos(video_type);
CREATE INDEX IF NOT EXISTS idx_videos_archived   ON videos(archived);
CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos(visibility);

-- ============================================================
-- PATIENT_VIDEOS — Attribution d'une vidéo à un patient
-- ============================================================
CREATE TABLE IF NOT EXISTS patient_videos (
    id          SERIAL PRIMARY KEY,
    patient_id  VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    video_id    VARCHAR(50) NOT NULL REFERENCES videos(id)   ON DELETE CASCADE,
    assigned_by VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    note        TEXT,
    UNIQUE(patient_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_patient_videos_patient ON patient_videos(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_videos_video   ON patient_videos(video_id);

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
    id                SERIAL PRIMARY KEY,
    title             VARCHAR(200),
    description       TEXT,
    investigator_id   VARCHAR(50) REFERENCES users(id),                 -- investigateur en charge
    owner_id          VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,  -- créateur
    scheduled_at      TIMESTAMPTZ,                                       -- date/heure prévue
    duration_min      INTEGER,                                           -- durée prévue
    meeting_link      TEXT,                                              -- URL Jitsi/Zoom/Teams
    status            VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                      CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
    started_at        TIMESTAMPTZ,
    ended_at          TIMESTAMPTZ,
    cancelled_at      TIMESTAMPTZ,
    cancelled_by      VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    participants      TEXT[],
    avg_hr            NUMERIC(5,1),
    total_energy_kcal NUMERIC(8,2),
    notes             TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_visio_scheduled_at ON visio_sessions(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_visio_status       ON visio_sessions(status);
CREATE INDEX IF NOT EXISTS idx_visio_owner        ON visio_sessions(owner_id);

-- Jointure patients × visio (1 patient peut être invité à N séances)
CREATE TABLE IF NOT EXISTS visio_participants (
    id         SERIAL PRIMARY KEY,
    visio_id   INTEGER     NOT NULL REFERENCES visio_sessions(id) ON DELETE CASCADE,
    patient_id VARCHAR(50) NOT NULL REFERENCES patients(id)       ON DELETE CASCADE,
    invited_at TIMESTAMPTZ DEFAULT NOW(),
    joined_at  TIMESTAMPTZ,
    UNIQUE(visio_id, patient_id)
);
CREATE INDEX IF NOT EXISTS idx_visio_part_patient ON visio_participants(patient_id);
CREATE INDEX IF NOT EXISTS idx_visio_part_visio   ON visio_participants(visio_id);

-- ============================================================
-- TRAINING_SESSIONS — Séances d'entraînement patient (visio ou solo)
-- ============================================================
CREATE TABLE IF NOT EXISTS training_sessions (
    id                  SERIAL PRIMARY KEY,
    patient_id          VARCHAR(50) NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    investigator_id     VARCHAR(50) REFERENCES users(id) ON DELETE SET NULL,
    visio_session_id    INTEGER     REFERENCES visio_sessions(id) ON DELETE SET NULL,
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at            TIMESTAMPTZ,
    duration_s          INTEGER,
    status              VARCHAR(20) NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress','completed','interrupted','cancelled')),
    borg_cr10           INTEGER CHECK (borg_cr10 BETWEEN 0 AND 10),
    hr_min              INTEGER,
    hr_avg              NUMERIC(5,1),
    hr_max              INTEGER,
    pa_estimated_min    INTEGER,
    pa_estimated_avg    NUMERIC(5,1),
    pa_estimated_max    INTEGER,
    energy_total_kcal   NUMERIC(8,2),
    belt_connected      BOOLEAN DEFAULT FALSE,
    pa_method           VARCHAR(50) DEFAULT 'estimated_from_hr',
    notes               TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_patient    ON training_sessions(patient_id);
CREATE INDEX IF NOT EXISTS idx_training_started_at ON training_sessions(started_at);

-- TRAINING_SAMPLES — Échantillons temporels (FC/PA/énergie en fonction du temps)
CREATE TABLE IF NOT EXISTS training_samples (
    id              BIGSERIAL PRIMARY KEY,
    session_id      INTEGER NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE,
    t_seconds       INTEGER NOT NULL,
    hr              INTEGER,
    pa_estimated    INTEGER,
    energy_kcal     NUMERIC(7,3),
    recorded_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, t_seconds)
);
CREATE INDEX IF NOT EXISTS idx_training_samples_session ON training_samples(session_id, t_seconds);

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
