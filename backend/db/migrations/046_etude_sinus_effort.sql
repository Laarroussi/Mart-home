-- ============================================================
-- Migration 046 — SINUS-EFFORT remplace l'étude de démonstration
-- ------------------------------------------------------------
-- L'étude MARFAN-APA-DEMO était un jeu d'essai posé par la migration 028
-- pour que la bibliothèque ne soit pas vide. Elle est remplacée par le
-- projet réel : la réponse aiguë de la racine aortique à l'exercice de
-- résistance chez le sujet sain sportif.
--
-- La démonstration n'est pas supprimée aveuglément : si un patient y a été
-- rattaché entre-temps, elle est archivée (active = FALSE) au lieu d'être
-- effacée. Son intitulé figurerait alors dans des dossiers, et faire
-- disparaître la référence rendrait ces dossiers incompréhensibles. C'est la
-- règle qu'applique déjà la route DELETE ; elle vaut aussi ici.
--
-- ── Pourquoi le plan croisé ─────────────────────────────────────────────
-- Chaque participant réalise les deux modalités, dans un ordre tiré au sort.
-- La variabilité de la mécanique aortique d'un sujet à l'autre est large,
-- celle d'un sujet à lui-même est petite : l'appariement supprime la
-- première. Concrètement, au même effet détectable, il faut 26 participants
-- en plan croisé contre 100 en deux groupes indépendants. Ce n'est pas une
-- optimisation, c'est ce qui rend l'étude réalisable.
--
-- Le profil d'entraînement reste un facteur INTER-sujets : la comparaison
-- entre athlètes d'endurance, de force et témoins ne bénéficie pas de
-- l'appariement. Elle est donc déclarée exploratoire, et non sous-dimensionnée
-- en silence.
--
-- ── Catégorie RIPH 2, et pourquoi pas 1 ─────────────────────────────────
-- Aucun participant porteur d'un syndrome de Marfan ni d'une dilatation
-- aortique. L'effort isométrique est précisément la modalité dont on se méfie
-- dans cette population : l'y soumettre pour les besoins d'une recherche ne
-- serait pas une contrainte minime, et ferait basculer le dossier en RIPH 1
-- avec autorisation ANSM. La voie retenue est d'établir d'abord la
-- faisabilité et la dispersion des mesures chez le sujet sain.
--
-- IDEMPOTENT — rejouable. PostgreSQL 9.6.
-- Prérequis : migrations 043 et 045 (colonnes du synopsis et de la méthode).
-- ============================================================

-- ------------------------------------------------------------
-- 1. L'étude de démonstration s'efface ou s'archive
-- ------------------------------------------------------------
DO $$
DECLARE n_inclus INTEGER;
BEGIN
  SELECT COUNT(*) INTO n_inclus
    FROM patients p
    JOIN etudes e ON e.id = p.etude_id
   WHERE e.acronyme = 'MARFAN-APA-DEMO';

  -- COUNT(*) renvoie toujours une ligne : tester FOUND ici ne voudrait rien
  -- dire. Seul le NULL mérite d'être couvert.
  IF n_inclus IS NULL THEN n_inclus := 0; END IF;

  IF n_inclus > 0 THEN
    UPDATE etudes SET active = FALSE, maj_le = NOW()
     WHERE acronyme = 'MARFAN-APA-DEMO';
    RAISE NOTICE 'Etude de demonstration archivee : % patient(s) y sont rattaches.', n_inclus;
  ELSE
    -- Les chapitres et variables du cahier partent en cascade.
    DELETE FROM etudes WHERE acronyme = 'MARFAN-APA-DEMO';
    RAISE NOTICE 'Etude de demonstration supprimee (aucun patient rattache).';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. SINUS-EFFORT
