/**
 * cpet-analyse.js — Lecture d'une épreuve d'effort cardiopulmonaire
 * ==================================================================
 *
 * À partir d'un export cycle-à-cycle (COSMED et formats voisins), produit :
 *
 *   • les seuils ventilatoires SV1 et SV2 — fréquence cardiaque, puissance,
 *     VO₂ — qui servent à borner les zones d'entraînement ;
 *   • le VO₂ de pic, et la réponse à la question de savoir s'il s'agit d'un
 *     VO₂ max ou d'un VO₂ pic ;
 *   • deux facteurs pronostiques : la pente VE/VCO₂ et l'OUES ;
 *   • cinq zones d'entraînement prêtes à l'emploi.
 *
 * DEUX PRÉCAUTIONS DE MÉTHODE, sans lesquelles les résultats sont faux.
 *
 * 1. On ne retient que la phase d'exercice. Les cycles de récupération,
 *    présents dans le même fichier, tirent toutes les moyennes vers le bas
 *    et faussent la recherche du pic.
 *
 * 2. On lisse sur trente secondes. Le signal respiration par respiration est
 *    très bruité : sur ce fichier, la valeur brute donnait un quotient
 *    respiratoire de 2,00 — physiologiquement impossible — et un VO₂ pic
 *    surestimé de 22 %. Après lissage, l'écart au logiciel COSMED tombe
 *    à 3 %.
 *
 * Expose window.CpetAnalyse = { analyser, zonesDepuisSeuils }
 */
