-- ============================================================
-- Migration 040 — Photographie d'identification du patient
-- ------------------------------------------------------------
-- Reconnaître la personne dont on parle, dans une file de vingt dossiers.
--
-- La photo est dans SA PROPRE TABLE, et non dans une colonne de `patients`.
-- La table des patients est lue en permanence — listing, tableau, carnet,
-- séance — et chacune de ces lectures aurait traîné quelques dizaines de
-- kilo-octets d'image par ligne, pour un affichage qui n'en veut pas. Une
-- jointure explicite, quand la photo est réellement demandée, coûte moins.
--
-- C'est aussi une donnée à part en droit : un visage est une donnée
-- personnelle identifiante, qui suppose le consentement de la personne et
-- qui doit pouvoir être supprimée seule, sans toucher au dossier médical.
-- Une table séparée rend cette suppression triviale ; une colonne l'aurait
-- mêlée au reste.
--
-- `ajoutee_par` est conservé : savoir qui a versé l'image fait partie de la
-- traçabilité, au même titre que pour un document médical.
--
-- IDEMPOTENT — rejouable. PostgreSQL 9.6.
-- ============================================================

CREATE TABLE IF NOT EXISTS patient_photos (
    patient_id   TEXT        PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    mime         VARCHAR(40) NOT NULL,
    donnees      BYTEA       NOT NULL,
    octets       INTEGER     NOT NULL,
    ajoutee_par  VARCHAR(50) NOT NULL REFERENCES users(id),
    ajoutee_le   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Attestation de recueil du consentement, horodatée. Ce n'est pas le
    -- consentement lui-même — celui-ci est un document signé — mais la trace
    -- que la question a été posée avant de verser l'image.
    consentement BOOLEAN     NOT NULL DEFAULT FALSE
);

-- Garde-fous : un format d'image seulement, et une taille raisonnable.
-- Une photo d'identification n'a aucune raison de peser plus qu'une page de
-- texte ; au-delà, c'est qu'on a versé un fichier d'appareil photo sans le
-- réduire, et la base n'est pas un entrepôt d'images.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'photo_format_image') THEN
    ALTER TABLE patient_photos ADD CONSTRAINT photo_format_image
      CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'photo_taille_raisonnable') THEN
    ALTER TABLE patient_photos ADD CONSTRAINT photo_taille_raisonnable
      CHECK (octets > 0 AND octets <= 2097152);   -- 2 Mo
  END IF;
END $$;

SELECT count(*) AS photos_existantes FROM patient_photos;
SELECT 'OK migration 040 — photos patients' AS msg;