-- ------------------------------------------------------------
INSERT INTO etudes (
  intitule, acronyme, statut, type_etude,
  schema_etude, categorie_riph,
  population_cible, critere_jugement_principal, criteres_secondaires,
  effectif_calcule, objectif_inclusions, puissance, alpha, taille_effet,
  calcul_effectif, resume, notes,
  protocole_mesure, calendrier_visites, plan_analyse
)
SELECT
  'Réponse aiguë de la mécanique de la racine aortique à l''exercice de résistance chez le sujet '
  || 'sain sportif : contraction dynamique versus isométrique selon le profil d''entraînement',
  'SINUS-EFFORT',
  'preparation',
  'monocentrique',
  'interventionnelle_croisee',
  'riph2',

  'Adultes sans pathologie aortique ni cardiovasculaire connue, répartis en quatre profils : '
  || 'athlètes d''endurance, athlètes de force, sports mixtes, témoins peu actifs. '
  || 'Inclusion : majeur, consentement écrit, aptitude à l''effort de résistance établie par un '
  || 'médecin, fenêtre échocardiographique permettant une mesure exploitable de la racine — vérifiée '
  || 'AVANT inclusion, faute de quoi l''effort est réalisé pour rien. '
  || 'Non-inclusion : antécédent de dissection ou de chirurgie aortique, dilatation aortique connue, '
  || 'syndrome de Marfan ou autre maladie du tissu conjonctif, hypertension artérielle non contrôlée, '
  || 'insuffisance aortique plus que minime, grossesse, contre-indication cardiologique à l''effort.',

  'Différence intra-individuelle entre la variation de DISTENSIBILITÉ des sinus de Valsalva sous '
  || 'contraction ISOMÉTRIQUE et sa variation sous contraction DYNAMIQUE (×10⁻³ mmHg⁻¹), le repos '
  || 'servant de référence commune.' || chr(10)
  || 'Soit, pour chaque participant, une seule valeur :' || chr(10)
  || '• (D isométrique − D repos) − (D dynamique − D repos)' || chr(10)
  || 'Cette construction annule le niveau de base propre à chaque sujet, qui varie beaucoup d''un '
  || 'individu à l''autre et n''intéresse pas la question posée.',

  'Mêmes différences intra-individuelles pour la compliance, le strain, l''area strain, l''indice de '
  || 'rigidité β et le module Ep. Réponses hémodynamiques : ΔPAS, ΔPAD, ΔPP, ΔFC, double produit. '
  || 'Comparaison entre les quatre profils d''entraînement — exploratoire, l''appariement ne joue pas '
  || 'sur ce facteur. Faisabilité : proportion d''acquisitions exploitables sous charge, délai de '
  || 'retour aux valeurs de repos entre les deux modalités.',

  23, 26, 0.800, 0.050,
  'd = 0,60 en unités d''écart-type — σ de la différence intra-individuelle à établir sur la phase pilote',

  'Comparaison appariée isométrique / dynamique chez le même participant, α = 0,05 bilatéral, '
  || 'puissance = 0,80. Pour un effet standardisé d = Δ/σ = 0,60 : '
  || 'n = (z₁₋α/₂ + z₁₋β)²/d² = (1,959964 + 0,841621)²/0,36 = 21,8, arrondi à 22, plus un sujet pour '
  || 'l''approximation normale, soit 23 analysables ; 26 à inclure en prévoyant 10 % de séances non '
  || 'exploitables. ' || chr(10) || chr(10)
  || 'Le même effet en deux groupes indépendants demanderait 45 sujets par bras, soit 100 inclusions : '
  || 'c''est le plan croisé qui rend cette étude faisable, pas une hypothèse optimiste.' || chr(10) || chr(10)
  || 'σ n''est pas connu sur cette population et n''est pas inventé ici : l''effectif est donc exprimé '
  || 'en écarts-types tant que la phase pilote de huit à dix sujets ne l''a pas fourni. La '
  || 'justification sera réécrite en unités cliniques à ce moment-là.',

  'Contexte. La contrainte exercée sur la racine aortique pendant l''effort de résistance est au '
  || 'centre des conseils d''activité physique, et c''est l''exercice isométrique qui concentre les '
  || 'réserves. Ces conseils reposent largement sur un raisonnement physiopathologique : une élévation '
  || 'aiguë de pression augmente la contrainte pariétale. Ce que devient la MÉCANIQUE de la racine — '
  || 'sa distensibilité, sa compliance, sa rigidité instantanées — pendant cette élévation reste peu '
  || 'documenté, y compris chez le sujet sain.' || chr(10) || chr(10)
  || 'Objectif principal. Déterminer si une contraction isométrique modifie la mécanique des sinus de '
  || 'Valsalva différemment d''une contraction dynamique de charge comparable, chez le même '
  || 'participant.' || chr(10) || chr(10)
  || 'Objectifs secondaires. Décrire l''amplitude de ces variations pour la compliance, le strain, β '
  || 'et Ep ; rechercher si la réponse dépend du profil d''entraînement (endurance, force, mixte, peu '
  || 'actif) ; établir la faisabilité d''une acquisition échographique exploitable sous charge.' || chr(10) || chr(10)
  || 'Méthode. Plan croisé : chaque participant réalise les deux modalités sur presse à cuisses, dans '
  || 'un ordre tiré au sort, lors d''une même séance — repos, modalité A, retour au repos, modalité B, '
  || 'récupération. À chaque temps : Dd, Ds, PAS, PAD, FC, puis calcul des six indices de mécanique.' || chr(10) || chr(10)
  || 'Retombée attendue. Remplacer, sur un point précis du conseil en activité physique, un '
  || 'raisonnement par une mesure — chez le sujet sain d''abord, condition pour poser ensuite la même '
  || 'question chez le patient Marfan avec un dossier argumenté.' || chr(10) || chr(10)
  || 'Limites annoncées. Une réponse aiguë n''est pas un effet chronique : l''étude décrit ce qui se '
  || 'passe pendant l''effort, pas ce que devient la racine après des mois d''entraînement. Aucun insu '
  || 'n''est possible pour le participant ni pour l''opérateur ; la relecture des mesures se fait en '
  || 'aveugle de l''ordre de passage.',

  'Remplace l''étude de démonstration MARFAN-APA-DEMO. '
  || 'Points à arrêter avant rédaction du protocole : σ de la différence intra-individuelle (phase '
  || 'pilote de 8 à 10 sujets), indice d''appariement de la charge entre les deux modalités, plafond '
  || 'de pression artérielle et critères d''arrêt écrits avec le cardiologue co-investigateur, lieu et '
  || 'matériel, bibliographie avec ses sources exactes.',

  -- ---- protocole_mesure ----
  'COUPE PARASTERNALE GRAND AXE — coupe de référence' || chr(10)
  || 'Quatre niveaux repérés, mesurés sur la même ligne, faisceau aussi perpendiculaire que possible '
  || 'à la paroi :' || chr(10)
  || '• anneau aortique — repère de la valve, hors calcul de mécanique ;' || chr(10)
  || '• sinus de Valsalva — plus grand diamètre, niveau du critère principal ;' || chr(10)
  || '• jonction sinotubulaire — rétrécissement net au-dessus des sinus ;' || chr(10)
  || '• aorte ascendante proximale — 20 mm au-dessus de la jonction, repère noté au compte rendu.' || chr(10) || chr(10)

  || 'MODE TM — instants de mesure' || chr(10)
  || 'Ligne de tir perpendiculaire aux deux parois, au niveau des sinus.' || chr(10)
  || '• Dd : diamètre télédiastolique, au début du QRS, valve fermée.' || chr(10)
  || '• Ds : diamètre systolique maximal, expansion maximale, valve ouverte.' || chr(10)
  || '• Inner-edge to inner-edge, moyenne de trois cycles.' || chr(10)
  || 'Mélanger inner-edge et leading-edge entre deux temps de mesure produit une variation qui '
  || 'n''existe pas, et rien dans le résultat ne le signale.' || chr(10) || chr(10)

  || 'COUPE PARASTERNALE PETIT AXE — complément, jamais substitut' || chr(10)
  || 'Rotation d''environ 90° puis légère inclinaison céphalique : symétrie des trois sinus, '
  || 'dilatation asymétrique, diamètre transverse maximal. Les calculs restent fondés sur le grand axe.' || chr(10) || chr(10)

  || 'PRESSION ARTÉRIELLE — sur le même cycle que les diamètres' || chr(10)
  || 'Brassard homolatéral, relevé immédiatement après l''acquisition, à chacun des cinq temps. '
  || 'Quatre des six indices n''existent pas sans ΔPP : une acquisition sans pression ne donne qu''un '
  || 'strain et un area strain.' || chr(10) || chr(10)

  || 'CHARGE — appariée entre les deux modalités' || chr(10)
  || 'Presse à cuisses. L''indice d''appariement est à définir avant le début : pourcentage d''une '
  || 'répétition maximale, ou produit charge × temps sous tension. Sans cet appariement, on compare '
  || 'deux efforts différents et non deux types de contraction.' || chr(10) || chr(10)

  || 'CALCUL — jamais recopié d''un compte rendu' || chr(10)
  || 'Diamètres et pressions sont saisis ; les six indices sont recalculés par le module de mécanique '
  || 'aortique de la plateforme. Une valeur lue dans un compte rendu ne porte pas la trace des mesures '
  || 'dont elle sort, et ne se vérifie plus.',

  -- ---- calendrier_visites ----
  'T0 — repos · T1 — modalité A · T2 — retour au repos · T3 — modalité B · T4 — récupération',

  -- ---- plan_analyse ----
  'TEST PRINCIPAL' || chr(10)
  || 'Différence des différences, un seul chiffre par participant : '
  || '(Δ isométrique − Δ dynamique). Test apparié — t de Student si la distribution des différences '
  || 's''y prête, Wilcoxon sinon — α = 0,05 bilatéral. Un seul test, donc aucune correction.' || chr(10) || chr(10)

  || 'EFFET D''ORDRE ET RETOUR AU REPOS' || chr(10)
  || 'L''ordre des modalités est tiré au sort, ce qui neutralise l''effet d''ordre en moyenne. Il est '
  || 'tout de même testé comme covariable. Le retour aux valeurs de repos entre les deux modalités est '
  || 'vérifié participant par participant : un retour incomplet exclut la séance de l''analyse '
  || 'principale, et se compte dans le diagramme de flux.' || chr(10) || chr(10)

  || 'PROFIL D''ENTRAÎNEMENT — exploratoire, et annoncé comme tel' || chr(10)
  || 'Modèle mixte à mesures répétées (modalité × profil, participant en effet aléatoire). '
  || 'L''appariement ne joue pas sur ce facteur : l''étude n''est pas dimensionnée pour conclure entre '
  || 'profils, et les résultats sont présentés avec leurs intervalles de confiance plutôt que par '
  || 'leur p.' || chr(10) || chr(10)

  || 'DONNÉES MANQUANTES' || chr(10)
  || 'Aucune imputation. Un temps sans pression artérielle relevée ne donne ni distensibilité ni '
  || 'compliance : il sort de ces analyses et se compte comme tel.' || chr(10) || chr(10)

  || 'REPRODUCTIBILITÉ' || chr(10)
  || 'Coefficient de corrélation intraclasse sur un sous-échantillon relu en aveugle de l''ordre de '
  || 'passage. Une variation inférieure à l''erreur de mesure n''est pas une variation.'
WHERE NOT EXISTS (SELECT 1 FROM etudes WHERE acronyme = 'SINUS-EFFORT');

-- ------------------------------------------------------------
-- Vérification
-- ------------------------------------------------------------
SELECT id, acronyme, statut, active, schema_etude, categorie_riph,
       effectif_calcule, objectif_inclusions,
       length(resume) AS abstract, length(protocole_mesure) AS protocole,
       length(plan_analyse) AS analyse
  FROM etudes ORDER BY id;

SELECT 'OK migration 046 — SINUS-EFFORT remplace la demonstration' AS msg;
