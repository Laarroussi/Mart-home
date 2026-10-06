-- ============================================================
-- 028 — Étude de démonstration et son cahier d'observation
-- ------------------------------------------------------------
-- Un écran vide n'apprend rien. Pour juger si l'onglet Recherche clinique
-- fait ce qu'on attend, il faut un protocole réaliste sous les yeux : un
-- cahier avec ses visites, des variables de types variés, et des patients
-- rattachés.
--
-- L'étude porte l'acronyme MARFAN-APA-DEMO et le statut « en préparation ».
-- Les numéros CPP et NCT sont volontairement marqués DEMO : ils ne doivent
-- jamais être confondus avec de vrais numéros réglementaires, et un faux
-- numéro au format plausible dans une base de recherche est une erreur qui
-- se propage vite.
--
-- Seuls les patients de démonstration (is_demo = TRUE) sont rattachés. Un
-- patient réel n'entre dans un protocole que par un acte explicite de
-- l'investigateur — ce n'est pas une migration qui l'y met.
--
-- Rejouable : l'étude est reconnue à son acronyme, et le cahier est reconstruit
-- à l'identique plutôt que dupliqué.
--
-- Pour l'effacer : il suffit de la supprimer depuis l'interface. Elle n'a
-- aucun patient réel, donc elle se supprime vraiment au lieu d'être archivée.
--
-- Pas de BEGIN/COMMIT : phpPgAdmin les rejette.
-- ============================================================

-- ====== 1. LA FICHE D'ÉTUDE ======
INSERT INTO etudes (intitule, acronyme, resume, numero_cpp, numero_nct, promoteur,
                    investigateur_principal, type_etude, statut, date_debut, date_fin,
                    objectif_inclusions, notes, cree_par, maj_par)
SELECT
  'Réentraînement à l''effort supervisé à distance chez des patients atteints du syndrome de Marfan',
  'MARFAN-APA-DEMO',
  'Étude interventionnelle monocentrique évaluant l''effet d''un programme de douze mois ' ||
  'd''activité physique adaptée, conduit en visioconférence avec suivi de la fréquence ' ||
  'cardiaque en direct, chez des adultes porteurs d''un syndrome de Marfan sans ' ||
  'indication chirurgicale aortique immédiate. Le critère de jugement principal est la ' ||
  'variation du VO2 pic entre l''inclusion et le douzième mois. Les critères secondaires ' ||
  'portent sur les seuils ventilatoires, la force isométrique, la qualité de vie mesurée ' ||
  'par le SF-36, le niveau d''activité physique mesuré par le GPAQ, l''observance des ' ||
  'séances et la stabilité du diamètre aortique.',
  'CPP-DEMO-0000',
  'NCT-DEMO-0000',
  'CHU — Centre de référence Marfan (exemple)',
  'Dr Exemple',
  'Interventionnelle, monocentrique, avant-après',
  'preparation',
  CURRENT_DATE - 180,
  CURRENT_DATE + 365,
  40,
  'Étude de démonstration, créée pour illustrer l''onglet Recherche clinique. ' ||
  'Les numéros CPP et NCT ne sont pas des numéros réels. Supprimable depuis l''interface.',
  'migration-028', 'migration-028'
WHERE NOT EXISTS (SELECT 1 FROM etudes WHERE acronyme = 'MARFAN-APA-DEMO');

-- ====== 2. LE CAHIER D'OBSERVATION ======
-- On repart des chapitres existants pour rester rejouable : si la migration a
-- déjà tourné, on ne crée pas un second cahier à côté du premier.
DELETE FROM ecrf_sections
 WHERE etude_id = (SELECT id FROM etudes WHERE acronyme = 'MARFAN-APA-DEMO');

