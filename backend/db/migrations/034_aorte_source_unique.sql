-- ============================================================
-- Migration 034 — L'aorte : une seule source par mesure
-- ------------------------------------------------------------
-- Une valeur aortique s'écrivait dans cinq endroits. Quatre d'entre eux sont
-- légitimes : ce sont des actes distincts — un compte rendu d'écho, une
-- consultation, le champ de création, une extraction de document. Le
-- cinquième, `evaluations.aorta`, est une projection reconstruite.
--
-- Le défaut n'était pas la multiplicité des origines, mais une RECOPIE :
--
--   enregistrement d'une écho  →  aortic_followup.current_value_mm
--   enregistrement d'une consultation →  aortic_followup.current_value_mm
--   puis sync-evaluations relit ce champ comme une origine à part entière,
--   sous le nom « évaluation actuelle ».
--
-- Deux conséquences, toutes deux observées :
--   • la même mesure entre deux fois dans la courbe, sous deux étiquettes,
--     et parfois à deux dates — celle de l'examen et celle de la recopie ;
--   • « évaluation actuelle » n'étant pas reconnue comme échocardiographie,
--     une vraie mesure recopiée là redescend en « déclarée ». Le niveau de
--     preuve se dégrade tout seul, sans que rien ne le signale.
--
-- ---- Ce que fait ce script ----
-- Les `current_*` existants ne sont pas effacés : ils deviennent des
-- consultations datées, avec une note disant d'où ils viennent. Une donnée
-- clinique ne disparaît pas parce qu'on réorganise un schéma.
--
-- Puis la clé est retirée de `aortic_followup`, qui ne conserve plus que la
-- valeur de départ (`first_*`) — celle saisie à la création, en attendant
-- les documents. C'est son seul rôle, et il est utile : on crée le dossier
-- avant d'avoir les examens.
--
-- IDEMPOTENT — rejouable. Pas de BEGIN/COMMIT.
-- SAUVEGARDEZ AVANT.
-- ============================================================

-- --- 1. Avant : ce qui va être transformé ---
SELECT patient_id,
       aortic_followup->>'first_value_mm'   AS depart_mm,
       aortic_followup->>'current_value_mm' AS actuelle_mm,
       aortic_followup->>'current_date'     AS actuelle_date,
       aortic_followup->>'current_site'     AS actuelle_site
  FROM medical_records
 WHERE aortic_followup ? 'current_value_mm'
 ORDER BY patient_id;

DO $$
DECLARE
  r RECORD;
  d DATE;
  creees INT := 0;
  deja   INT := 0;
BEGIN
  FOR r IN
    SELECT patient_id,
           (aortic_followup->>'current_value_mm')::numeric AS valeur,
           NULLIF(aortic_followup->>'current_date', '')::date AS le_jour,
           NULLIF(aortic_followup->>'current_site', '') AS site
      FROM medical_records
     WHERE aortic_followup ? 'current_value_mm'
       AND NULLIF(aortic_followup->>'current_value_mm', '') IS NOT NULL
  LOOP
    d := COALESCE(r.le_jour, CURRENT_DATE);

    -- Une consultation portant déjà cette mesure ce jour-là signifie que la
    -- recopie venait précisément d'elle : il n'y a rien à créer. C'est ce
    -- qui rend le script rejouable sans produire de doublons.
    IF EXISTS (SELECT 1 FROM consultations
                WHERE patient_id = r.patient_id
                  AND consultation_date = d
                  AND aortic_value_mm = r.valeur) THEN
      deja := deja + 1;
      CONTINUE;
    END IF;

    -- Même chose si une échocardiographie de ce jour porte la valeur : la
    -- recopie en venait, et l'original est déjà en base.
    IF EXISTS (SELECT 1 FROM echo_reports
                WHERE patient_id = r.patient_id
                  AND exam_date = d
                  AND (sinus_valsalva_mm = r.valeur OR aorte_max_mm = r.valeur)) THEN
      deja := deja + 1;
      CONTINUE;
    END IF;

    INSERT INTO consultations (patient_id, consultation_date, aortic_value_mm,
                               aortic_site, comment)
    VALUES (r.patient_id, d, r.valeur, r.site,
            'Reprise de la valeur « actuelle » du suivi aortique (migration 034). '
            'Origine exacte inconnue : vérifier sur le compte rendu.');
    creees := creees + 1;
  END LOOP;

  RAISE NOTICE 'Consultations créées : % — déjà présentes ailleurs : %', creees, deja;

  -- La clé disparaît du suivi aortique. `first_*` reste : c'est la valeur de
  -- départ saisie à la création, en attendant les documents.
  UPDATE medical_records
     SET aortic_followup = aortic_followup - 'current_value_mm'
                                           - 'current_date'
                                           - 'current_site',
         updated_at = NOW()
   WHERE aortic_followup ?| ARRAY['current_value_mm','current_date','current_site'];
  RAISE NOTICE 'Clés « current » retirées du suivi aortique.';
END $$;

-- --- 2. Après ---
SELECT patient_id, jsonb_pretty(aortic_followup) AS suivi_aortique
  FROM medical_records ORDER BY patient_id;

SELECT patient_id, consultation_date, aortic_value_mm, aortic_site
  FROM consultations ORDER BY patient_id, consultation_date;

SELECT 'OK migration 034 — aorte, source unique' AS msg;
