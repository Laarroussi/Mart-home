/**
 * Catalogue des populations suivies par la plateforme.
 * =====================================================
 *
 * Chaque catégorie porte un préfixe de trois lettres qui entre dans
 * l'identifiant définitif du patient — MRF-012, OBE-003 — et chaque préfixe
 * a sa propre numérotation : inclure un patient obèse n'avance pas le
 * compteur des patients Marfan.
 *
 * Trois lettres partout, délibérément. Des préfixes de longueurs inégales
 * désalignent les colonnes dans les exports et trient mal : OBE-9 passerait
 * avant OBE-10 dans un tri alphabétique, mais surtout IC-1 et ICA-1 se
 * confondent à la lecture rapide. La contrainte de longueur est la façon la
 * moins coûteuse d'éviter ces deux ennuis.
 *
 * « Témoin » plutôt que « sujet sain » : on ne vérifie pas l'absence de
 * pathologie, on constate que la personne ne relève pas d'un des groupes
 * suivis. Affirmer qu'un participant est sain dans un dossier de recherche
 * est une affirmation qu'on ne peut pas soutenir.
 *
 * Les motifs de détection servent à proposer une catégorie à la lecture des
 * documents versés. Ils sont volontairement exigeants : proposer la mauvaise
 * catégorie coûte plus cher que n'en proposer aucune, puisqu'un code attribué
 * se corrige mal une fois le dossier créé.
 *
 * Ajouter une population est une modification de code, pas un réglage
 * d'interface — voir le commentaire de la migration 029.
 */
'use strict';

// Chaque motif porte un poids. Compter les motifs sans les pondérer menait à
// une erreur nette : « patient Marfan avec FEVG 32 % et NYHA II » comptait
// deux indices pour l'insuffisance cardiaque contre un seul pour Marfan, et
// classait donc le dossier dans la mauvaise population. Or nommer la maladie
// ou citer son gène vaut davantage qu'un chiffre d'échocardiographie, qui
// figure dans n'importe quel compte rendu de cardiologie.
//
//   3 = la pathologie est nommée, ou un élément qui la définit
//   2 = un élément fortement évocateur
//   1 = un signe fréquent mais partagé avec d'autres populations
const CATEGORIES = [
  {
    code: 'MRF',
    libelle: 'Syndrome de Marfan',
    libelle_court: 'Marfan',
    motifs: [
      [/\bmarfan\b/i, 3],
      [/\bFBN1\b/, 3],
      [/\b(TGFBR1|TGFBR2|SMAD3|TGFB2|TGFB3)\b/, 3],
      [/loeys[\s-]?dietz/i, 3],
      [/\bcrit[eè]res?\s+de\s+Gand\b/i, 3],
      [/ectopie\s+du\s+cristallin/i, 2]
    ]
  },
  {
    code: 'OBE',
    libelle: 'Obésité',
    libelle_court: 'Obésité',
    motifs: [
      [/\bob[ée]sit[ée]\b/i, 3],
      [/\bob[èe]se\b/i, 3],
      [/chirurgie\s+bariatrique/i, 2],
      [/sleeve\s+gastrectomie/i, 2],
      [/bypass\s+gastrique/i, 2],
      [/\bIMC\s*[:=]?\s*(3[0-9]|[4-9][0-9])([.,]\d)?\b/i, 2]
    ]
  },
  {
    code: 'ICA',
    libelle: 'Insuffisance cardiaque',
    libelle_court: 'Insuff. cardiaque',
    motifs: [
      [/insuffisance\s+cardiaque/i, 3],
      [/\bHFrEF\b|\bHFpEF\b/i, 3],
      [/cardiomyopathie\s+dilat[ée]e/i, 2],
      // Une FEVG basse et un stade NYHA se lisent dans beaucoup de comptes
      // rendus sans que l'insuffisance cardiaque soit le motif de suivi.
      [/\bFEVG\s*[:=]?\s*([1-3][0-9])\s*%/i, 1],
      [/\bNYHA\s*(I{1,3}V?|[1-4])\b/, 1]
    ]
  },
  {
    code: 'DT2',
    libelle: 'Diabète de type 2',
    libelle_court: 'Diabète',
    motifs: [
      [/diab[èe]te\s+de\s+type\s*2/i, 3],
      [/\bDT2\b/, 3],
      [/diab[èe]te\s+non\s+insulino[\s-]?d[ée]pendant/i, 3],
      [/\bHbA1c\s*[:=]?\s*([6-9]|1[0-9])([.,]\d)?\s*%/i, 1],
      [/\bmetformine\b/i, 1]
    ]
  },
  {
    code: 'TEM',
    libelle: 'Témoin sain',
    libelle_court: 'Témoin',
    motifs: [
      [/\bsujet\s+t[ée]moin\b/i, 3],
      [/\bvolontaire\s+sain\b/i, 3],
      [/\bgroupe\s+t[ée]moin\b/i, 2]
    ]
  },
  {
    code: 'AUT',
    libelle: 'Autre pathologie',
    libelle_court: 'Autre',
    motifs: []   // jamais détectée : c'est un choix, pas une déduction
  }
];

