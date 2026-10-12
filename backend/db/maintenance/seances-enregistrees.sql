-- ============================================================
-- Qu'ont vraiment enregistré les séances ? — lecture seule
-- ------------------------------------------------------------
-- Un patient rapporte une heure d'entraînement et ne voit que 48 secondes
-- à l'écran. Deux explications possibles, et elles n'ont pas les mêmes
-- conséquences :
--
--   a) seul le COMPTEUR AFFICHÉ était faux. Le serveur calcule la durée
--      avec NOW() - started_at, qui ne dépend d'aucune minuterie du
--      navigateur : la durée en base serait alors juste, et la séance
--      exploitable. Il manquerait seulement la courbe de fréquence.
--
--   b) la séance elle-même est tronquée en base. Il faudrait alors
--      l'écarter des analyses.
--
-- Ce script tranche. Il compare, pour chaque séance, la durée calculée par
-- le serveur, l'écart réel entre le début et la fin, le nombre de relevés
-- conservés, et l'instant du dernier relevé. Un dernier relevé à 48 s sur
-- une séance de 3600 s signe le gel des minuteries en arrière-plan.
-- ============================================================

-- 1. Les séances récentes, et ce qu'elles contiennent réellement.
SELECT s.id,
       s.patient_id,
       s.started_at::timestamp(0)                                   AS debut,
       s.ended_at::timestamp(0)                                     AS fin,
       s.status,
       s.duration_s                                                 AS duree_enregistree_s,
       EXTRACT(EPOCH FROM (s.ended_at - s.started_at))::INTEGER      AS duree_reelle_s,
       (SELECT count(*) FROM training_samples t WHERE t.session_id = s.id)        AS nb_releves,
       (SELECT max(t.t_seconds) FROM training_samples t WHERE t.session_id = s.id) AS dernier_releve_s
  FROM training_sessions s
 ORDER BY s.started_at DESC
 LIMIT 40;

-- 2. Le diagnostic, séance par séance.
--
--    « minuteries gelees » : les relevés s'arrêtent très tôt alors que la
--    séance a duré longtemps — c'est le cas décrit par le patient.
--    « duree tronquee »    : la durée en base est elle aussi fausse, la
--    séance n'est pas exploitable.
SELECT s.id,
       s.patient_id,
       s.duration_s AS duree_s,
       (SELECT max(t.t_seconds) FROM training_samples t WHERE t.session_id = s.id) AS dernier_releve_s,
       CASE
         WHEN s.ended_at IS NULL THEN 'seance jamais arretee'
         WHEN (SELECT count(*) FROM training_samples t WHERE t.session_id = s.id) = 0
           THEN 'aucun releve (ceinture absente ou arriere-plan total)'
         WHEN s.duration_s >= 300
          AND (SELECT max(t.t_seconds) FROM training_samples t WHERE t.session_id = s.id) < s.duration_s * 0.5
           THEN 'minuteries gelees : duree OK, courbe FC incomplete'
         ELSE 'coherent'
       END AS diagnostic
  FROM training_sessions s
 WHERE s.started_at > NOW() - INTERVAL '30 days'
 ORDER BY s.started_at DESC;

-- 3. Résumé chiffré, pour savoir combien de séances sont concernées.
SELECT count(*)                                              AS seances_30_jours,
       count(*) FILTER (WHERE ended_at IS NULL)              AS jamais_arretees,
       count(*) FILTER (WHERE duration_s IS NULL OR duration_s = 0) AS sans_duree,
       round(avg(duration_s) FILTER (WHERE duration_s > 0))  AS duree_moyenne_s
  FROM training_sessions
 WHERE started_at > NOW() - INTERVAL '30 days';