INSERT INTO ecrf_sections (etude_id, titre, description, visite, rang)
SELECT e.id, s.titre, s.description, s.visite, s.rang
  FROM etudes e,
  (VALUES
    ('Éligibilité et consentement',
     'À remplir avant toute autre donnée. Un critère de non-inclusion coché interrompt le recueil.',
     'Inclusion', 0),
    ('Caractéristiques à l''inclusion',
     'Données démographiques, génétiques et anthropométriques recueillies une seule fois.',
     'Inclusion', 1),
    ('Bilan cardiovasculaire',
     'Échocardiographie et traitements. Répété à chaque visite de suivi.',
     'Inclusion · M6 · M12', 2),
    ('Épreuve d''effort cardiorespiratoire',
     'Protocole sur ergocycle, incrémentation 10 W/min. Préciser la nature du pic atteint.',
     'Inclusion · M6 · M12', 3),
    ('Programme d''activité physique',
     'Observance et intensités réellement réalisées, extraites automatiquement des séances.',
     'M3 · M6 · M9 · M12', 4),
    ('Questionnaires',
     'Auto-questionnaires remplis par le patient avant la consultation.',
     'Inclusion · M6 · M12', 5),
    ('Événements indésirables',
     'À renseigner dès qu''un événement survient, sans attendre la visite programmée.',
     'Continu', 6)
  ) AS s(titre, description, visite, rang)
 WHERE e.acronyme = 'MARFAN-APA-DEMO';

-- ====== 3. LES VARIABLES ======
INSERT INTO ecrf_variables (section_id, code, libelle, type, unite, choix,
                            obligatoire, valeur_min, valeur_max, aide, rang)