const CODES = CATEGORIES.map(c => c.code);

function estValide(code) {
  return CODES.indexOf(String(code || '').toUpperCase()) >= 0;
}

function normaliser(code) {
  const c = String(code || '').toUpperCase();
  return estValide(c) ? c : 'MRF';
}

/**
 * Propose une catégorie à partir du texte d'un document.
 *
 * On compte les motifs reconnus par catégorie plutôt que de s'arrêter au
 * premier trouvé : un compte rendu de cardiologie chez un patient Marfan
 * mentionne la FEVG, et s'arrêter au premier indice le classerait en
 * insuffisance cardiaque. La catégorie la mieux étayée l'emporte.
 *
 * En cas d'égalité, on ne tranche pas : deux populations également étayées
 * dans un même document veulent dire que le document ne suffit pas à
 * décider, et c'est au clinicien de le faire.
 *
 * @returns {{code, libelle, indices, certitude}|null}
 */
function detecter(texte) {
  const t = String(texte || '');
  if (t.length < 20) return null;

  const scores = CATEGORIES
    .filter(c => c.motifs.length)
    .map(c => {
      let poids = 0, fort = false;
      const trouves = [];
      c.motifs.forEach(([re, p]) => {
        const m = t.match(re);
        if (!m) return;
        poids += p;
        if (p >= 3) fort = true;
        trouves.push(m[0].trim());
      });
      return { code: c.code, libelle: c.libelle, indices: trouves, poids, fort };
    })
    .filter(x => x.poids > 0)
    .sort((a, b) => b.poids - a.poids);

  if (!scores.length) return null;
  // Un seul signe partagé — une HbA1c, une FEVG — ne suffit pas à ranger un
  // patient dans une population. Mieux vaut ne rien proposer.
  if (scores[0].poids < 2) return null;
  // Égalité : le document ne tranche pas, c'est au clinicien de le faire.
  if (scores.length > 1 && scores[0].poids === scores[1].poids) return null;
  // Deux pathologies nommées dans le même document : on ne propose rien.
  // « Patient Marfan, par ailleurs insuffisance cardiaque » décrit un patient
  // réel qui relève des deux ; décider lequel des deux groupes il rejoint est
  // un choix d'inclusion, pas une question de reconnaissance de texte.
  if (scores.filter(x => x.fort).length > 1) return null;

  return {
    code: scores[0].code,
    libelle: scores[0].libelle,
    // Les indices sont remontés à l'interface : on doit pouvoir voir sur quoi
    // repose la proposition avant de l'accepter.
    indices: scores[0].indices.slice(0, 4),
    certitude: (scores[0].fort && scores[0].poids >= 4) ? 'elevee' : 'moyenne'
  };
}

module.exports = { CATEGORIES, CODES, estValide, normaliser, detecter };
