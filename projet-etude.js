/**
 * projet-etude.js — Calcul d'effectif pour un projet d'étude
 * ===========================================================
 *
 * Un effectif ne se « demande » pas : il se déduit de quatre décisions, et
 * il change du simple au triple selon la façon dont on compare.
 *
 *   α           risque de conclure à tort à une différence
 *   1 − β       puissance : chance de voir la différence si elle existe
 *   Δ           différence que l'on veut être capable de détecter
 *   σ           dispersion de cette différence dans la population
 *
 * Seul le rapport d = Δ/σ compte. C'est la raison pour laquelle cette
 * fonction ne contient aucun chiffre clinique : Δ et σ viennent des données
 * de l'équipe ou d'une série publiée, jamais d'ici.
 *
 * ── Pourquoi le plan croisé divise l'effectif ──────────────────────────
 * En mesures appariées, σ est l'écart-type de la DIFFÉRENCE intra-sujet, pas
 * celui de la mesure. Dans la mécanique aortique, la variabilité d'un sujet à
 * l'autre est large et celle d'un sujet à lui-même est petite : le même écart
 * Δ devient donc beaucoup plus facile à détecter. Comparer deux groupes
 * indépendants exige, pour le même d, environ quatre fois plus de sujets au
 * total. D'où le plan intra-individuel du protocole.
 *
 * Toute entrée manquante ou absurde renvoie null. Aucun effectif n'est
 * « estimé » faute de données : un effectif sans ses hypothèses ne veut rien
 * dire, et un 0 affiché serait pris pour une réponse.
 *
 * Expose window.ProjetEtude
 */
(function () {
  'use strict';

  function n(v) {
    if (v === null || v === undefined || v === '') return null;
    var x = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return Number.isFinite(x) ? x : null;
  }

  /**
   * Quantile de la loi normale centrée réduite (fonction probit).
   * Approximation rationnelle de Acklam — erreur < 1,15 × 10⁻⁹, soit très
   * au-delà de ce qu'exige un calcul d'effectif. Vérifiée contre les valeurs
   * de table : z(0,975) = 1,959964 · z(0,80) = 0,841621 · z(0,90) = 1,281552.
   */
  function z(p) {
    var q = n(p);
    if (q === null || q <= 0 || q >= 1) return null;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
             3.754408661907416e+00];
    var bas = 0.02425, r, t;
    if (q < bas) {
      t = Math.sqrt(-2 * Math.log(q));
      return (((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) /
             ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
    }
    if (q > 1 - bas) {
      t = Math.sqrt(-2 * Math.log(1 - q));
      return -(((((c[0] * t + c[1]) * t + c[2]) * t + c[3]) * t + c[4]) * t + c[5]) /
              ((((d[0] * t + d[1]) * t + d[2]) * t + d[3]) * t + 1);
    }
    t = q - 0.5; r = t * t;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t /
           (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  /** Effet standardisé d = Δ/σ. Sans lui, aucun effectif n'est calculable. */
  function effetStandardise(delta, sigma) {
    var dl = n(delta), sg = n(sigma);
    if (dl === null || sg === null || sg <= 0 || dl === 0) return null;
    return Math.abs(dl) / sg;
  }

  /**
   * Effectif requis.
   *
   * @param o.delta      différence à détecter, dans l'unité du critère
   * @param o.sigma      écart-type — de la DIFFÉRENCE si plan apparié
   * @param o.alpha      risque de première espèce (bilatéral), ex. 0,05
   * @param o.puissance  ex. 0,80
   * @param o.plan       'apparie' (intra-sujet) ou 'groupes' (deux groupes)
   * @param o.attrition  proportion de perdus de vue attendue, ex. 0,10
   *
   * Le « +1 » sur l'effectif normal compense l'usage de la loi normale là où
   * le test réel est un t : sans lui l'effectif est très légèrement
   * sous-estimé, et on préfère l'erreur du côté prudent.
   */
  function effectif(o) {
    o = o || {};
    var d = effetStandardise(o.delta, o.sigma);
    var al = n(o.alpha), pu = n(o.puissance), at = n(o.attrition);
    if (d === null || al === null || pu === null) return null;
    if (al <= 0 || al >= 1 || pu <= 0 || pu >= 1) return null;
    if (at === null) at = 0;
    if (at < 0 || at >= 1) return null;

    var za = z(1 - al / 2), zb = z(pu);
    if (za === null || zb === null) return null;
    var somme = Math.pow(za + zb, 2);
    var apparie = o.plan !== 'groupes';

    // Apparié : n sujets au total. Deux groupes : n PAR groupe, d'où le ×2.
    var brut = (apparie ? 1 : 2) * somme / (d * d);
    var parBras = Math.ceil(brut) + 1;
    var analysables = apparie ? parBras : parBras * 2;
    var aInclure = Math.ceil(analysables / (1 - at));

    return {
      plan: apparie ? 'apparie' : 'groupes',
      d: Math.round(d * 1000) / 1000,
      za: Math.round(za * 1000) / 1000,
      zb: Math.round(zb * 1000) / 1000,
      parBras: parBras,
      analysables: analysables,
      aInclure: aInclure,
      attrition: at
    };
  }

  /**
   * Table de sensibilité : l'effectif pour une série d'effets standardisés.
   * C'est la seule façon honnête de montrer un effectif quand Δ et σ ne sont
   * pas encore arrêtés — la forme de la courbe, elle, ne dépend d'aucune
   * hypothèse clinique.
   */
  function sensibilite(alpha, puissance, plan, effets) {
    var liste = effets || [0.3, 0.4, 0.5, 0.6, 0.8, 1.0];
    return liste.map(function (d) {
      var r = effectif({ delta: d, sigma: 1, alpha: alpha, puissance: puissance, plan: plan });
      return { d: d, parBras: r ? r.parBras : null, analysables: r ? r.analysables : null };
    });
  }

  window.ProjetEtude = {
    n: n, z: z, effetStandardise: effetStandardise,
    effectif: effectif, sensibilite: sensibilite
  };
})();
