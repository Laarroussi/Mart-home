-- ============================================================
-- Retrait des pseudo-faits issus d'un fichier d'épreuve d'effort
-- ------------------------------------------------------------
-- Un export COSMED versé dans l'ancien lecteur générique a été confié à l'IA
-- pour en extraire des « faits médicaux datés ». Le fichier contenant un
-- cycle respiratoire par ligne, elle en a tiré des centaines : 44 valeurs de
-- QR, 44 de VO2, 40 de VCO2, 40 de SpO2. Ce ne sont pas des faits cliniques,
-- ce sont des points de courbe.
--
-- Plus grave : 40 lignes étiquetées « FC » portent des valeurs de 35 à
-- 57 bpm. À l'effort, c'est impossible — il s'agit de la fréquence
-- RESPIRATOIRE, renommée. Une donnée fausse sous un nom juste.
--
-- Ces lignes alimentent la chronologie du dossier, les colonnes du tableau
-- unifié, et le dossier transmis à l'IA quand elle rédige une synthèse. Les
-- laisser, c'est accepter qu'elle raisonne dessus.
--
-- ---- Ce qui est conservé ----
-- Les mesures de synthèse du compte rendu — FC maximale, FC à l'effort — et
-- les données morphologiques (BSA, IMC, poids, taille). Elles sont justes,
-- uniques, et datées correctement.
--
-- L'épreuve elle-même n'est pas perdue : reversez le fichier par la zone
-- « Verser une pièce ». Il sera cette fois analysé cycle par cycle et
-- deviendra une évaluation complète — VO2 pic, seuils, facteurs pronostiques.
--
-- ---- À MODIFIER ----
-- Le code patient, sur la ligne marquée. Mettez NULL pour traiter tous les
-- dossiers d'un coup.
--
-- SAUVEGARDEZ AVANT (bouton « 💾 Sauvegarde » dans l'interface).
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

-- --- 1. Avant : ce qui va partir, et ce qui reste ---
SELECT label, count(*) AS n,
       CASE WHEN label IN ('QR','VO2','VCO2','VE','FC','SpO2','METS','VO2/kg',
                           'VE/VO2','VE/VCO2','FR','BF','VT','PetCO2','PetO2',
                           'Puissance','Power','Watt','RER','Phase')
            THEN 'À RETIRER — cycle respiratoire'
            ELSE 'conservé' END AS sort
  FROM medical_timeline
 WHERE patient_id = 'MRF-003'          -- ← LE CODE PATIENT
 GROUP BY label ORDER BY n DESC;

DO $$
DECLARE
  -- ↓↓↓ LA SEULE LIGNE À MODIFIER (NULL = tous les dossiers) ↓↓↓
  cible TEXT := 'MRF-003';
  -- ↑↑↑ ------------------------------------------------- ↑↑↑

  -- Vocabulaire d'un fichier d'épreuve d'effort cycle à cycle. Une liste
  -- explicite plutôt qu'un motif : « FC » doit partir ici, mais « FC Max »
  -- est une vraie mesure de synthèse et doit rester. Un ILIKE '%FC%' aurait
  -- emporté les deux.
  cycle TEXT[] := ARRAY['QR','VO2','VCO2','VE','FC','SpO2','METS','VO2/kg',
                        'VE/VO2','VE/VCO2','FR','BF','VT','PetCO2','PetO2',
                        'Puissance','Power','Watt','RER','Phase'];
  n BIGINT;
BEGIN
  -- Garde-fou : on ne retire une ligne que si le même libellé apparaît
  -- plusieurs fois pour ce patient. Une mesure unique nommée « VO2 » peut
  -- venir d'un compte rendu de consultation et mérite d'être conservée ;
  -- quarante-quatre « VO2 » le même jour ne viennent que d'un tableau.
  WITH repetes AS (
    SELECT label FROM medical_timeline
     WHERE (cible IS NULL OR patient_id = cible)
       AND label = ANY (cycle)
     GROUP BY patient_id, label
    HAVING count(*) >= 5
  )
  DELETE FROM medical_timeline
   WHERE (cible IS NULL OR patient_id = cible)
     AND label IN (SELECT label FROM repetes);
  GET DIAGNOSTICS n = ROW_COUNT;

  RAISE NOTICE 'Pseudo-faits retirés : %', n;
  IF n = 0 THEN
    RAISE NOTICE 'Rien à retirer — la chronologie est déjà propre.';
  END IF;
END $$;

-- --- 2. Après : ce qui reste dans la chronologie ---
SELECT patient_id, label, count(*) AS n, unit
  FROM medical_timeline
 WHERE patient_id = 'MRF-003'          -- ← LE MÊME CODE
 GROUP BY patient_id, label, unit ORDER BY n DESC;

SELECT patient_id, count(*) AS faits_restants
  FROM medical_timeline GROUP BY patient_id ORDER BY patient_id;
