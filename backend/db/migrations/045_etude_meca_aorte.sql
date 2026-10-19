-- ============================================================
-- Migration 045 — Étude MECA-AORTE dans la bibliothèque
-- ------------------------------------------------------------
-- Deuxième étude de la bibliothèque, distincte de MARFAN-APA-DEMO.
--
--   MARFAN-APA-DEMO  interventionnelle : l'effet d'un programme d'APA de
--                    douze mois sur la capacité à l'effort.
--   MECA-AORTE       observationnelle : ce que devient la mécanique de
--                    l'aorte proximale pendant ce suivi, mesurée à trois
--                    niveaux.
--
-- Les deux portent sur les mêmes patients et ne répondent pas à la même
-- question. Les fondre en une seule rendrait le critère de jugement
-- principal impossible à désigner — or c'est lui qui fixe l'effectif.
--
-- ── Trois niveaux, trois colonnes, trois analyses ───────────────────────
-- Sinus de Valsalva, jonction sinotubulaire et aorte ascendante ne se
-- comportent pas de la même façon : la dilatation marfanique débute aux
-- sinus, et la paroi n'a ni la même composition ni la même contrainte d'un
-- niveau à l'autre. Les moyenner donnerait un chiffre qui ne décrit aucun
-- segment (règle 5 de REGLES-DONNEES.md : une colonne, une seule
-- signification). Le critère principal ne porte donc que sur les sinus ; les
-- deux autres niveaux sont des critères secondaires, et c'est une décision
-- de méthode, pas une commodité d'affichage.
--
-- ── L'effectif ──────────────────────────────────────────────────────────
-- Il est exprimé en effet STANDARDISÉ, faute de connaître encore σ. Dire
-- « n = 23 pour détecter d = 0,60 » est exact et vérifiable ; écrire
-- « n = 23 pour détecter 0,8 × 10⁻³ mmHg⁻¹ » exigerait un écart-type que
-- personne n'a encore mesuré sur cette population, et donnerait à un nombre
-- inventé l'apparence d'une donnée. La phase pilote donnera σ, et la
-- justification sera alors réécrite en unités cliniques.
--
-- Calcul vérifié par projet-etude.js (33 contrôles) :
--   (z0,975 + z0,80)² / 0,60² = (1,959964 + 0,841621)² / 0,36 = 21,80
--   → 22, +1 pour l'approximation normale = 23 analysables
--   → 23 / 0,90 = 25,6 → 26 à inclure avec 10 % de perdus de vue.
--
-- ── Trois paramètres sur le critère principal ───────────────────────────
-- Le critère principal porte sur les sinus avec compliance, distensibilité
-- ET strain. Trois paramètres, c'est trois tests : conclure dès que l'un des
-- trois est significatif porte le risque réel de 5 % à près de 14 %. Deux
-- parades honnêtes, et il faut en choisir une AVANT de mesurer :
--
--   hiérarchie      la distensibilité est testée la première ; les deux
--                   autres ne sont interprétés que si elle est positive.
--                   Effectif inchangé : 23 analysables, 26 à inclure.
--   correction      les trois sont testés à α = 0,0167 (Bonferroni).
--                   Effectif : 31 analysables, 35 à inclure.
--
-- La hiérarchie est retenue ici, parce qu'elle ne coûte pas d'effectif et
-- que la distensibilité est le paramètre le plus documenté des trois. Le
-- champ `plan_analyse` le dit explicitement : un ordre de test décidé après
-- coup n'est plus un ordre de test.
--
-- IDEMPOTENT — rejouable sans créer de doublon. PostgreSQL 9.6.
-- Prérequis : migration 043 (colonnes du synopsis).
-- ============================================================

-- Trois champs que la fiche affiche dans son onglet Méthodologie. Ils sont
-- en texte libre et non en colonnes structurées : une méthodologie se rédige,
-- et la découper en cases obligerait à inventer un modèle commun à toutes les
-- études avant d'en avoir écrit deux.
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS protocole_mesure   TEXT;
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS calendrier_visites TEXT;
ALTER TABLE etudes ADD COLUMN IF NOT EXISTS plan_analyse       TEXT;

