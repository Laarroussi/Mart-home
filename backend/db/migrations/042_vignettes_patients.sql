-- ============================================================
-- Migration 042 — Vignette carrée pour la bande latérale
-- ------------------------------------------------------------
-- La photo versée fait 600 pixels et une centaine de kilo-octets. Afficher
-- vingt patients dans une bande latérale demanderait donc deux méga-octets
-- pour des images rendues à 44 pixels de côté : on téléchargerait cinquante
-- fois ce qu'on affiche, à chaque ouverture de la page.
--
-- On stocke donc en plus une vignette de 96 pixels, fabriquée dans le
-- navigateur au moment du versement. Vingt vignettes tiennent dans une
-- centaine de kilo-octets au total, et partent en un seul appel.
--
-- Elle est NULLABLE : les photos déjà versées n'en ont pas, et on ne va pas
-- les refuser pour autant. La bande affichera les initiales pour celles-là,
-- jusqu'au prochain remplacement de la photo.
--
-- IDEMPOTENT — rejouable. PostgreSQL 9.6.
-- ============================================================

ALTER TABLE patient_photos ADD COLUMN IF NOT EXISTS vignette BYTEA;
ALTER TABLE patient_photos ADD COLUMN IF NOT EXISTS vignette_octets INTEGER;

-- Une vignette plus lourde que 60 Ko n'est pas une vignette : c'est une photo
-- qu'on a oublié de réduire, et la bande latérale redeviendrait lente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'photo_vignette_legere') THEN
    ALTER TABLE patient_photos ADD CONSTRAINT photo_vignette_legere
      CHECK (vignette_octets IS NULL OR (vignette_octets > 0 AND vignette_octets <= 61440));
  END IF;
END $$;

SELECT count(*) AS photos, count(vignette) AS avec_vignette FROM patient_photos;
SELECT 'OK migration 042 — vignettes' AS msg;
