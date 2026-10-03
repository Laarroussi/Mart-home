-- ============================================================
-- 025 — Cinq thématiques d'éducation thérapeutique
-- ------------------------------------------------------------
-- Les titres et les questionnaires sont écrits avant le tournage des
-- vidéos. Ce n'est pas qu'une commodité de planning : formuler d'abord les
-- questions oblige à décider ce que la capsule doit faire comprendre, et la
-- vidéo se tourne ensuite pour y répondre. Écrit dans l'autre sens, le
-- questionnaire se contente de refléter un contenu déjà figé.
--
-- Les capsules existent donc en base sans video_url. L'interface affiche
-- « Vidéo à venir » tant que le fichier manque, et le parcours du patient
-- reste bloqué à l'étape du pré-questionnaire.
--
-- ON CONFLICT DO UPDATE : la migration peut être rejouée après une
-- correction de libellé sans créer de doublon ni perdre les dossiers
-- patients qui pointent déjà sur ces capsules.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

INSERT INTO education_capsules (id, title, theme, duration, description, english, pre_questionnaire, post_questionnaire)
VALUES ('cap-traitement', 'Mes traitements et l''effort', 'Bêtabloquants · Sartans', '4 min',
        'Pourquoi votre traitement modifie votre fréquence cardiaque à l''effort, et ce que cela change pour vos séances.',
        'My medication and exercise',
        '{"items": 4, "questions": ["Savez-vous à quoi sert votre bêtabloquant ?", "Votre traitement modifie-t-il votre fréquence cardiaque à l''effort ?", "Faut-il prendre son traitement avant une séance ?", "Que faire si vous oubliez une prise un jour de séance ?"]}'::jsonb,
        '{"items": 5, "questions": ["Quel effet le bêtabloquant a-t-il sur la fréquence cardiaque, au repos et au pic ?", "Pourquoi vos zones d''entraînement sont-elles calculées sur vos seuils mesurés, et non sur « 220 moins l''âge » ?", "À quoi sert un sartan comme le losartan dans le syndrome de Marfan ?", "Peut-on arrêter son traitement parce qu''on se sent en forme ?", "Pourquoi se relever brusquement après l''effort peut-il provoquer un malaise ?"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, theme = EXCLUDED.theme,
  duration = EXCLUDED.duration, description = EXCLUDED.description, english = EXCLUDED.english,
  pre_questionnaire = EXCLUDED.pre_questionnaire, post_questionnaire = EXCLUDED.post_questionnaire;

INSERT INTO education_capsules (id, title, theme, duration, description, english, pre_questionnaire, post_questionnaire)
VALUES ('cap-securite', 'M''entraîner en sécurité', 'Sécurité · Limites', '4 min',
        'Ce qui est permis, ce qui ne l''est pas, et les signaux qui imposent d''arrêter la séance sur-le-champ.',
        'Training safely',
        '{"items": 4, "questions": ["Savez-vous quelle intensité vous est recommandée ?", "Connaissez-vous les efforts qui vous sont contre-indiqués ?", "Que faites-vous en cas de douleur thoracique pendant une séance ?", "Pouvez-vous vous entraîner seul ou seule ?"]}'::jsonb,
        '{"items": 5, "questions": ["Citez trois situations qui imposent d''interrompre immédiatement la séance.", "Pourquoi les efforts brefs et maximaux sont-ils déconseillés ?", "Quelle place occupent l''échauffement et le retour au calme ?", "Qui prévenir, et dans quel délai, après un incident survenu pendant une séance ?", "Un essoufflement progressif en endurance est-il un signe d''alerte ?"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, theme = EXCLUDED.theme,
  duration = EXCLUDED.duration, description = EXCLUDED.description, english = EXCLUDED.english,
  pre_questionnaire = EXCLUDED.pre_questionnaire, post_questionnaire = EXCLUDED.post_questionnaire;

INSERT INTO education_capsules (id, title, theme, duration, description, english, pre_questionnaire, post_questionnaire)
VALUES ('cap-charge', 'Qu''est-ce qu''une charge lourde ?', 'Renforcement · Charges', '4 min',
        'Des repères concrets pour juger si une charge est trop lourde, et travailler sa force sans bloquer sa respiration.',
        'What counts as a heavy load?',
        '{"items": 4, "questions": ["Savez-vous à partir de quel poids une charge devient lourde pour vous ?", "Connaissez-vous la notion de répétitions maximales ?", "Que se passe-t-il dans l''aorte quand on bloque sa respiration en poussant ?", "Portez-vous régulièrement des charges dans votre quotidien ?"]}'::jsonb,
        '{"items": 5, "questions": ["Comment juger qu''une charge est trop lourde, sans appareil de mesure ?", "Combien de répétitions devez-vous pouvoir enchaîner pour qu''une charge soit adaptée ?", "Pourquoi la manœuvre de Valsalva augmente-t-elle la contrainte sur l''aorte ?", "Comment respirer pendant la phase d''effort d''un exercice de force ?", "Citez deux gestes du quotidien qui équivalent à une charge lourde."]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, theme = EXCLUDED.theme,
  duration = EXCLUDED.duration, description = EXCLUDED.description, english = EXCLUDED.english,
  pre_questionnaire = EXCLUDED.pre_questionnaire, post_questionnaire = EXCLUDED.post_questionnaire;

INSERT INTO education_capsules (id, title, theme, duration, description, english, pre_questionnaire, post_questionnaire)
VALUES ('cap-discipline', 'Adapter mon sport plutôt que l''arrêter', 'Sport · Adaptation', '5 min',
        'Transformer une discipline que l''on aime en une pratique compatible avec le suivi aortique, au lieu d''y renoncer.',
        'Adapting my sport rather than giving it up',
        '{"items": 4, "questions": ["Avez-vous arrêté une activité depuis le diagnostic ?", "Savez-vous ce qui rend une discipline à risque dans le syndrome de Marfan ?", "Pensez-vous qu''un sport puisse être adapté plutôt qu''interdit ?", "Quelles disciplines vous ont été déconseillées ?"]}'::jsonb,
        '{"items": 5, "questions": ["Quels caractères rendent une discipline à risque : contact, effort statique maximal, compétition ?", "Citez une adaptation qui vous permettrait de continuer une discipline qui vous tient à cœur.", "Pourquoi la compétition pose-t-elle un problème particulier ?", "Que faire avant de reprendre une discipline interrompue ?", "La plongée sous-marine est-elle compatible, et pour quelle raison ?"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, theme = EXCLUDED.theme,
  duration = EXCLUDED.duration, description = EXCLUDED.description, english = EXCLUDED.english,
  pre_questionnaire = EXCLUDED.pre_questionnaire, post_questionnaire = EXCLUDED.post_questionnaire;

INSERT INTO education_capsules (id, title, theme, duration, description, english, pre_questionnaire, post_questionnaire)
VALUES ('cap-nutrition', 'Nutrition et activité physique', 'Nutrition · Énergie', '4 min',
        'S''alimenter pour soutenir l''effort — sans régime restrictif, qui n''a pas sa place ici.',
        'Nutrition and physical activity',
        '{"items": 4, "questions": ["Mangez-vous différemment les jours de séance ?", "Pensez-vous qu''il faille suivre un régime particulier ?", "Savez-vous quand boire pendant un effort ?", "Connaissez-vous vos besoins en protéines ?"]}'::jsonb,
        '{"items": 5, "questions": ["Un régime restrictif a-t-il sa place dans le syndrome de Marfan ?", "À quel moment prendre son repas par rapport à une séance ?", "Quel apport en protéines accompagne un travail de renforcement ?", "Comment adapter ses boissons pendant et après l''effort ?", "Quel risque fait courir une perte de poids rapide au moment de la reprise ?"]}'::jsonb)
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, theme = EXCLUDED.theme,
  duration = EXCLUDED.duration, description = EXCLUDED.description, english = EXCLUDED.english,
  pre_questionnaire = EXCLUDED.pre_questionnaire, post_questionnaire = EXCLUDED.post_questionnaire;

SELECT 'OK migration 025 — 5 capsules d education therapeutique' AS msg;
