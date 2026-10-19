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
-- IDEMPOTENT — rejouable sans créer de doublon. PostgreSQL 9.6.
-- Prérequis : migration 043 (colonnes du synopsis).
-- ============================================================

INSERT INTO etudes (
  intitule, acronyme, statut, type_etude,
  schema_etude, categorie_riph,
  population_cible, critere_jugement_principal, criteres_secondaires,
  effectif_calcule, objectif_inclusions, puissance, alpha, taille_effet,
  calcul_effectif, resume, notes
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

  'Variation de la distensibilité des sinus de Valsalva entre l''inclusion et le douzième mois '
  || '(×10⁻³ mmHg⁻¹), calculée sous forme surfacique D = (Ds² − Dd²) / (Dd² × ΔPP), '
  || 'à partir de diamètres mesurés en inner-edge au même niveau anatomique, moyennés sur trois '
  || 'cycles, et d''une pression artérielle relevée au moment de l''examen.',

  'Aux trois niveaux (sinus de Valsalva, jonction sinotubulaire, aorte ascendante) : distensibilité, '
  || 'compliance, indice de rigidité β, strain, area strain, module Ep. '
  || 'Diamètres absolus et indexés à la taille et à la surface corporelle (Du Bois). '
  || 'Capacité à l''effort (VO₂ pic, SV1, pente VE/VCO₂), assiduité au programme, '
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
  || 'catégorie RIPH selon que les échocardiographies relèvent ou non du suivi habituel.'
WHERE NOT EXISTS (SELECT 1 FROM etudes WHERE acronyme = 'MECA-AORTE');

-- ------------------------------------------------------------
-- Vérification
-- ------------------------------------------------------------
SELECT id, acronyme, statut, schema_etude, categorie_riph,
       effectif_calcule, objectif_inclusions, puissance, alpha,
       length(resume) AS taille_abstract
  FROM etudes ORDER BY id;

SELECT 'OK migration 045 — etude MECA-AORTE' AS msg;
