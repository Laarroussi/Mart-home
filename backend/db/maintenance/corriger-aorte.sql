-- ============================================================
-- Correction de la valeur aortique au diagnostic
-- ------------------------------------------------------------
-- ---- Ce que ce fichier contenait avant, et pourquoi c'était faux ----
-- La première version de ce script partait du principe que le 45 mm du
-- dossier MRF-003 avait été fabriqué par l'IA en lisant de travers un export
-- COSMED. Vérification faite, c'était inexact : la chronologie médicale ne
-- contient aucun fait aortique. La valeur vient du champ « dilatation
-- aortique au diagnostic » du formulaire de création, saisi à la main.
-- L'évaluation datée qui porte 45 mm n'en est que la recopie automatique,
-- produite par backend/utils/sync-evaluations.js.
--
-- La conclusion a donc changé : il n'y a rien à « nettoyer », il y a
-- peut-être une saisie à corriger. Ce n'est pas la même opération, et ce
-- n'est pas la même gravité.
--
-- ---- Préférez l'interface ----
-- Corrigez depuis le dossier de la patiente → Suivi clinique → suivi
-- aortique. La modification y est tracée dans le journal des corrections,
-- avec votre nom et la date — ce que ce script ne fait pas. N'utilisez ce
-- fichier que si l'interface ne le permet pas.
--
-- ---- À MODIFIER ----
-- Le code patient et la valeur, sur les deux lignes marquées.
--
-- SAUVEGARDEZ AVANT (bouton « 💾 Sauvegarde » dans l'interface).
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette. Le bloc DO constitue
-- néanmoins une transaction implicite.
-- ============================================================

DO $$
DECLARE
  -- ↓↓↓ LES DEUX SEULES LIGNES À MODIFIER ↓↓↓
  cible    TEXT    := 'MRF-003';
  nouvelle NUMERIC := 41;
  -- ↑↑↑ ----------------------------- ↑↑↑

  avant NUMERIC;
  n BIGINT;
BEGIN
  SELECT (aortic_followup->>'first_value_mm')::numeric INTO avant
    FROM medical_records WHERE patient_id = cible;

  IF avant IS NULL THEN
    RAISE EXCEPTION 'Aucune valeur aortique au diagnostic pour % — rien à corriger.', cible;
  END IF;

  IF avant = nouvelle THEN
    RAISE NOTICE 'La valeur est déjà de % mm — rien à faire.', nouvelle;
    RETURN;
  END IF;

  -- Filtre de vraisemblance : une aorte hors de 10–90 mm est une faute de
  -- frappe, pas une mesure. Mieux vaut refuser que d'écrire une absurdité.
  IF nouvelle < 10 OR nouvelle > 90 THEN
    RAISE EXCEPTION 'Valeur invraisemblable : % mm. Correction refusée.', nouvelle;
  END IF;

  UPDATE medical_records
     SET aortic_followup = jsonb_set(aortic_followup, '{first_value_mm}', to_jsonb(nouvelle))
   WHERE patient_id = cible;
  RAISE NOTICE 'Suivi aortique : % mm -> % mm.', avant, nouvelle;

  -- L'évaluation dérivée porte encore l'ancienne valeur : sans cette mise à
  -- jour, la courbe continuerait d'afficher le chiffre corrigé ailleurs.
  UPDATE evaluations SET aorta = nouvelle
   WHERE patient_id = cible AND source = 'document' AND aorta = avant;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'Évaluations dérivées mises à jour : %.', n;
END $$;

SELECT jsonb_pretty(aortic_followup) AS suivi_aortique
  FROM medical_records WHERE patient_id = 'MRF-003';   -- ← LE MÊME CODE

SELECT id, eval_id, label, eval_date, source, aorta
  FROM evaluations WHERE patient_id = 'MRF-003'        -- ← LE MÊME CODE
 ORDER BY eval_date, id;
