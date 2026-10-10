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
SELECT label, event_date, count(*) AS n,
       CASE
         WHEN label ILIKE '%ambiant%' OR label ILIKE '%débitmètre%'
           OR label ILIKE '%debitmetre%' OR label ILIKE '%barométrique%'
           THEN 'À RETIRER — condition d''étalonnage'
         WHEN label IN ('QR','VO2','VCO2','VE','FC','SpO2','METS','VO2/kg',
                        'VE/VO2','VE/VCO2','FR','BF','VT','PetCO2','PetO2',
                        'Puissance','Power','Watt','RER','Phase')
          AND count(*) >= 2
           THEN 'À RETIRER — répété le même jour'
         ELSE 'conservé' END AS sort
  FROM medical_timeline
 WHERE patient_id = 'MRF-003'          -- ← LE CODE PATIENT
 GROUP BY label, event_date ORDER BY n DESC, label;

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
  -- Garde-fou, deuxième version. La première exigeait cinq occurrences et
  -- laissait passer « METS » et « VO2/kg », présents quatre fois : un seuil
  -- numérique arbitraire rate toujours quelque chose.
  --
  -- Le vrai critère est ailleurs : un même libellé répété LE MÊME JOUR ne
  -- peut pas être un fait clinique. On ne mesure pas quatre fois le VO2/kg
  -- d'un patient dans la même journée — on lit quatre lignes d'un tableau.
  -- Deux valeurs à deux dates différentes, en revanche, sont deux examens,
  -- et elles restent.
  WITH doublons_du_jour AS (
    SELECT patient_id, label, event_date
      FROM medical_timeline
     WHERE (cible IS NULL OR patient_id = cible)
       AND label = ANY (cycle)
     GROUP BY patient_id, label, event_date
    HAVING count(*) >= 2
  )
  DELETE FROM medical_timeline t
   USING doublons_du_jour d
   WHERE t.patient_id = d.patient_id
     AND t.label = d.label
     AND t.event_date IS NOT DISTINCT FROM d.event_date;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Pseudo-faits retirés (répétés le même jour) : %', n;

  -- Conditions d'étalonnage de l'appareil : température et humidité de la
  -- salle et du débitmètre, pression barométrique. Ce sont des paramètres
  -- de l'examen, pas des mesures du patient. Dans une chronologie médicale,
  -- « Température 22 °C » daté du jour de l'épreuve se lit comme une
  -- température corporelle.
  DELETE FROM medical_timeline
   WHERE (cible IS NULL OR patient_id = cible)
     AND (label ILIKE '%ambiant%' OR label ILIKE '%débitmètre%'
          OR label ILIKE '%debitmetre%' OR label ILIKE '%barométrique%'
          OR label ILIKE '%barometrique%');
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Conditions d''étalonnage retirées : %', n;
  RAISE NOTICE 'Terminé.';
END $$;

-- --- 2. Après : ce qui reste dans la chronologie ---
SELECT patient_id, label, count(*) AS n, unit
  FROM medical_timeline
 WHERE patient_id = 'MRF-003'          -- ← LE MÊME CODE
 GROUP BY patient_id, label, unit ORDER BY n DESC;

SELECT patient_id, count(*) AS faits_restants
  FROM medical_timeline GROUP BY patient_id ORDER BY patient_id;
