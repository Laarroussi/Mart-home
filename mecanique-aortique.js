/**
 * Mécanique de la racine aortique — sinus de Valsalva
 * ===================================================
 *
 * Calculs de déformation et de rigidité de la racine aortique à partir de
 * deux diamètres échographiques et, quand ils sont disponibles, de la
 * pression artérielle, de la fréquence cardiaque, de la morphométrie et du
 * Doppler.
 *
 * ── Convention de mesure ────────────────────────────────────────────────
 * Dd : diamètre télédiastolique des sinus, au début du QRS, valve fermée.
 * Ds : diamètre systolique maximal, expansion maximale, valve ouverte.
 * Les deux au MÊME niveau anatomique, faisceau perpendiculaire à la racine,
 * convention inner-edge to inner-edge, moyenne de trois cycles si possible.
 *
 * Mélanger les conventions est la faute qui ruine ces calculs : un Dd mesuré
 * en leading-edge et un Ds en inner-edge donnent un strain faux, et rien dans
 * le résultat ne le signale. C'est pourquoi la convention est rappelée à
 * l'écran plutôt que sous-entendue.
 *
 * ── Deux définitions de la distensibilité ───────────────────────────────
 * On retient ici la forme SURFACIQUE :
 *     D = (Ds² − Dd²) / (Dd² × ΔPP)
 * et non l'approximation linéarisée 2(Ds − Dd)/(Dd × ΔPP) qu'on rencontre
 * aussi. Les deux convergent tant que la déformation reste faible, et
 * divergent dès qu'elle augmente — précisément dans les situations qui
 * intéressent ce protocole. Le module echo-calculs.js de la plateforme
 * utilise encore la seconde : tant que les deux coexistent, ne comparez
 * jamais un chiffre de cet onglet à un chiffre de l'autre.
 *
 * Aucune fonction ne devine : une donnée manquante renvoie null, et l'écran
 * affiche une absence, jamais un zéro.
 *
 * Expose window.MecaniqueAortique
 */
