-- ============================================================
-- Renumérotation des patients réels, par population
-- ------------------------------------------------------------
-- À lancer APRÈS supprimer-demo.sql, et seulement à ce moment-là : tant que
-- les fiches de démonstration occupent MRF-001 à MRF-020, les numéros visés
-- sont déjà pris.
--
-- Chaque population repart de 1, dans l'ordre de création : le premier
-- patient inclus devient MRF-001, le deuxième MRF-002, et ainsi de suite pour
-- OBE, ICA, DT2, TEM et AUT.
--
-- ---- Pourquoi une copie plutôt qu'un simple UPDATE ----
-- L'identifiant est la clé primaire et une quinzaine de tables la
-- référencent. Les clés étrangères sont déclarées ON DELETE CASCADE mais pas
-- ON UPDATE CASCADE : renommer la clé directement ferait échouer la
-- contrainte. On procède en trois temps pour chaque fiche — créer la nouvelle,
-- déplacer tout ce qui s'y rattache, supprimer l'ancienne. À aucun instant
-- une ligne ne pointe vers un identifiant inexistant.
--
-- ---- Pourquoi un passage par des codes temporaires ----
-- Renuméroter en une seule passe peut se télescoper : si un patient doit
-- devenir MRF-001 pendant qu'un autre quitte MRF-001, l'ordre des opérations
-- décide du succès. On déplace donc d'abord tout le monde vers des codes
-- provisoires, puis vers les codes définitifs. Aucune collision n'est alors
-- possible, quel que soit l'ordre.
--
-- ---- Ce qui est préservé ----
-- Tout : évaluations, consultations, échocardiographies, chronologie,
-- synthèses, bilans, entretiens, séances, questionnaires, audit — et le compte
-- de connexion du patient avec son mot de passe. Une patiente qui vient
-- d'activer son espace n'a rien à refaire.
--
-- ---- Avant de lancer ----
-- SAUVEGARDEZ. Cette opération touche la clé primaire de toutes les données
-- cliniques. Elle est écrite pour être sûre, elle n'est pas anodine.
--
-- Rejouable : un patient déjà bien numéroté n'est pas déplacé.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette. Le bloc DO constitue
-- néanmoins une transaction implicite — soit tout passe, soit rien.
-- ============================================================

-- Le déplacement d'une fiche est écrit une fois, dans une fonction
-- temporaire : PL/pgSQL n'accepte pas de sous-programme local dans un bloc DO,
-- et recopier cette logique aux deux passes serait le meilleur moyen de les
-- voir diverger. pg_temp disparaît à la fin de la session.
CREATE OR REPLACE FUNCTION pg_temp.deplacer_patient(src TEXT, dst TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  colonnes TEXT;
  valeurs  TEXT;
  t RECORD;
  n BIGINT;
BEGIN
  -- Liste des colonnes de `patients`, et les mêmes valeurs avec l'identifiant
  -- remplacé. Construite depuis le catalogue : une colonne ajoutée plus tard
  -- sera copiée sans que personne ait à modifier ce fichier.
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position),
         string_agg(CASE WHEN column_name = 'id'
                         THEN quote_literal(dst)
                         ELSE quote_ident(column_name) END,
                    ', ' ORDER BY ordinal_position)
    INTO colonnes, valeurs
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'patients';

  EXECUTE format('INSERT INTO patients (%s) SELECT %s FROM patients WHERE id = %L',
                 colonnes, valeurs, src);

  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables x
        ON x.table_schema = c.table_schema AND x.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'patient_id'
       AND x.table_type = 'BASE TABLE'
       AND c.table_name <> 'patients'
     ORDER BY c.table_name
  LOOP
    EXECUTE format('UPDATE %I SET patient_id = $1 WHERE patient_id = $2', t.table_name)
      USING dst, src;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE '      % : % ligne(s)', rpad(t.table_name, 26), n; END IF;
  END LOOP;

  DELETE FROM patients WHERE id = src;
END $$;

DO $$
DECLARE
  m RECORD;
  cible TEXT;
  temporaire TEXT;
  deplaces INT := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM patients WHERE COALESCE(is_demo, FALSE)) THEN
    RAISE EXCEPTION
      'Des fiches de démonstration sont encore présentes. '
      'Lancez supprimer-demo.sql avant cette renumérotation.';
  END IF;

  CREATE TEMP TABLE plan_renum ON COMMIT DROP AS
    SELECT p.id AS ancien,
           COALESCE(p.categorie, 'MRF') || '-' ||
             lpad(row_number() OVER (
               PARTITION BY COALESCE(p.categorie, 'MRF')
               ORDER BY p.created_at NULLS LAST, p.id)::text, 3, '0') AS nouveau,
           row_number() OVER (ORDER BY p.created_at NULLS LAST, p.id) AS rang_global
      FROM patients p;

  -- Passe 1 : tout le monde vers un code provisoire, pour écarter toute
  -- collision entre un code libéré et un code visé.
  FOR m IN SELECT * FROM plan_renum WHERE ancien <> nouveau ORDER BY rang_global LOOP
    temporaire := 'TMP-' || lpad(m.rang_global::text, 4, '0');
    RAISE NOTICE '% -> % (provisoire)', m.ancien, temporaire;
    PERFORM pg_temp.deplacer_patient(m.ancien, temporaire);
    UPDATE plan_renum SET ancien = temporaire WHERE rang_global = m.rang_global;
    deplaces := deplaces + 1;
  END LOOP;

  -- Passe 2 : des codes provisoires vers les codes définitifs.
  FOR m IN SELECT * FROM plan_renum WHERE ancien <> nouveau ORDER BY rang_global LOOP
    RAISE NOTICE '% -> %', m.ancien, m.nouveau;
    PERFORM pg_temp.deplacer_patient(m.ancien, m.nouveau);
  END LOOP;

  RAISE NOTICE 'Renumérotation terminée : % fiche(s) déplacée(s).', deplaces;
END $$;

DROP FUNCTION IF EXISTS pg_temp.deplacer_patient(TEXT, TEXT);

SELECT id, categorie,
       COALESCE(civil->>'lastName', '—') AS nom,
       created_at::date AS cree_le
  FROM patients ORDER BY categorie, id;