INSERT INTO etudes (
  intitule, acronyme, statut, type_etude,
  schema_etude, categorie_riph,
  population_cible, critere_jugement_principal, criteres_secondaires,
  effectif_calcule, objectif_inclusions, puissance, alpha, taille_effet,
  calcul_effectif, resume, notes,
  protocole_mesure, calendrier_visites, plan_analyse
)
SELECT
  'Mécanique de l''aorte proximale sous activité physique adaptée dans le syndrome de Marfan : '
  || 'étude échocardiographique à trois niveaux (sinus de Valsalva, jonction sinotubulaire, aorte ascendante)',
  'MECA-AORTE',
  'preparation',
  'monocentrique',
  'observationnelle_prospective',
  -- RIPH 3 tant que les échocardiographies restent celles du suivi habituel.
  -- Programmer un examen supplémentaire pour les seuls besoins de l'étude
  -- ferait basculer le dossier en RIPH 2 : c'est la seule chose qui change
  -- la catégorie, et elle se décide avant le dépôt, pas après.
  'riph3',

  'Adultes porteurs d''un syndrome de Marfan confirmé (critères de Ghent révisés), '
  || 'inclus dans le programme d''activité physique adaptée, disposant d''une fenêtre '
  || 'échocardiographique permettant une mesure exploitable de la racine aortique. '
  || 'Non-inclusion : antécédent de chirurgie ou de dissection aortique, valve aortique '
  || 'prothétique, hypertension artérielle non contrôlée, grossesse.',

  'Mécanique des SINUS DE VALSALVA entre l''inclusion et le douzième mois, évaluée par trois '
  || 'paramètres calculés sur les mêmes diamètres et la même pression artérielle :' || chr(10)
  || '• distensibilité (×10⁻³ mmHg⁻¹) — D = (Ds² − Dd²) / (Dd² × ΔPP)' || chr(10)
  || '• compliance (mm²/mmHg) — C = π (Ds² − Dd²) / (4 ΔPP)' || chr(10)
  || '• strain (%) — (Ds − Dd) / Dd' || chr(10)
  || 'Les trois exigent une pression artérielle relevée PENDANT l''examen : sans ΔPP, ni la '
  || 'distensibilité ni la compliance n''existent, et le strain seul ne dit rien de la rigidité. '
  || 'Test hiérarchisé, la distensibilité en premier (voir le plan d''analyse).',

  'Mêmes trois paramètres à la JONCTION SINOTUBULAIRE et sur l''AORTE ASCENDANTE, analysés de '
  || 'façon exploratoire et comparés entre niveaux. Indice de rigidité β et module Ep aux trois '
  || 'niveaux. Area strain. Diamètres absolus et indexés à la taille et à la surface corporelle '
  || '(Du Bois). Capacité à l''effort (VO₂ pic, SV1, pente VE/VCO₂), assiduité au programme, '
  || 'double produit de repos. Reproductibilité intra- et inter-opérateur sur un sous-échantillon.',

  23, 26, 0.800, 0.050,
  'd = 0,60 en unités d''écart-type — Δ et σ à établir sur la phase pilote',

  'Comparaison appariée inclusion / douzième mois (chaque patient est son propre témoin), '
  || 'α = 0,05 bilatéral, puissance = 0,80. Pour un effet standardisé d = Δ/σ = 0,60 : '
  || 'n = (z₁₋α/₂ + z₁₋β)²/d² = (1,959964 + 0,841621)²/0,36 = 21,8, arrondi à 22, plus un sujet '
  || 'pour l''approximation normale, soit 23 analysables ; 26 à inclure en prévoyant 10 % de '
  || 'perdus de vue. À d = 0,50 il faudrait 37 inclusions, à d = 0,70 seulement 20 : l''effectif '
  || 'est donc entièrement commandé par σ, que la phase pilote doit fournir. '
  || 'Cette justification sera réécrite en unités cliniques dès que σ sera connu.',

  'Contexte. La surveillance du syndrome de Marfan repose sur le diamètre aortique, mesure tardive '
  || 'par construction : elle constate une dilatation déjà constituée. La mécanique de la paroi — '
  || 'distensibilité, compliance, rigidité — décrit le comportement du tissu plutôt que son état, '
  || 'et se modifie en principe avant lui. Son évolution sous activité physique adaptée n''est pas '
  || 'documentée, alors que c''est précisément la crainte d''une contrainte pariétale accrue qui '
  || 'limite les conseils d''activité donnés à ces patients.' || chr(10) || chr(10)
  || 'Objectif principal. Décrire la variation à douze mois de la distensibilité des sinus de '
  || 'Valsalva chez des patients Marfan suivis en APA.' || chr(10) || chr(10)
  || 'Objectifs secondaires. Décrire la même variation à la jonction sinotubulaire et sur l''aorte '
  || 'ascendante ; rechercher si elle diffère d''un niveau à l''autre ; examiner son lien avec '
  || 'l''assiduité au programme et avec l''évolution de la capacité à l''effort.' || chr(10) || chr(10)
  || 'Méthode. Cohorte prospective monocentrique. Échocardiographies d''inclusion, de sixième et de '
  || 'douzième mois, acquises selon une convention unique (inner-edge, même niveau anatomique, '
  || 'moyenne de trois cycles) avec pression artérielle relevée pendant l''examen. Les indices sont '
  || 'recalculés depuis les diamètres par le module de mécanique aortique de la plateforme ; aucune '
  || 'valeur n''est recopiée d''un compte rendu.' || chr(10) || chr(10)
  || 'Limites annoncées. Absence de groupe témoin : une variation observée ne peut être attribuée à '
  || 'l''APA plutôt qu''à l''évolution naturelle, et l''étude ne le prétendra pas. La distensibilité '
  || 'dépend de la pression au moment de la mesure, d''où l''exigence d''une PA relevée à l''examen '
  || 'et non reprise d''une consultation voisine. La reproductibilité de la mesure des diamètres '
  || 'conditionne tout le reste : elle est mesurée, pas supposée.',

  'Distincte de MARFAN-APA-DEMO, qui évalue l''effet du programme sur la capacité à l''effort. '
  || 'Mêmes patients, question différente. '
  || 'Points à arrêter avant rédaction du protocole : σ de la variation intra-individuelle '
  || '(phase pilote), opérateur unique ou mesure de reproductibilité, et confirmation de la '
  || 'catégorie RIPH selon que les échocardiographies relèvent ou non du suivi habituel.',

  -- ---- protocole_mesure : les coupes et la convention ----
  'COUPE PARASTERNALE GRAND AXE — coupe de référence' || chr(10)
  || 'Les trois niveaux sont mesurés sur cette coupe, sur la même ligne, faisceau aussi '
  || 'perpendiculaire que possible à la paroi :' || chr(10)
  || '• sinus de Valsalva — plus grand diamètre du sinus, niveau du critère principal ;' || chr(10)
  || '• jonction sinotubulaire — rétrécissement net au-dessus des sinus ;' || chr(10)
  || '• aorte ascendante — 20 mm au-dessus de la jonction, repère à noter sur le compte rendu.' || chr(10)
  || 'L''anneau aortique est relevé pour mémoire mais n''entre dans aucun calcul de mécanique : '
  || 'sa déformation suit la valve, pas la paroi.' || chr(10) || chr(10)

  || 'COUPE PARASTERNALE PETIT AXE — complément, jamais substitut' || chr(10)
  || 'Depuis le grand axe, rotation d''environ 90° puis légère inclinaison céphalique. Elle montre '
  || 'les trois sinus en coupe transversale : symétrie de la racine, dilatation asymétrique, '
  || 'diamètre transverse maximal. Les calculs restent fondés sur les diamètres du grand axe.' || chr(10) || chr(10)

  || 'CONVENTION — la même à toutes les visites' || chr(10)
  || '• Dd : diamètre télédiastolique, au début du QRS, valve fermée.' || chr(10)
  || '• Ds : diamètre systolique maximal, expansion maximale, valve ouverte.' || chr(10)
  || '• Inner-edge to inner-edge, moyenne de trois cycles.' || chr(10)
  || 'Mélanger inner-edge et leading-edge entre deux visites produit une variation qui n''existe '
  || 'pas, et rien dans le résultat ne le signale. C''est la première cause d''erreur de ce type '
  || 'd''étude.' || chr(10) || chr(10)

  || 'PRESSION ARTÉRIELLE — pendant l''examen, pas avant, pas après' || chr(10)
  || 'Brassard homolatéral, patient en décubitus, relevé immédiatement après l''acquisition des '
  || 'diamètres, sur le même cycle de mesure. Une pression prise à une autre consultation donnerait '
  || 'une distensibilité fausse sans qu''aucun contrôle ne puisse la rattraper.' || chr(10) || chr(10)

  || 'CALCUL — jamais recopié d''un compte rendu' || chr(10)
  || 'Les diamètres et la pression sont saisis ; les six indices sont recalculés par le module de '
  || 'mécanique aortique de la plateforme (onglet Mécanique aortique). Une valeur de rapport lue '
  || 'dans un compte rendu ne porte pas la trace des mesures dont elle sort, et ne se vérifie plus.',

  -- ---- calendrier_visites ----
  'M0 — inclusion · M6 — intermédiaire · M12 — fin de suivi',

  -- ---- plan_analyse ----
  'TEST PRINCIPAL — hiérarchisé, ordre fixé avant la première mesure' || chr(10)
  || '1. Distensibilité des sinus, M0 vs M12, test apparié (t de Student si la distribution des '
  || 'différences le permet, Wilcoxon sinon), α = 0,05 bilatéral.' || chr(10)
  || '2. Compliance des sinus — interprétée seulement si l''étape 1 est significative.' || chr(10)
  || '3. Strain des sinus — interprété seulement si l''étape 2 l''est.' || chr(10)
  || 'Dès qu''une étape n''est pas significative, les suivantes sont descriptives. Cette hiérarchie '
  || 'tient le risque global à 5 % sans augmenter l''effectif ; la correction de Bonferroni '
  || '(α = 0,0167 sur les trois) le ferait passer de 26 à 35 inclusions.' || chr(10) || chr(10)

  || 'CRITÈRES SECONDAIRES — exploratoires, et annoncés comme tels' || chr(10)
  || 'Jonction sinotubulaire et aorte ascendante : mêmes tests, sans correction, résultats présentés '
  || 'avec leurs intervalles de confiance et non par leur p. Comparaison entre niveaux par modèle '
  || 'mixte à mesures répétées (niveau × temps, patient en effet aléatoire).' || chr(10) || chr(10)

  || 'DONNÉES MANQUANTES' || chr(10)
  || 'Une visite sans pression artérielle relevée ne donne ni distensibilité ni compliance : elle '
  || 'est exclue de ces analyses, et comptée comme telle dans le diagramme de flux. Aucune valeur '
  || 'n''est imputée.' || chr(10) || chr(10)

  || 'REPRODUCTIBILITÉ' || chr(10)
  || 'Coefficient de corrélation intraclasse sur un sous-échantillon relu en aveugle. Une variation '
  || 'à douze mois inférieure à l''erreur de mesure n''est pas une variation.'
WHERE NOT EXISTS (SELECT 1 FROM etudes WHERE acronyme = 'MECA-AORTE');

-- ------------------------------------------------------------
-- Vérification
-- ------------------------------------------------------------
SELECT id, acronyme, statut, schema_etude, categorie_riph,
       effectif_calcule, objectif_inclusions, puissance, alpha,
       length(resume) AS taille_abstract
  FROM etudes ORDER BY id;

SELECT 'OK migration 045 — etude MECA-AORTE' AS msg;
