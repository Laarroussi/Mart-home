# Règles de provenance des données cliniques

Ces règles priment sur toute considération d'affichage ou de commodité.
Elles existent parce qu'une valeur fausse qu'on laisse en base devient une
valeur vraie au regard suivant : elle alimente les courbes, déclenche les
seuils d'alerte, et l'IA la reprend dans la synthèse qu'elle rédige ensuite.

Cas fondateur : un export COSMED versé dans le lecteur générique, un champ de
formulaire rempli à 45 mm, et une courbe de suivi aortique qui affichait une
dilatation que personne n'avait mesurée.

---

## 1. Une seule source fait foi, par type d'examen

Pour chaque mesure, le **document source de l'examen** est la seule autorité :

| Mesure | Document de référence |
|---|---|
| Aorte, cœur, valves | Compte rendu d'échocardiographie (ETT) |
| VO₂, seuils, puissance, FC d'effort | Fichier brut de l'épreuve d'effort |
| Fonction ventilatoire | Compte rendu de spirométrie |

Tout le reste — synthèse, courrier, compte rendu de consultation, champ saisi
dans un formulaire — est une **source secondaire**.

**Une source secondaire ne peut jamais écraser ni remplacer une valeur issue
du document de référence.** En l'absence de document de référence, la valeur
s'affiche comme *rapportée, non vérifiée*, avec son origine nommée, et
**n'alimente pas les courbes longitudinales**.

Chaque mesure porte sa provenance : quel document, et son statut —
**mesurée**, **calculée**, ou **absente**. Une donnée absente s'affiche
absente. Jamais un zéro, jamais une estimation silencieuse.

## 2. Exception : les traitements

Les traitements échappent à la règle 1. Ils peuvent être relevés dans une
évaluation comme dans n'importe quel compte rendu ou courrier : il n'existe
pas de « document de référence du traitement », et l'information utile est
celle qui est la plus récente, d'où qu'elle vienne.

Chaque traitement porte néanmoins ses dates : début, arrêt, modification de
posologie. Un traitement sans date n'est pas exploitable.

## 3. La chronologie, toujours

Toute donnée clinique est datée et classée dans le temps. Sans date, pas de
courbe, pas de comparaison, pas de bilan de période.

- Une date imprécise (mois ou année) est enregistrée comme telle et **ne
  devient pas un point de courbe** : elle donnerait une fausse précision.
- Les comparaisons se font toujours avec leur intervalle : un écart sans sa
  durée ne veut rien dire.
- La date qui compte est celle de l'**examen**, pas celle du versement du
  document ni de la création de la fiche.

## 4. Épreuve d'effort : calcul à partir des cycles, pas du résumé

L'analyse CPET part des **cycles respiratoires du fichier brut**, jamais de la
feuille de résultats du logiciel ni d'une lecture de texte par l'IA.

La valeur du logiciel est conservée **à titre de comparaison uniquement**
(`vo2_logiciel_ml_min`) : deux calculs affichés côte à côte se contrôlent
mutuellement, un calcul unique ne se contrôle pas.

Calculés depuis le fichier : VO₂ pic (lissé 30 s) en mL/kg/min et L/min,
puissance pic, FC repos et pic, RER pic, durée de l'épreuve, SV1 et SV2 avec
leur VO₂ / FC / puissance, pente VE/VCO₂, OUES, pouls d'oxygène (VO₂/FC),
PETCO₂ si la colonne est présente, critères de maximalité.

### Critères de maximalité et facteurs pronostiques

La distinction **VO₂ max / VO₂ pic** suit les critères usuels : plateau de
VO₂, RER ≥ 1,10, FC ≥ 90 % de la prédite. Le plateau est le critère de
référence — sans lui, jamais de VO₂ max, quels que soient les autres.

La FC prédite est calculée par **Tanaka (208 − 0,7 × âge)**, pas par
« 220 − âge » qui surestime chez le sujet jeune et sous-estime après 50 ans.
Les deux sont renvoyées, la seconde pour comparaison avec les comptes rendus
qui l'emploient encore.

**Sous bêtabloquant** — fréquent dans le syndrome de Marfan — le critère de
fréquence est neutralisé, pas évalué comme non rempli : une épreuve serait
déclarée sous-maximale à tort.

Facteurs pronostiques calculés et situés par rapport à leur seuil : pente
VE/VCO₂ (Weber-Arena), OUES, pouls d'oxygène, récupération de la FC à une
minute (HRR1), VO₂ de pic en % de la prédite, SV1 en % du pic.

Un facteur dont la donnée manque est renvoyé avec une valeur nulle et le
statut *absent*, jamais écarté de la liste : son absence dit qu'on ne sait
pas, et non que tout va bien.

**Aucun seuil chiffré n'est affiché lorsque la norme n'est pas établie.**
L'OUES en est le cas : sa référence dépend de l'âge, du sexe et de la
corpulence, et les normes publiées ne s'accordent pas. La mesure est
affichée, l'interprétation reste au clinicien. Classer un patient sur une
borne approximative serait pire que ne rien classer.

**VO₂ en % de la théorique : équation de Wasserman.** Choix du service, à
mentionner partout où la valeur est affichée — les autres référentiels
(SHIP, ERS) donnent 10 à 15 % d'écart.

Non calculables depuis le fichier, donc jamais inventés :

- **Pression artérielle au repos et à l'effort maximal** — relevée au
  brassard par l'opérateur. Saisie manuelle, ou lecture du compte rendu signé.
- **Réserve ventilatoire** — exige la VMM, donc un VEMS spirométrique. Sera
  calculée automatiquement dès que la spirométrie accompagnera le fichier
  d'effort.

## 5. Une colonne, une seule signification

Dans la base destinée à l'analyse, **une colonne doit vouloir dire une seule
chose**. Une colonne `AORTE_mm` dont le sens dépend d'une colonne `NIVEAU`
voisine est inexploitable : on ne peut ni en faire une moyenne, ni y suivre
une progression, sans savoir si la ligne 12 parle de l'anneau et la ligne 13
des sinus.

Chaque mesure porte donc sa colonne, nommée par ce qu'elle mesure :
`SINUS_VALSALVA_mm`, `JONCTION_SINOTUBULAIRE_mm`, `AORTE_ASCENDANTE_mm`,
`VG_FEVG_SIMPSON_pct` — et `VG_FEVG_TEICHOLZ_pct` dans une colonne séparée,
parce que les deux méthodes ne sont pas comparables.

Une case vide signifie **« non mesuré sur cet examen »**. Jamais zéro, jamais
« identique au segment voisin ».

Les valeurs de synthèse du dossier, qui agrègent plusieurs origines, portent
un préfixe distinct (`SUIVI_`) pour qu'on ne les confonde jamais avec une
mesure d'examen.

C'est la différence entre une base de travail et une base de recherche : la
seconde sera lue par quelqu'un qui n'était pas là quand la donnée a été
saisie.

## 6. Une donnée, un seul enregistrement

Une donnée clinique est enregistrée **une seule fois**, et affichée à
plusieurs endroits selon le besoin. L'inverse — la même valeur recopiée dans
plusieurs tables — produit des divergences silencieuses.

- Tableau général : le diamètre maximal des sinus de Valsalva et son écart.
- Rubrique échocardiographie : l'ensemble des mesures détaillées.
- Graphiques longitudinaux : l'évolution.

Tous lisent la même ligne.
