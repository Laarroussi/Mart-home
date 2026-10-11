-- ============================================================
-- Où sont passées les pièces versées ? — lecture seule
-- ------------------------------------------------------------
-- Un compte rendu versé peut atterrir dans plusieurs tables selon le chemin
-- emprunté :
--
--   medical_record_documents  le fichier lui-même, tel que reçu
--   medical_timeline          les faits datés qu'une IA en a extraits
--   echo_reports              l'examen structuré, SI le soignant l'a validé
--   medical_exams             les examens d'appareil (CPET, onde de pouls)
--   pieces_patients           les pièces versées par le patient lui-même
--
-- Le point à vérifier est le dernier maillon : l'extraction d'une
-- échocardiographie est PROPOSÉE puis doit être ENREGISTRÉE. Si l'étape de
-- validation n'a jamais été franchie — bouton absent, écran fermé trop tôt,
-- extraction silencieusement vide — le fichier est bien en base et les
-- mesures n'y sont pas.
--
-- Ce script dit lequel des deux cas on a.
-- ============================================================

-- 1. Combien de pièces, et dans quelle table ?
SELECT 'medical_record_documents' AS table_source, count(*) AS lignes FROM medical_record_documents
UNION ALL SELECT 'medical_timeline',   count(*) FROM medical_timeline
UNION ALL SELECT 'echo_reports',       count(*) FROM echo_reports
UNION ALL SELECT 'medical_exams',      count(*) FROM medical_exams
UNION ALL SELECT 'pieces_patients',    count(*) FROM pieces_patients
UNION ALL SELECT 'analyses_files',     count(*) FROM analyses_files;

-- 2. Les fichiers reçus, patient par patient, du plus récent au plus ancien.
--    `status` dit où en est la pièce : « pending » = versée mais jamais
--    relue ni intégrée, ce qui explique une base vide malgré des fichiers.
SELECT patient_id, id, file_name, status,
       octet_length(COALESCE(extracted_text, '')) AS texte_extrait_octets,
       ocr_used AS lecture_optique,
       uploaded_at::date AS verse_le
  FROM medical_record_documents
 ORDER BY uploaded_at DESC LIMIT 30;

-- 3. Ce que l'IA a tiré de chaque pièce.
--    Zéro fait pour un document signale une extraction qui n'a rien produit,
--    ou qui n'a jamais été lancée.
SELECT d.patient_id, d.file_name, d.status,
       count(t.id) AS faits_extraits
  FROM medical_record_documents d
  LEFT JOIN medical_timeline t ON t.source_doc_id = d.id
 GROUP BY d.patient_id, d.file_name, d.status, d.id
 ORDER BY faits_extraits ASC, d.patient_id;

-- 4. Le journal d'extraction : combien de faits, et quelles erreurs ?
SELECT patient_id, doc_id, at::date AS le_jour,
       left(COALESCE(modele, ''), 24) AS modele,
       nb_faits, duree_ms,
       left(COALESCE(erreur, ''), 90) AS erreur
  FROM ai_extraction_log
 ORDER BY at DESC LIMIT 20;

-- 5. Qui a des pièces, et qu'en reste-t-il en base ?
SELECT p.id AS patient,
       (SELECT count(*) FROM medical_record_documents d WHERE d.patient_id = p.id) AS pieces,
       (SELECT count(*) FROM medical_timeline t WHERE t.patient_id = p.id)         AS faits,
       (SELECT count(*) FROM echo_reports e WHERE e.patient_id = p.id)             AS echos,
       (SELECT count(*) FROM medical_exams m WHERE m.patient_id = p.id)            AS examens_appareil
  FROM patients p
 ORDER BY pieces DESC, p.id;