SELECT s.id, v.code, v.libelle, v.type, v.unite, v.choix,
       v.obligatoire, v.vmin, v.vmax, v.aide, v.rang
  FROM ecrf_sections s
  JOIN etudes e ON e.id = s.etude_id
  JOIN (VALUES
    -- Éligibilité et consentement
    ('Éligibilité et consentement', 'CONSENT_DATE', 'Date de signature du consentement', 'date', NULL, NULL, TRUE, NULL, NULL, 'Doit précéder tout autre acte de l''étude.', 0),
    ('Éligibilité et consentement', 'DIAG_CONFIRME', 'Diagnostic de syndrome de Marfan confirmé', 'oui_non', NULL, NULL, TRUE, NULL, NULL, 'Critères de Gand révisés ou variant pathogène identifié.', 1),
    ('Éligibilité et consentement', 'AGE_18', 'Âge supérieur ou égal à 18 ans', 'oui_non', NULL, NULL, TRUE, NULL, NULL, NULL, 2),
    ('Éligibilité et consentement', 'NONINCL', 'Critère de non-inclusion présent', 'choix_multiple', NULL, 'Aucun;Chirurgie aortique programmée;Dissection aortique récente;Insuffisance cardiaque NYHA III-IV;Contre-indication à l''effort;Grossesse;Refus de participer', TRUE, NULL, NULL, 'Cocher « Aucun » si le patient est éligible.', 3),

    -- Caractéristiques à l'inclusion
    ('Caractéristiques à l''inclusion', 'SEXE', 'Sexe', 'choix', NULL, 'Femme;Homme;Autre', TRUE, NULL, NULL, NULL, 0),
    ('Caractéristiques à l''inclusion', 'DDN', 'Date de naissance', 'date', NULL, NULL, TRUE, NULL, NULL, NULL, 1),
    ('Caractéristiques à l''inclusion', 'TAILLE', 'Taille', 'nombre', 'cm', NULL, TRUE, 120, 230, NULL, 2),
    ('Caractéristiques à l''inclusion', 'POIDS', 'Poids', 'nombre', 'kg', NULL, TRUE, 30, 200, NULL, 3),
    ('Caractéristiques à l''inclusion', 'GENE', 'Gène muté', 'choix', NULL, 'FBN1;TGFBR1;TGFBR2;SMAD3;TGFB2;TGFB3;ACTA2;MYH11;Autre;Inconnu', TRUE, NULL, NULL, NULL, 4),
    ('Caractéristiques à l''inclusion', 'VARIANT', 'Variant pathogène', 'texte', NULL, NULL, FALSE, NULL, NULL, 'Nomenclature HGVS, ex. c.3463T>C (p.Cys1155Arg).', 5),
    ('Caractéristiques à l''inclusion', 'DIAG_DATE', 'Date du diagnostic', 'date', NULL, NULL, FALSE, NULL, NULL, NULL, 6),
    ('Caractéristiques à l''inclusion', 'PROFESSION', 'Profession', 'texte', NULL, NULL, FALSE, NULL, NULL, NULL, 7),
    ('Caractéristiques à l''inclusion', 'TABAC', 'Tabagisme', 'choix', NULL, 'Non-fumeur;Ex-fumeur;Fumeur actif', FALSE, NULL, NULL, NULL, 8),

    -- Bilan cardiovasculaire
    ('Bilan cardiovasculaire', 'ETT_DATE', 'Date de l''échocardiographie', 'date', NULL, NULL, TRUE, NULL, NULL, NULL, 0),
    ('Bilan cardiovasculaire', 'VALSALVA', 'Diamètre du sinus de Valsalva', 'nombre', 'mm', NULL, TRUE, 15, 90, 'Mesure en télédiastole, bord interne à bord interne.', 1),
    ('Bilan cardiovasculaire', 'AO_ASC', 'Diamètre de l''aorte ascendante', 'nombre', 'mm', NULL, FALSE, 15, 90, NULL, 2),
    ('Bilan cardiovasculaire', 'FEVG', 'Fraction d''éjection ventriculaire gauche', 'nombre', '%', NULL, TRUE, 10, 85, 'Méthode biplan de Simpson.', 3),
    ('Bilan cardiovasculaire', 'PVM', 'Prolapsus de la valve mitrale', 'oui_non', NULL, NULL, TRUE, NULL, NULL, NULL, 4),
    ('Bilan cardiovasculaire', 'IM_GRADE', 'Grade de l''insuffisance mitrale', 'choix', NULL, 'Absente;Grade I;Grade II;Grade III;Grade IV', FALSE, NULL, NULL, NULL, 5),
    ('Bilan cardiovasculaire', 'IA_GRADE', 'Grade de l''insuffisance aortique', 'choix', NULL, 'Absente;Grade I;Grade II;Grade III;Grade IV', FALSE, NULL, NULL, NULL, 6),
    ('Bilan cardiovasculaire', 'CHIR_AO', 'Antécédent de chirurgie aortique', 'oui_non', NULL, NULL, TRUE, NULL, NULL, NULL, 7),
    ('Bilan cardiovasculaire', 'BETABLOQ', 'Traitement bêtabloquant', 'oui_non', NULL, NULL, TRUE, NULL, NULL, 'Conditionne la lecture de la fréquence cardiaque à l''effort.', 8),
    ('Bilan cardiovasculaire', 'BETABLOQ_DOSE', 'Molécule et posologie', 'texte', NULL, NULL, FALSE, NULL, NULL, 'ex. bisoprolol 5 mg/j', 9),
    ('Bilan cardiovasculaire', 'SARTAN', 'Traitement par sartan ou IEC', 'oui_non', NULL, NULL, FALSE, NULL, NULL, NULL, 10),
    ('Bilan cardiovasculaire', 'ETT_CR', 'Compte rendu d''échocardiographie', 'fichier', NULL, NULL, FALSE, NULL, NULL, 'Document source, à verser pour contrôle qualité.', 11),

    -- Épreuve d'effort cardiorespiratoire
    ('Épreuve d''effort cardiorespiratoire', 'CPET_DATE', 'Date de l''épreuve', 'date', NULL, NULL, TRUE, NULL, NULL, NULL, 0),
    ('Épreuve d''effort cardiorespiratoire', 'VO2_PIC', 'VO2 pic', 'nombre', 'mL/kg/min', NULL, TRUE, 5, 80, 'Critère de jugement principal.', 1),
    ('Épreuve d''effort cardiorespiratoire', 'VO2_NATURE', 'Nature du pic atteint', 'choix', NULL, 'VO2 max — plateau confirmé;VO2 pic — effort maximal non confirmé', TRUE, NULL, NULL, 'Un VO2 max suppose un plateau de consommation malgré l''augmentation de charge.', 2),
    ('Épreuve d''effort cardiorespiratoire', 'QR_PIC', 'Quotient respiratoire au pic', 'nombre', NULL, NULL, FALSE, 0.6, 1.6, NULL, 3),
    ('Épreuve d''effort cardiorespiratoire', 'SV1_FC', 'Fréquence cardiaque au premier seuil', 'nombre', 'bpm', NULL, TRUE, 50, 200, NULL, 4),
    ('Épreuve d''effort cardiorespiratoire', 'SV2_FC', 'Fréquence cardiaque au second seuil', 'nombre', 'bpm', NULL, TRUE, 50, 220, NULL, 5),
    ('Épreuve d''effort cardiorespiratoire', 'FC_PIC', 'Fréquence cardiaque au pic', 'nombre', 'bpm', NULL, TRUE, 60, 230, NULL, 6),
    ('Épreuve d''effort cardiorespiratoire', 'WATTS_PIC', 'Puissance maximale atteinte', 'nombre', 'W', NULL, TRUE, 10, 500, NULL, 7),
    ('Épreuve d''effort cardiorespiratoire', 'VE_VCO2', 'Pente VE/VCO2', 'nombre', NULL, NULL, FALSE, 10, 90, 'Facteur pronostique. Classes de Weber-Arena.', 8),
    ('Épreuve d''effort cardiorespiratoire', 'OUES', 'OUES', 'nombre', 'mL/min', NULL, FALSE, 200, 6000, 'Efficience ventilatoire, utilisable même sur un effort sous-maximal.', 9),
    ('Épreuve d''effort cardiorespiratoire', 'PA_REPONSE', 'Réponse tensionnelle', 'choix', NULL, 'Normale;Hypertensive;Plate ou chute', TRUE, NULL, NULL, NULL, 10),
    ('Épreuve d''effort cardiorespiratoire', 'CPET_SYMPT', 'Symptômes survenus', 'choix_multiple', NULL, 'Aucun;Dyspnée;Douleur thoracique;Palpitations;Malaise;Douleur musculaire;Autre', TRUE, NULL, NULL, NULL, 11),
    ('Épreuve d''effort cardiorespiratoire', 'CPET_RYTHME', 'Trouble du rythme à l''effort', 'oui_non', NULL, NULL, TRUE, NULL, NULL, NULL, 12),
    ('Épreuve d''effort cardiorespiratoire', 'FORCE_ISO', 'Force isométrique du quadriceps', 'nombre', 'kg', NULL, FALSE, 5, 150, 'Moyenne de trois essais, meilleur côté.', 13),

    -- Programme d'activité physique
    ('Programme d''activité physique', 'NB_SEANCES', 'Nombre de séances réalisées sur la période', 'nombre', NULL, NULL, TRUE, 0, 300, 'Extrait automatiquement du suivi des séances.', 0),
    ('Programme d''activité physique', 'DUREE_MOY', 'Durée moyenne par séance', 'nombre', 'min', NULL, TRUE, 0, 180, NULL, 1),
    ('Programme d''activité physique', 'FC_MOY', 'Fréquence cardiaque moyenne en séance', 'nombre', 'bpm', NULL, TRUE, 50, 200, NULL, 2),
    ('Programme d''activité physique', 'ZONE_DOMINANTE', 'Zone d''intensité dominante', 'choix', NULL, 'Sous le premier seuil;Entre les deux seuils;Au-dessus du second seuil', TRUE, NULL, NULL, 'Rapportée aux seuils mesurés, jamais à une fréquence théorique.', 3),
    ('Programme d''activité physique', 'CR10_MOY', 'Ressenti d''effort moyen (CR10 de Borg)', 'nombre', NULL, NULL, TRUE, 0, 10, NULL, 4),
    ('Programme d''activité physique', 'OBSERVANCE', 'Observance du programme', 'nombre', '%', NULL, TRUE, 0, 100, 'Séances réalisées rapportées aux séances prescrites.', 5),
    ('Programme d''activité physique', 'ETP_MODULES', 'Modules d''éducation thérapeutique validés', 'choix_multiple', NULL, 'Mes traitements et l''effort;M''entraîner en sécurité;Qu''est-ce qu''une charge lourde ?;Adapter mon sport plutôt que l''arrêter;Nutrition et activité physique', FALSE, NULL, NULL, NULL, 6),

    -- Questionnaires
    ('Questionnaires', 'SF36_PCS', 'SF-36 — score physique agrégé', 'nombre', NULL, NULL, TRUE, 0, 100, NULL, 0),
    ('Questionnaires', 'SF36_MCS', 'SF-36 — score mental agrégé', 'nombre', NULL, NULL, TRUE, 0, 100, NULL, 1),
    ('Questionnaires', 'GPAQ_MET', 'GPAQ — dépense hebdomadaire', 'nombre', 'MET-min/sem', NULL, TRUE, 0, 20000, NULL, 2),
    ('Questionnaires', 'GPAQ_SEDENT', 'GPAQ — temps assis quotidien', 'nombre', 'min/j', NULL, FALSE, 0, 1440, NULL, 3),

    -- Événements indésirables
    ('Événements indésirables', 'EI_DATE', 'Date de survenue', 'date', NULL, NULL, TRUE, NULL, NULL, NULL, 0),
    ('Événements indésirables', 'EI_NATURE', 'Nature de l''événement', 'texte', NULL, NULL, TRUE, NULL, NULL, NULL, 1),
    ('Événements indésirables', 'EI_GRAVITE', 'Gravité', 'choix', NULL, 'Non grave;Grave', TRUE, NULL, NULL, 'Un événement grave impose une déclaration au promoteur sous 24 heures.', 2),
    ('Événements indésirables', 'EI_LIEN', 'Lien avec l''activité physique', 'choix', NULL, 'Exclu;Douteux;Possible;Probable;Certain', TRUE, NULL, NULL, NULL, 3),
    ('Événements indésirables', 'EI_SURVENUE', 'Survenue pendant une séance', 'oui_non', NULL, NULL, TRUE, NULL, NULL, NULL, 4),
    ('Événements indésirables', 'EI_ISSUE', 'Évolution', 'choix', NULL, 'Résolu;Résolu avec séquelles;En cours;Inconnue;Décès', TRUE, NULL, NULL, NULL, 5),
    ('Événements indésirables', 'EI_ARRET', 'Arrêt du programme consécutif', 'oui_non', NULL, NULL, TRUE, NULL, NULL, NULL, 6)
  ) AS v(section, code, libelle, type, unite, choix, obligatoire, vmin, vmax, aide, rang)
    ON v.section = s.titre
 WHERE e.acronyme = 'MARFAN-APA-DEMO';

-- ====== 4. RATTACHEMENT DES PATIENTS DE DÉMONSTRATION ======
-- Les patients réels ne sont jamais touchés : les inclure dans un protocole
-- est un acte de l'investigateur, pas un effet de bord d'une migration.
UPDATE patients
   SET etude_id = (SELECT id FROM etudes WHERE acronyme = 'MARFAN-APA-DEMO')
 WHERE is_demo = TRUE;

SELECT 'OK migration 028 — etude de demonstration' AS msg,
       (SELECT COUNT(*) FROM ecrf_sections s JOIN etudes e ON e.id = s.etude_id
         WHERE e.acronyme = 'MARFAN-APA-DEMO') AS nb_chapitres,
       (SELECT COUNT(*) FROM ecrf_variables v
          JOIN ecrf_sections s ON s.id = v.section_id
          JOIN etudes e ON e.id = s.etude_id
         WHERE e.acronyme = 'MARFAN-APA-DEMO') AS nb_variables,
       (SELECT COUNT(*) FROM patients p JOIN etudes e ON e.id = p.etude_id
         WHERE e.acronyme = 'MARFAN-APA-DEMO') AS nb_patients;
