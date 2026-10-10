/**
 * echo-calculs.js — Indices échocardiographiques dérivés
 * ========================================================
 *
 * Les rapports ne sont pas enregistrés en base : ils sont recalculés ici, à
 * partir des grandeurs mesurées. Trois raisons, toutes vérifiées à nos
 * dépens sur ce projet :
 *
 *   • un rapport stocké ne se vérifie plus — on ne sait pas sur quelles
 *     valeurs il a été obtenu ;
 *   • il se désynchronise dès qu'une mesure est corrigée ;
 *   • il se confond avec une mesure, alors qu'il n'en est pas une.
 *
 * Chaque fonction renvoie `null` quand une entrée manque. Jamais zéro,
 * jamais une estimation : une absence reste une absence.
 *
 * Expose window.EchoCalculs
 */
(function () {
  'use strict';

  const n = (v) => {
    if (v == null || v === '') return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };

  const arrondi = (v, d) => v == null ? null : Math.round(v * Math.pow(10, d)) / Math.pow(10, d);

  /**
   * Déformation de la paroi aortique sur un cycle, en pourcentage.
   *   strain = (Dsystole − Ddiastole) / Ddiastole × 100
   */
  function deformation(dSys, dDia) {
    const s = n(dSys), d = n(dDia);
    if (s == null || d == null || d <= 0) return null;
    return arrondi((s - d) / d * 100, 1);
  }

  /**
   * Distensibilité aortique, en 10⁻³ mmHg⁻¹.
   *   D = 2 × (Dsys − Ddia) / (Ddia × ΔPP)
   * ΔPP est la pression pulsée — d'où l'exigence d'une pression artérielle
   * relevée AU MOMENT de l'examen. Une pression prise à une autre
   * consultation donnerait un résultat faux sans que rien ne le signale ;
   * c'est pourquoi elle est stockée dans la même ligne que les diamètres.
   */
  function distensibilite(dSys, dDia, paSys, paDia) {
    const s = n(dSys), d = n(dDia), ps = n(paSys), pd = n(paDia);
    if (s == null || d == null || ps == null || pd == null) return null;
    const pp = ps - pd;
    if (d <= 0 || pp <= 0) return null;
    return arrondi((2 * (s - d)) / (d * pp) * 1000, 2);
  }

  /**
   * Compliance aortique, en mm/mmHg.
   *   C = (Dsys − Ddia) / ΔPP
   */
  function compliance(dSys, dDia, paSys, paDia) {
    const s = n(dSys), d = n(dDia), ps = n(paSys), pd = n(paDia);
    if (s == null || d == null || ps == null || pd == null) return null;
    const pp = ps - pd;
    if (pp <= 0) return null;
    return arrondi((s - d) / pp, 3);
  }

  /**
   * Indice de rigidité β.
   *   β = ln(PAs / PAd) / [(Dsys − Ddia) / Ddia]
   * Sans dimension, et moins dépendant du niveau de pression que la
   * distensibilité — utile quand la pression varie d'un examen à l'autre.
   */
  function rigiditeBeta(dSys, dDia, paSys, paDia) {
    const s = n(dSys), d = n(dDia), ps = n(paSys), pd = n(paDia);
    if (s == null || d == null || ps == null || pd == null) return null;
    if (d <= 0 || pd <= 0 || ps <= pd || s <= d) return null;
    return arrondi(Math.log(ps / pd) / ((s - d) / d), 1);
  }

  /** Rapport E/A : remplissage précoce sur remplissage auriculaire. */
  function rapportEA(e, a) {
    const x = n(e), y = n(a);
    if (x == null || y == null || y <= 0) return null;
    return arrondi(x / y, 2);
  }

  /**
   * e' moyen des deux sites, puis E/e'.
   *
   * La moyenne septale-latérale est la forme recommandée. Si un seul site
   * est disponible, on l'utilise — en le disant, car la valeur n'a pas la
   * même portée : e' septal est systématiquement plus bas que e' latéral, et
   * un E/e' calculé sur le seul septum surestime les pressions de
   * remplissage.
   */
  function ePrimeMoyen(septal, lateral) {
    const s = n(septal), l = n(lateral);
    if (s != null && l != null) return { valeur: arrondi((s + l) / 2, 1), site: 'moyenne septale et latérale' };
    if (s != null) return { valeur: s, site: 'septal seul — E/e\' surestimé' };
    if (l != null) return { valeur: l, site: 'latéral seul — E/e\' sous-estimé' };
    return null;
  }

  function rapportEsurEPrime(e, septal, lateral) {
    const x = n(e);
    const ep = ePrimeMoyen(septal, lateral);
    if (x == null || !ep || !ep.valeur) return null;
    return { valeur: arrondi(x / ep.valeur, 1), site: ep.site };
  }

  /**
   * Lecture du E/e'.
   *
   * Les bornes 8 et 14 sont celles des recommandations usuelles. La zone
   * intermédiaire n'est pas un défaut de la méthode : elle existe, et la
   * nommer vaut mieux que de forcer un classement binaire.
   */
  function lireEsurEPrime(v) {
    if (v == null) return null;
    if (v < 8)  return { libelle: 'pressions de remplissage normales', couleur: '#16a34a' };
    if (v <= 14) return { libelle: 'zone intermédiaire — non conclusif isolément', couleur: '#ca8a04' };
    return { libelle: 'pressions de remplissage élevées', couleur: '#dc2626' };
  }

  /**
   * Lecture du GLS. Le signe compte : −20 % est meilleur que −14 %.
   * Une valeur affichée en positif se compare à l'envers, d'où la
   * normalisation en négatif avant interprétation.
   */
  function lireGls(v) {
    const x = n(v);
    if (x == null) return null;
    const g = x > 0 ? -x : x;
    if (g <= -18) return { valeur: g, libelle: 'normal', couleur: '#16a34a' };
    if (g <= -16) return { valeur: g, libelle: 'limite inférieure', couleur: '#ca8a04' };
    return { valeur: g, libelle: 'altéré', couleur: '#dc2626' };
  }

  /**
   * Lecture d'un Z-score aortique — inséparable de son référentiel.
   *
   * Campens, Devereux, Boston et Gautier donnent, pour le même patient, des
   * Z-scores qui diffèrent jusqu'à une unité entière. Sans le nom du
   * nomogramme, le chiffre n'est pas interprétable, et la fonction refuse de
   * conclure plutôt que de laisser croire à une lecture fiable.
   */
  function lireZScore(z, reference) {
    const x = n(z);
    if (x == null) return null;
    const base = { valeur: x, reference: reference || null };
    if (!reference) {
      return Object.assign(base, {
        libelle: 'référentiel non précisé — non interprétable',
        couleur: '#94a3b8'
      });
    }
    if (x >= 3)   return Object.assign(base, { libelle: 'dilatation marquée', couleur: '#dc2626' });
    if (x >= 2)   return Object.assign(base, { libelle: 'dilatation', couleur: '#ea580c' });
    return Object.assign(base, { libelle: 'dans les limites', couleur: '#16a34a' });
  }

  window.EchoCalculs = {
    deformation, distensibilite, compliance, rigiditeBeta,
    rapportEA, ePrimeMoyen, rapportEsurEPrime,
    lireEsurEPrime, lireGls, lireZScore
  };
})();