(function () {
  'use strict';

  var FENETRE_S = 30;  // lissage
  var TOLERANCE_PLATEAU = 150; // mL/min : au-delà, pas de plateau

  // ============================================================
  // Lecture du classeur
  // ============================================================
  function versSecondes(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v > 1 ? v : Math.round(v * 86400);
    var m = String(v).match(/^(\d{1,2}):(\d{2}):(\d{2})/);
    if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function nombre(v) {
    if (v == null || v === '') return null;
    var n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    return isFinite(n) ? n : null;
  }

  /**
   * Repère la ligne d'en-tête et les colonnes utiles.
   * Les exports varient : on cherche par nom, avec plusieurs graphies.
   */
  var ALIAS = {
    t:      ['t', 'time', 'temps'],
    ve:     ['ve_ergo', 've', 've btps', 'vebtps'],
    vo2:    ['vo2'],
    vco2:   ['vco2'],
    qr:     ['qr', 'rer', 'r'],
    fc:     ['fc', 'hr', 'hf'],
    power:  ['power', 'puissance', 'watt', 'charge'],
    phase:  ['phase'],
    vo2kg:  ['vo2/kg', 'vo2kg'],
    spo2:   ['spo2', 'sao2']
  };

  function reperer(entetes) {
    var idx = {};
    entetes.forEach(function (e, i) {
      var n = String(e == null ? '' : e).trim().toLowerCase();
      if (!n) return;
      Object.keys(ALIAS).forEach(function (cle) {
        if (idx[cle] != null) return;
        if (ALIAS[cle].indexOf(n) >= 0) idx[cle] = i;
      });
    });
    return idx;
  }

  /** Extrait les cycles depuis la feuille de données */
  function lireCycles(lignes) {
    // La ligne d'en-tête est celle qui contient à la fois VO2 et VCO2.
    var ligneEntete = -1, idx = null;
    for (var r = 0; r < Math.min(lignes.length, 12); r++) {
      var essai = reperer(lignes[r] || []);
      if (essai.vo2 != null && essai.vco2 != null) { ligneEntete = r; idx = essai; break; }
    }
    if (ligneEntete < 0) return { cycles: [], idx: null };

    var cycles = [];
    for (var i = ligneEntete + 1; i < lignes.length; i++) {
      var L = lignes[i] || [];
      var vo2 = nombre(L[idx.vo2]);
      if (vo2 == null || vo2 <= 0) continue;
      cycles.push({
        t:     idx.t != null ? versSecondes(L[idx.t]) : null,
        ve:    idx.ve != null ? nombre(L[idx.ve]) : null,
        vo2:   vo2,
        vco2:  idx.vco2 != null ? nombre(L[idx.vco2]) : null,
        qr:    idx.qr != null ? nombre(L[idx.qr]) : null,
        fc:    idx.fc != null ? nombre(L[idx.fc]) : null,
        power: idx.power != null ? nombre(L[idx.power]) : null,
        vo2kg: idx.vo2kg != null ? nombre(L[idx.vo2kg]) : null,
        spo2:  idx.spo2 != null ? nombre(L[idx.spo2]) : null,
        phase: idx.phase != null ? String(L[idx.phase] || '').toUpperCase() : ''
      });
    }
    return { cycles: cycles, idx: idx };
  }

  // ============================================================
  // Outils statistiques
  // ============================================================
  function regression(points) {
    var n = points.length;
    if (n < 10) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    points.forEach(function (p) { sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; sxy += p[0] * p[1]; });
    var d = n * sxx - sx * sx;
    if (!d) return null;
    var pente = (n * sxy - sx * sy) / d;
    var ord = (sy - pente * sx) / n;
    var moy = sy / n, sst = 0, ssr = 0;
    points.forEach(function (p) {
      sst += Math.pow(p[1] - moy, 2);
      ssr += Math.pow(p[1] - (pente * p[0] + ord), 2);
    });
    return { pente: pente, ordonnee: ord, r2: sst ? 1 - ssr / sst : null, n: n };
  }

  /** Moyenne glissante sur une fenêtre temporelle, en secondes */
  function lisser(cycles, champ, fenetre) {
    var out = [];
    for (var i = 0; i < cycles.length; i++) {
      var t0 = cycles[i].t;
      var somme = 0, n = 0;
      for (var j = i; j >= 0; j--) {
        if (t0 != null && cycles[j].t != null && t0 - cycles[j].t > fenetre) break;
        var v = cycles[j][champ];
        if (v != null) { somme += v; n++; }
        if (t0 == null && i - j >= 8) break;
      }
      out.push(n ? somme / n : null);
    }
    return out;
  }

  // ============================================================
  // Analyse
  // ============================================================
  /**
   * @param {object} donnees { lignesDonnees: [[...]], lignesResultats: [[...]], sujet: {...} }
   */
  function analyser(donnees) {
    var lu = lireCycles(donnees.lignesDonnees || []);
    var tous = lu.cycles;
    if (!tous.length) return { erreur: "Aucun cycle respiratoire exploitable dans ce fichier." };

    // 1) Phase d'exercice seulement — sinon la récupération fausse tout.
    var exo = tous.filter(function (c) { return /EXERC/i.test(c.phase); });
    var aPhase = exo.length > 20;
    var src = aPhase ? exo : tous;

    // 2) Lissage
    var vo2Liss = lisser(src, 'vo2', FENETRE_S);

    // --- VO₂ de pic -------------------------------------------------
    var iPic = 0;
    for (var i = 1; i < vo2Liss.length; i++) {
      if (vo2Liss[i] != null && vo2Liss[i] > (vo2Liss[iPic] || 0)) iPic = i;
    }
    var vo2Pic = vo2Liss[iPic];
    var fcPic = null, qrPic = null, wattsPic = null;
    var fen = src.slice(Math.max(0, iPic - 8), iPic + 1);
    fen.forEach(function (c) {
      if (c.fc != null) fcPic = Math.max(fcPic || 0, c.fc);
      if (c.power != null) wattsPic = Math.max(wattsPic || 0, c.power);
    });
    var qrs = fen.map(function (c) { return c.qr; }).filter(function (v) { return v != null && v < 1.6; });
    if (qrs.length) qrPic = qrs.reduce(function (a, b) { return a + b; }, 0) / qrs.length;

    // --- VO₂ max ou VO₂ pic ? --------------------------------------
    // Un VO₂ max suppose un plateau : la consommation cesse d'augmenter
    // alors que la charge continue de croître. Sans plateau, on parle de
    // VO₂ pic — la distinction change l'interprétation de la valeur.
    var avant = vo2Liss.slice(Math.max(0, iPic - 16), Math.max(1, iPic - 8))
                       .filter(function (v) { return v != null; });
    var moyAvant = avant.length ? avant.reduce(function (a, b) { return a + b; }, 0) / avant.length : null;
    var plateau = (moyAvant != null && vo2Pic != null) ? (vo2Pic - moyAvant) < TOLERANCE_PLATEAU : false;

    var age = donnees.sujet && donnees.sujet.age ? Number(donnees.sujet.age) : null;
    var fcPred = age ? 220 - age : null;
    var criteres = {
      plateau: plateau,
      qr_atteint: qrPic != null ? qrPic >= 1.10 : null,
      fc_atteinte: (fcPic != null && fcPred) ? (fcPic >= 0.90 * fcPred) : null,
      fc_pct_predite: (fcPic != null && fcPred) ? Math.round(100 * fcPic / fcPred) : null
    };
    var nbRemplis = ['plateau', 'qr_atteint', 'fc_atteinte']
      .filter(function (k) { return criteres[k] === true; }).length;
    // Le plateau est le critère de référence : sans lui, jamais de VO₂ max.
    var nature = plateau && nbRemplis >= 2 ? 'VO2max' : 'VO2pic';

    // --- Pente VE/VCO₂ ---------------------------------------------
    // Facteur pronostique reconnu. On la calcule sur l'ensemble de
    // l'exercice, méthode la plus reproductible entre examinateurs.
    var ptsVe = src.filter(function (c) { return c.ve > 0 && c.vco2 > 0; })
                   .map(function (c) { return [c.vco2 / 1000, c.ve]; });
    var rVe = regression(ptsVe);

    // --- OUES : VO₂ = a·log₁₀(VE) + b ------------------------------
    var ptsOues = src.filter(function (c) { return c.ve > 0 && c.vo2 > 0; })
                     .map(function (c) { return [Math.log(c.ve) / Math.LN10, c.vo2]; });
    var rOues = regression(ptsOues);

    var poids = donnees.sujet && donnees.sujet.poids ? Number(donnees.sujet.poids) : null;

    // --- Seuils : priorité au logiciel, qui les a validés ----------
    var seuils = donnees.seuils || {};
    // Les fréquences cardiaques aux seuils manquent souvent dans la feuille
    // de résultats : on les retrouve dans les cycles, à l'instant indiqué.
    function fcAuTemps(sec) {
      if (sec == null) return null;
      var meilleur = null, ecart = 1e9;
      tous.forEach(function (c) {
        if (c.t == null || c.fc == null) return;
        var d = Math.abs(c.t - sec);
        if (d < ecart) { ecart = d; meilleur = c.fc; }
      });
      return ecart <= 15 ? Math.round(meilleur) : null;
    }
    var sv1Fc = seuils.sv1_fc || fcAuTemps(versSecondes(seuils.sv1_t));
    var sv2Fc = seuils.sv2_fc || fcAuTemps(versSecondes(seuils.sv2_t));

    // --- Repos ------------------------------------------------------
    var repos = tous.filter(function (c) { return /REST|REPOS/i.test(c.phase); });
    var fcRepos = null;
    if (repos.length) {
      var fcs = repos.map(function (c) { return c.fc; }).filter(function (v) { return v != null; });
      if (fcs.length) fcRepos = Math.round(fcs.reduce(function (a, b) { return a + b; }, 0) / fcs.length);
    }

    var res = {
      nb_cycles: tous.length,
      nb_cycles_exercice: exo.length,
      phase_detectee: aPhase,

      vo2_pic_ml_min: vo2Pic != null ? Math.round(vo2Pic) : null,
      vo2_pic_ml_kg_min: (vo2Pic != null && poids) ? Math.round(10 * vo2Pic / poids / 1000 * 1000) / 10 : null,
      nature_vo2: nature,
      criteres_maximalite: criteres,
      qr_pic: qrPic != null ? Math.round(qrPic * 100) / 100 : null,
      fc_pic: fcPic != null ? Math.round(fcPic) : null,
      watts_pic: wattsPic != null ? Math.round(wattsPic) : null,
      fc_repos: fcRepos,

      ve_vco2_pente: rVe ? Math.round(rVe.pente * 10) / 10 : null,
      ve_vco2_r2: rVe && rVe.r2 != null ? Math.round(rVe.r2 * 1000) / 1000 : null,
      ve_vco2_interpretation: rVe ? interpreterVeVco2(rVe.pente) : null,

      oues_ml_min: rOues ? Math.round(rOues.pente) : null,
      oues_par_kg: (rOues && poids) ? Math.round(10 * rOues.pente / poids) / 10 : null,
      oues_r2: rOues && rOues.r2 != null ? Math.round(rOues.r2 * 1000) / 1000 : null,

      sv1_fc: sv1Fc, sv2_fc: sv2Fc,
      sv1_watts: seuils.sv1_watts || null, sv2_watts: seuils.sv2_watts || null,
      sv1_vo2: seuils.sv1_vo2 || null, sv2_vo2: seuils.sv2_vo2 || null
    };

    res.zones = zonesDepuisSeuils({
      repos: fcRepos, sv1: sv1Fc, sv2: sv2Fc, pic: res.fc_pic
    });
    return res;
  }

  /**
   * Pente VE/VCO₂ : plus elle est élevée, plus la ventilation est coûteuse
   * pour évacuer le CO₂. Classes de Weber-Arena, d'usage courant.
   */
  function interpreterVeVco2(p) {
    if (p == null) return null;
    if (p < 30) return { classe: 'I', libelle: 'Normale', couleur: '#16a34a' };
    if (p < 36) return { classe: 'II', libelle: 'Modérément élevée', couleur: '#ca8a04' };
    if (p < 45) return { classe: 'III', libelle: 'Élevée', couleur: '#ea580c' };
    return { classe: 'IV', libelle: 'Très élevée', couleur: '#dc2626' };
  }

  /**
   * Cinq zones d'entraînement bornées par les seuils ventilatoires mesurés.
   *
   * Le choix de s'appuyer sur SV1 et SV2 plutôt que sur un pourcentage de la
   * fréquence maximale théorique n'est pas cosmétique : chez un patient
   * Marfan, souvent sous bêtabloquant, la formule « 220 moins l'âge » est
   * franchement fausse. Les seuils mesurés, eux, décrivent ce patient-là.
   */
  function zonesDepuisSeuils(s) {
    if (!s || !s.sv1 || !s.sv2 || !s.pic) return null;
    var repos = s.repos || Math.round(s.sv1 * 0.55);
    var z = [
      { nom: 'Échauffement',            min: repos,              max: Math.round(s.sv1 * 0.85),
        couleur: '#0ea5e9', objet: "Mise en route, retour au calme. Effort à peine perceptible." },
      { nom: 'Endurance fondamentale',  min: Math.round(s.sv1 * 0.85) + 1, max: s.sv1,
        couleur: '#22c55e', objet: "Zone de travail principale. Tenable longtemps, conversation possible." },
      { nom: 'Endurance active',        min: s.sv1 + 1,          max: Math.round((s.sv1 + s.sv2) / 2),
        couleur: '#84cc16', objet: "Entre les deux seuils. Développe la capacité aérobie." },
      { nom: 'Seuil',                   min: Math.round((s.sv1 + s.sv2) / 2) + 1, max: s.sv2,
        couleur: '#f59e0b', objet: "Approche du second seuil. Par intervalles courts, sous surveillance." },
      { nom: 'Au-delà du seuil',        min: s.sv2 + 1,          max: s.pic,
        couleur: '#dc2626', objet: "À éviter dans le syndrome de Marfan : contrainte tensionnelle sur l'aorte." }
    ];
    return z;
  }

  /**
   * Point d'entrée pratique : on lui donne le fichier tel quel.
   * Localise la feuille de cycles et la feuille de résultats, extrait le
   * sujet et les seuils, puis lance l'analyse.
   */
  function analyserClasseur(arrayBuffer) {
    if (typeof XLSX === 'undefined') throw new Error("Lecteur Excel indisponible dans cette page.");
    var wb = XLSX.read(arrayBuffer, { type: 'array' });

    var feuilles = wb.SheetNames.map(function (n) {
      return { nom: n, lignes: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: null }) };
    });
    // La feuille de cycles est la plus haute ; celle de résultats est courte.
    feuilles.sort(function (a, b) { return b.lignes.length - a.lignes.length; });
    var donnees = feuilles[0];
    var resultats = feuilles.length > 1 ? feuilles[feuilles.length - 1] : { lignes: [] };

    // --- Sujet : cherché par libellé, à gauche de la feuille de données ---
    function valeurApres(lignes, etiquette) {
      for (var i = 0; i < Math.min(lignes.length, 30); i++) {
        var L = lignes[i] || [];
        for (var c = 0; c < Math.min(L.length, 10); c++) {
          var v = String(L[c] == null ? '' : L[c]).trim().toLowerCase();
          if (v.indexOf(etiquette) === 0) {
            for (var d = c + 1; d < Math.min(L.length, c + 4); d++) {
              if (L[d] != null && String(L[d]).trim() !== '') return L[d];
            }
          }
        }
      }
      return null;
    }
    var sujet = {
      nom:    valeurApres(donnees.lignes, 'nom de famille'),
      prenom: valeurApres(donnees.lignes, 'prénom'),
      sexe:   valeurApres(donnees.lignes, 'sexe'),
      age:    nombre(valeurApres(donnees.lignes, 'âge')),
      taille: nombre(valeurApres(donnees.lignes, 'taille')),
      poids:  nombre(valeurApres(donnees.lignes, 'poids')),
      date_test: valeurApres(donnees.lignes, 'date du test'),
      ergometre: valeurApres(donnees.lignes, 'ergomètre'),
      effort_maximal: valeurApres(donnees.lignes, 'effort maximal')
    };

    // --- Seuils : lus dans la feuille de résultats ---
    // On repère la colonne SV1, SV2 et Max sur la ligne d'en-tête, puis on
    // lit les paramètres ligne par ligne. Les exports décalent les colonnes
    // d'une feuille à l'autre : se fier à une position fixe serait fragile.
    var cSv1 = -1, cSv2 = -1, cMax = -1;
    resultats.lignes.forEach(function (L) {
      (L || []).forEach(function (v, c) {
        var s = String(v == null ? '' : v).trim().toUpperCase();
        if (s === 'SV1' || s === 'VT1') cSv1 = c;
        if (s === 'SV2' || s === 'VT2') cSv2 = c;
        if (s === 'MAX' || s === 'PIC') cMax = c;
      });
    });
    function param(nom, col) {
      if (col < 0) return null;
      for (var i = 0; i < resultats.lignes.length; i++) {
        var L = resultats.lignes[i] || [];
        if (String(L[0] == null ? '' : L[0]).trim().toLowerCase() === nom.toLowerCase()) {
          return L[col];
        }
      }
      return null;
    }
    var seuils = {
      sv1_t: param('t', cSv1), sv2_t: param('t', cSv2),
      sv1_watts: nombre(param('Power', cSv1)), sv2_watts: nombre(param('Power', cSv2)),
      sv1_vo2: nombre(param('VO2', cSv1)), sv2_vo2: nombre(param('VO2', cSv2)),
      max_vo2: nombre(param('VO2', cMax)),
      max_vo2_kg: nombre(param('VO2/kg', cMax))
    };

    var out = analyser({ lignesDonnees: donnees.lignes, lignesResultats: resultats.lignes,
                         seuils: seuils, sujet: sujet });
    out.sujet = sujet;
    out.vo2_logiciel_ml_min = seuils.max_vo2 || null;
    out.vo2_logiciel_ml_kg_min = seuils.max_vo2_kg || null;
    return out;
  }

  window.CpetAnalyse = {
    analyser: analyser,
    analyserClasseur: analyserClasseur,
    zonesDepuisSeuils: zonesDepuisSeuils,
    interpreterVeVco2: interpreterVeVco2
  };
})();
