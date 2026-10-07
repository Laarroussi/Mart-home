-- ============================================================
-- 029 — Catégories de population et numérotation par préfixe
-- ------------------------------------------------------------
-- Les identifiants patients commençaient tous par MRF, parce que la
-- plateforme ne suivait qu'une pathologie. Elle va en suivre plusieurs, et
-- chaque population doit avoir sa propre suite : OBE-001 ne doit pas
-- dépendre du nombre de patients Marfan déjà inclus.
--
-- La catégorie est stockée en clair dans une colonne plutôt que déduite du
-- préfixe à chaque lecture. On pourrait lire les trois premières lettres de
-- l'identifiant, mais un identifiant est une étiquette : il peut être
-- corrigé, importé d'ailleurs, saisi à la main. La donnée doit exister pour
-- elle-même, et c'est elle qui sert aux filtres et aux exports.
--
-- Les patients déjà en base sont tous Marfan : on les marque comme tels, en
-- s'appuyant sur leur identifiant puisque c'est la seule information
-- disponible, et sans écraser une valeur déjà posée.
--
-- Le catalogue des catégories est volontairement figé dans le code et non
-- dans une table. Un préfixe entre dans l'identifiant définitif d'un
-- patient : le rendre modifiable depuis l'interface inviterait à le changer
-- après coup, ce qui casserait la correspondance entre les codes déjà
-- attribués et la catégorie affichée. Ajouter une population reste une
-- modification de code, délibérée et relue.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

ALTER TABLE patients ADD COLUMN IF NOT EXISTS categorie TEXT;

-- Reprise de l'existant : tout ce qui commence par MRF est Marfan.
UPDATE patients
   SET categorie = 'MRF'
 WHERE categorie IS NULL
   AND id ~* '^MRF';

-- Filet pour d'éventuels identifiants hors convention : on ne devine pas,
-- on range dans « Autre », qui est précisément fait pour cela.
UPDATE patients
   SET categorie = 'AUT'
 WHERE categorie IS NULL;

CREATE INDEX IF NOT EXISTS idx_patients_categorie ON patients (categorie);

SELECT 'OK migration 029 — categories de population' AS msg,
       categorie, COUNT(*)::int AS nb
  FROM patients
 GROUP BY categorie
 ORDER BY categorie;
