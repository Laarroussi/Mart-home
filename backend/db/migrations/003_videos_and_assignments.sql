-- ============================================================
-- Migration 003 — Tables vidéos + attributions patient
-- ============================================================
-- Crée 2 tables :
--   - videos          : vidéos d'entraînement (principalement YouTube)
--                        gérées en CRUD par principal_admin
--   - patient_videos  : attributions vidéo × patient (assigned_by, assigned_at)
--
-- Et pré-remplit videos avec les 18 vidéos YouTube actuellement hardcodées
-- dans index.html pour qu'il n'y ait aucune régression visible côté patient.
--
-- IDEMPOTENT : peut être ré-exécutée sans risque.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Table videos
-- ============================================================
CREATE TABLE IF NOT EXISTS videos (
    id             VARCHAR(50)  PRIMARY KEY,                -- ex: youtube id ou slug
    title          VARCHAR(300) NOT NULL,
    description    TEXT,
    category       VARCHAR(100),                            -- "Renforcement musculaire", "Ceinture abdominale", ...
    video_type     VARCHAR(30)  NOT NULL DEFAULT 'training' -- 'training' | 'education' | 'info'
                   CHECK (video_type IN ('training','education','info')),
    source         VARCHAR(20)  NOT NULL DEFAULT 'youtube'  -- 'youtube' | 'upload' | 'external'
                   CHECK (source IN ('youtube','upload','external')),
    youtube_id     VARCHAR(50),                             -- si source = youtube
    url            TEXT,                                    -- si source = external
    interval_label VARCHAR(20),                             -- "10/5", "20/10", "Séance longue"...
    duration_min   INTEGER,
    english_title  VARCHAR(300),                            -- traduction anglaise éventuelle
    thumbnail_url  TEXT,                                    -- override de la miniature YT
    visibility     VARCHAR(20)  NOT NULL DEFAULT 'all'      -- 'all' | 'patient' | 'staff' | 'assigned'
                   CHECK (visibility IN ('all','patient','staff','assigned')),
    order_index    INTEGER      NOT NULL DEFAULT 0,         -- ordre d'affichage
    archived       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_by     VARCHAR(50)  REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ  DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_videos_category   ON videos(category);
CREATE INDEX IF NOT EXISTS idx_videos_type       ON videos(video_type);
CREATE INDEX IF NOT EXISTS idx_videos_archived   ON videos(archived);
CREATE INDEX IF NOT EXISTS idx_videos_visibility ON videos(visibility);

-- Trigger updated_at
DROP TRIGGER IF EXISTS set_videos_updated ON videos;
CREATE TRIGGER set_videos_updated
    BEFORE UPDATE ON videos
    FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();

-- ============================================================
-- 2. Table patient_videos (attributions)
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
-- 3. Pré-remplissage : les 18 vidéos YouTube actuellement hardcodées
-- ============================================================
INSERT INTO videos (id, title, category, video_type, source, youtube_id, interval_label, duration_min, english_title, order_index, visibility)
VALUES
  ('8qxVEhNHvc8', 'Ceinture abdominale 10/5 (3 min)',         'Ceinture abdominale',     'training', 'youtube', '8qxVEhNHvc8', '10/5', 3,    'Core training',           1, 'all'),
  ('m60vrhs-3sM', 'Ceinture abdominale 20/10 (5 min)',        'Ceinture abdominale',     'training', 'youtube', 'm60vrhs-3sM', '20/10', 5,   'Core training',           2, 'all'),
  ('kbQpd7b29b0', 'Ceinture abdominale 10/10 (4 min)',        'Ceinture abdominale',     'training', 'youtube', 'kbQpd7b29b0', '10/10', 4,   'Core training',           3, 'all'),
  ('qki1c8RW1r0', 'Séance complète — séance longue',          'Renforcement musculaire', 'training', 'youtube', 'qki1c8RW1r0', 'Séance longue', NULL, 'Long aerobic session', 4, 'all'),
  ('KVbCOXec9VU', 'Circuit 4 min — jambes & gainage (15/5)',  'Renforcement musculaire', 'training', 'youtube', 'KVbCOXec9VU', '15/5', 4,    'Legs and core circuit',   5, 'all'),
  ('Y8JnisJMcIY', 'Pliométrie 10/10 (4 min)',                 'Renforcement musculaire', 'training', 'youtube', 'Y8JnisJMcIY', '10/10', 4,   'Plyometric training',     6, 'all'),
  ('Oe9VRKzHAk4', 'Full body 10/5 (3 min)',                   'Renforcement musculaire', 'training', 'youtube', 'Oe9VRKzHAk4', '10/5', 3,    'Full body',               7, 'all'),
  ('7GC23glL0fw', 'Full body 15/10 (5 min)',                  'Renforcement musculaire', 'training', 'youtube', '7GC23glL0fw', '15/10', 5,   'Full body',               8, 'all'),
  ('5Po_uqUJkFc', 'Full body 15/5 (4 min)',                   'Renforcement musculaire', 'training', 'youtube', '5Po_uqUJkFc', '15/5', 4,    'Full body',               9, 'all'),
  ('En9C6GXwpaI', 'Full body 20/10 (6 min)',                  'Renforcement musculaire', 'training', 'youtube', 'En9C6GXwpaI', '20/10', 6,   'Full body',              10, 'all'),
  ('TeikHJNCofo', 'Full body 15/15 — sans récup. (5 min)',    'Renforcement musculaire', 'training', 'youtube', 'TeikHJNCofo', '15/15', 5,   'Full body no rest',      11, 'all'),
  ('MCDb5w8GEkU', 'Cardio 10/10 — sans récup. (4 min)',       'Renforcement musculaire', 'training', 'youtube', 'MCDb5w8GEkU', '10/10', 4,   'Cardio no rest',         12, 'all'),
  ('slVb5unTXnc', 'Haut du corps — sans récup. (4 min)',      'Renforcement musculaire', 'training', 'youtube', 'slVb5unTXnc', '—', 4,       'Upper body no rest',     13, 'all'),
  ('ny0zO58paQg', 'Cardio 20/10 (5 min)',                     'Renforcement musculaire', 'training', 'youtube', 'ny0zO58paQg', '20/10', 5,   'Cardio',                 14, 'all'),
  ('y0D-tIeLkgQ', 'Haut du corps 10/10 (4 min)',              'Renforcement musculaire', 'training', 'youtube', 'y0D-tIeLkgQ', '10/10', 4,   'Upper body',             15, 'all'),
  ('0t9T9mStxqE', 'Cardio 10/5 (3 min)',                      'Renforcement musculaire', 'training', 'youtube', '0t9T9mStxqE', '10/5', 3,    'Cardio',                 16, 'all'),
  ('zNAMuueADeQ', 'Haut du corps 10/10 (3 min)',              'Renforcement musculaire', 'training', 'youtube', 'zNAMuueADeQ', '10/10', 3,   'Upper body',             17, 'all'),
  ('t6ylxrRskSU', 'Full body 30/10 (8 min)',                  'Renforcement musculaire', 'training', 'youtube', 't6ylxrRskSU', '30/10', 8,   'Full body',              18, 'all')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 4. Vérification finale
-- ============================================================
SELECT video_type, COUNT(*) AS nb FROM videos GROUP BY video_type ORDER BY video_type;

COMMIT;

-- ============================================================
-- Fin migration 003
-- ============================================================
