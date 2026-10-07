/**
 * Normalisation du nom d'établissement en nom de ville — SOURCE UNIQUE.
 * ======================================================================
 *
 * Ce fichier est chargé par le navigateur (balise <script> dans index.html)
 * ET par le serveur (backend/config/ville-hopital.js le réexporte). C'est
 * délibéré : une première version avait deux implémentations, une de chaque
 * côté. Elles donnaient des résultats différents sur cinq libellés d'hôpital
 * sur douze — « Hôpital Nord, Marseille » devenait MARSEILLE côté serveur et
 * NORD-MARSEILLE côté navigateur. Deux centres au lieu d'un, selon que la
 * donnée venait d'un document lu ou d'une saisie manuelle.
 *
 * Un même traitement de données ne doit exister qu'à un seul endroit.
 *
 * --------------------------------------------------------------------
 *
 * Un même hôpital s'écrit de dix façons dans les comptes rendus : « CHU de
 * Toulouse », « C.H.U. Toulouse — Hôpital Rangueil », « Centre Hospitalier
 * Universitaire de TOULOUSE ». Tant qu'on garde la chaîne telle quelle, un
 * regroupement par centre compte dix centres là où il y en a un.
 *
 * On ne retient donc que la ville, en majuscules et sans accent :
 *
 *   — La ville plutôt que l'établissement : c'est la seule partie qui ne
 *     change pas quand un service déménage ou qu'un groupe est renommé, et
 *     c'est l'unité qui compte dans une étude multicentrique.
 *
 *   — Les majuscules : elles suppriment la moitié des variantes sans rien
 *     perdre, et c'est la convention des fichiers administratifs français.
 *
 *   — Sans accent : « SAINT-ÉTIENNE » et « SAINT-ETIENNE » doivent être le
 *     même centre, sinon chaque tableau affiche deux lignes.
 *
 * Ce qui n'est PAS fait, délibérément : aucune correction orthographique,
 * aucun rapprochement approximatif. « TOULOSE » reste « TOULOSE ». Une
 * correction automatique qui se trompe une fois sur cent produit une donnée
 * fausse qu'on ne retrouve jamais ; une faute visible se corrige.
 */