(function () {
  'use strict';

  /** Nombre exploitable, ou null. Une chaîne vide n'est pas un zéro. */
  function n(v) {
    if (v === null || v === undefined || v === '') return null;
    const x = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(x) ? x : null;
  }
  function arrondi(x, d) {
    if (x === null || !Number.isFinite(x)) return null;
    const f = Math.pow(10, d);
    return Math.round(x * f) / f;
  }

  // ======================================================================
  // 1. Dd + Ds seuls
  // ======================================================================

  /** Strain aortique, en % : (Ds − Dd) / Dd × 100. */
  function strain(dd, ds) {
    const d = n(dd), s = n(ds);
    if (d == null || s == null || d <= 0) return null;
    return arrondi((s - d) / d * 100, 1);
  }

  /** Area strain, en % : (Ds² − Dd²) / Dd² × 100. */
  function areaStrain(dd, ds) {
    const d = n(dd), s = n(ds);
    if (d == null || s == null || d <= 0) return null;
    return arrondi((s * s - d * d) / (d * d) * 100, 1);
  }

  /** Surface d'un disque de diamètre D (mm) → mm². */
  function surface(diametre) {
    const d = n(diametre);
    if (d == null || d <= 0) return null;
    return arrondi(Math.PI * d * d / 4, 1);
  }

  // ======================================================================
  // 2. Avec la pression artérielle
  // ======================================================================

  /** Pression pulsée, en mmHg. */
  function pressionPulsee(pas, pad) {
    const s = n(pas), d = n(pad);
    if (s == null || d == null) return null;
    const pp = s - d;
    return pp > 0 ? arrondi(pp, 0) : null;
  }

  /**
   * Distensibilité, en 10⁻³ mmHg⁻¹ (forme surfacique).
   *     D = (Ds² − Dd²) / (Dd² × ΔPP)
   * Capacité de la racine à se dilater pour une variation de pression donnée.
   * Plus la valeur est élevée, plus l'aorte est distensible.
   */
  function distensibilite(dd, ds, pas, pad) {
    const d = n(dd), s = n(ds), pp = pressionPulsee(pas, pad);
    if (d == null || s == null || pp == null || d <= 0) return null;
    return arrondi((s * s - d * d) / (d * d * pp) * 1000, 2);
  }

  /**
   * Indice de rigidité β, sans dimension.
   *     β = ln(PAS / PAD) / [(Ds − Dd) / Dd]
   * Moins dépendant du niveau de pression que la distensibilité. Plus β est
   * élevé, plus la paroi est rigide.
   */
  function beta(dd, ds, pas, pad) {
    const d = n(dd), s = n(ds), ps = n(pas), pd = n(pad);
    if (d == null || s == null || ps == null || pd == null) return null;
    if (d <= 0 || pd <= 0 || ps <= pd || s <= d) return null;
    return arrondi(Math.log(ps / pd) / ((s - d) / d), 1);
  }

  /**
   * Compliance, en mm²/mmHg (variation ABSOLUE de surface par mmHg).
   *     C = π (Ds² − Dd²) / (4 ΔPP)
   * Dépend davantage de la taille initiale de l'aorte que la distensibilité :
   * une grosse racine peu déformable peut afficher une compliance
   * comparable à celle d'une petite racine souple.
   */
  function compliance(dd, ds, pas, pad) {
    const d = n(dd), s = n(ds), pp = pressionPulsee(pas, pad);
    if (d == null || s == null || pp == null) return null;
    return arrondi(Math.PI * (s * s - d * d) / (4 * pp), 2);
  }

  /**
   * Module élastique pression-déformation Ep, en mmHg.
   *     Ep = ΔPP / [(Ds − Dd) / Dd]
   * Plus Ep est élevé, plus la paroi est rigide. Paramètre secondaire :
   * il porte la même information que β, sans la correction logarithmique.
   */
  function ep(dd, ds, pas, pad) {
    const d = n(dd), s = n(ds), pp = pressionPulsee(pas, pad);
    if (d == null || s == null || pp == null || d <= 0 || s <= d) return null;
    return arrondi(pp / ((s - d) / d), 0);
  }

  // ======================================================================
  // 3. Fréquence cardiaque — information complémentaire, jamais bloquante
  // ======================================================================

  /** Double produit, en mmHg·bpm : charge cardiovasculaire globale. */
  function doubleProduit(pas, fc) {
    const p = n(pas), f = n(fc);
    if (p == null || f == null || f <= 0) return null;
    return arrondi(p * f, 0);
  }

  // ======================================================================
  // 4. Morphométrie
  // ======================================================================

  /** Surface corporelle selon Du Bois, en m². Taille en cm, poids en kg. */
  function bsaDuBois(tailleCm, poidsKg) {
    const t = n(tailleCm), p = n(poidsKg);
    if (t == null || p == null || t <= 0 || p <= 0) return null;
    return arrondi(0.007184 * Math.pow(t, 0.725) * Math.pow(p, 0.425), 2);
  }

  /** Diamètre indexé à la taille, en mm/m. */
  function indexeTaille(diametre, tailleCm) {
    const d = n(diametre), t = n(tailleCm);
    if (d == null || t == null || t <= 0) return null;
    return arrondi(d / (t / 100), 1);
  }

  /** Diamètre indexé à la surface corporelle, en mm/m². */
  function indexeBsa(diametre, bsa) {
    const d = n(diametre), b = n(bsa);
    if (d == null || b == null || b <= 0) return null;
    return arrondi(d / b, 1);
  }

  // ======================================================================
  // 5. Doppler — hémodynamique complémentaire
  // ======================================================================

  /** Surface de la chambre de chasse, en cm². Diamètre en cm. */
  function surfaceLvot(diametreCm) {
    const d = n(diametreCm);
    if (d == null || d <= 0) return null;
    return arrondi(Math.PI * Math.pow(d / 2, 2), 2);
  }

  /** Volume d'éjection systolique, en mL. ITV en cm. */
  function ves(surfaceLvotCm2, itvLvotCm) {
    const a = n(surfaceLvotCm2), i = n(itvLvotCm);
    if (a == null || i == null) return null;
    return arrondi(a * i, 1);
  }

  /** Débit cardiaque, en L/min. */
  function debitCardiaque(vesMl, fc) {
    const v = n(vesMl), f = n(fc);
    if (v == null || f == null || f <= 0) return null;
    return arrondi(v * f / 1000, 2);
  }

  /** Gradient transaortique maximal simplifié, en mmHg. Vmax en m/s. */
  function gradientMax(vmax) {
    const v = n(vmax);
    if (v == null || v <= 0) return null;
    return arrondi(4 * v * v, 0);
  }

  /** Surface valvulaire aortique par équation de continuité, en cm². */
  function ava(surfaceLvotCm2, itvLvotCm, itvAoCm) {
    const a = n(surfaceLvotCm2), il = n(itvLvotCm), ia = n(itvAoCm);
    if (a == null || il == null || ia == null || ia <= 0) return null;
    return arrondi(a * il / ia, 2);
  }

  window.MecaniqueAortique = {
    n: n,
    strain: strain, areaStrain: areaStrain, surface: surface,
    pressionPulsee: pressionPulsee, distensibilite: distensibilite,
    beta: beta, compliance: compliance, ep: ep,
    doubleProduit: doubleProduit,
    bsaDuBois: bsaDuBois, indexeTaille: indexeTaille, indexeBsa: indexeBsa,
    surfaceLvot: surfaceLvot, ves: ves, debitCardiaque: debitCardiaque,
    gradientMax: gradientMax, ava: ava
  };
})();