(function (racine, fabrique) {
  var api = fabrique();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else racine.VilleHopital = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Mots d'établissement à retirer. L'ordre n'importe pas, le retrait est global.
  const BRUIT = [
    'CENTRE HOSPITALIER UNIVERSITAIRE', 'CENTRE HOSPITALIER REGIONAL',
    'CENTRE HOSPITALIER INTERCOMMUNAL', 'CENTRE HOSPITALIER',
    'HOPITAL UNIVERSITAIRE', 'GROUPE HOSPITALIER', 'INSTITUT',
    'POLYCLINIQUE', 'CLINIQUE', 'HOPITAL', 'HOPITAUX', 'CHRU', 'CHU', 'CHR',
    'CHI', 'CH', 'GHU', 'GH', 'APHP', 'AP HP', 'AP-HP', 'APHM', 'AP HM', 'HCL'
  ];

  /** Retire les accents sans toucher au reste. */
  function sansAccent(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  // Villes de CHU et principaux sites hospitaliers français. Cette liste ne
  // sert qu'à lever une ambiguïté réelle : « CHU Toulouse — Hôpital Rangueil »
  // porte la ville en premier, « Hôpital Bichat, Paris » la porte en dernier.
  // Aucune heuristique de position ne résout les deux. Quand un segment
  // correspond à une ville connue, on la retient ; sinon on retombe sur la
  // règle de position, et le clinicien corrige si besoin.
  //
  // La liste est volontairement courte et ne prétend pas être exhaustive : son
  // rôle est de bien traiter les cas fréquents, pas de remplacer une saisie.
  const VILLES = new Set([
    'AMIENS', 'ANGERS', 'BESANCON', 'BORDEAUX', 'BREST', 'CAEN', 'CLERMONT-FERRAND',
    'DIJON', 'GRENOBLE', 'LILLE', 'LIMOGES', 'LYON', 'MARSEILLE', 'MONTPELLIER',
    'NANCY', 'NANTES', 'NICE', 'NIMES', 'ORLEANS', 'PARIS', 'POITIERS', 'REIMS',
    'RENNES', 'ROUEN', 'SAINT-ETIENNE', 'STRASBOURG', 'TOULOUSE', 'TOURS',
    'CAYENNE', 'FORT-DE-FRANCE', 'POINTE-A-PITRE', 'SAINT-DENIS', 'SAINT-PIERRE',
    'AJACCIO', 'LE-HAVRE', 'LE-MANS', 'METZ', 'MULHOUSE', 'PERPIGNAN', 'PAU',
    'TOULON', 'AVIGNON', 'ANNECY', 'CHAMBERY', 'VALENCE', 'BAYONNE', 'LORIENT',
    'QUIMPER', 'VANNES', 'LA-ROCHELLE', 'LA-ROCHE-SUR-YON', 'NIORT', 'TARBES',
    'ALBI', 'MONTAUBAN', 'CAHORS', 'RODEZ', 'AUCH', 'CARCASSONNE', 'NARBONNE',
    'BEZIERS', 'SETE', 'ARLES', 'AIX-EN-PROVENCE', 'CRETEIL', 'BOBIGNY',
    'VERSAILLES', 'SURESNES', 'CLAMART', 'LE-KREMLIN-BICETRE', 'GARCHES',
    'BOULOGNE-BILLANCOURT', 'COLOMBES', 'VILLEJUIF', 'ARGENTEUIL', 'PONTOISE'
  ]);

  const ARTICLES = ['LE', 'LA', 'LES'];

  /**
   * @param {string} texte le libellé brut, tel qu'il figure dans le document
   * @returns {string} la ville en majuscules sans accent, ou '' si rien d'exploitable
   */
  function normaliserVille(texte) {
    let t = sansAccent(texte).toUpperCase();
    if (!t.trim()) return '';

    // Les tirets ENTOURÉS D'ESPACES séparent les parties d'un libellé
    // (« CHU Toulouse — Hôpital Rangueil »). Les tirets collés appartiennent au
    // nom (« SAINT-ETIENNE »). Confondre les deux était la cause de la moitié
    // des erreurs : « Toulouse - Rangueil » devenait « TOULOUSE-RANGUEIL ».
    t = t.replace(/[.;:()\[\]/\\]/g, ' ')
         .replace(/\s+[-–—]+\s+/g, ' | ')
         .replace(/,/g, ' | ')
         .replace(/[–—]/g, '-')
         .replace(/\s+/g, ' ')
         .trim();

    BRUIT.forEach(mot => {
      t = t.replace(new RegExp('(^|[\\s|-])' + mot.replace(/[-\s]/g, '[\\s-]*') + '($|[\\s|-])', 'g'), ' | ');
    });

    // Articles et liaisons, seulement isolés : on ne veut pas amputer
    // « LE HAVRE » ni « LA ROCHE-SUR-YON », traités plus bas.
    t = t.replace(/(^|\s)(DE|DU|DES|D|L|AU|AUX|ET)(\s|$)/g, ' ')
         .replace(/\s*-\s*/g, '-')
         .replace(/\s+/g, ' ')
         .trim();

    const segments = t.split('|').map(x => x.trim()).filter(Boolean);
    if (!segments.length) return '';

    const propre = (mot) => String(mot || '').replace(/[^A-Z-]/g, '').replace(/^-+|-+$/g, '');

    // 1. Une ville connue, où qu'elle se trouve dans le libellé.
    for (const seg of segments) {
      const mots = seg.split(' ').map(propre).filter(Boolean);
      for (let i = 0; i < mots.length; i++) {
        if (VILLES.has(mots[i])) return mots[i];
        // « LE HAVRE » s'écrit en deux mots dans les comptes rendus.
        if (i > 0 && ARTICLES.indexOf(mots[i - 1]) >= 0) {
          const compose = mots[i - 1] + '-' + mots[i];
          if (VILLES.has(compose)) return compose;
        }
      }
    }

    // 2. Repli : le dernier mot du dernier segment, la ville étant presque
    //    toujours citée après le nom du site.
    const mots = segments[segments.length - 1].split(' ').map(propre).filter(Boolean);
    if (!mots.length) return '';
    let ville = mots[mots.length - 1];
    if (mots.length > 1 && ARTICLES.indexOf(mots[mots.length - 2]) >= 0) {
      ville = mots[mots.length - 2] + '-' + ville;
    }
    return ville.length >= 2 ? ville : '';
  }
  return { normaliserVille: normaliserVille, sansAccent: sansAccent };
});
