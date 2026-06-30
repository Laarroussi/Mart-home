/**
 * cpet-graph-preview.js — Aperçu graphique interactif d'un test CPET (v2)
 * ============================================================
 *
 * window.openCpetGraphPreview(examId)
 *
 * 4 onglets :
 *   1) Wasserman + V-slope : VE/VO2, VE/VCO2, PetO2, PetCO2, V-slope (VCO2 vs VO2)
 *      avec curseurs SV1 (VT1) et SV2 (VT2)
 *   2) VO2 max / Plateau / OUES : VO2/temps, VO2/puissance, OUES (VO2 vs log10(VE))
 *      avec marqueur VO2 retenue + statut + plateau auto
 *   3) Dépense énergétique : Weir modifié (EE = 3.9·VO2 + 1.1·VCO2 en L/min, kcal/min)
 *      avec instantanée + cumulée + zone d'analyse
 *   4) Coût énergétique : VO2 / Puissance (mL/W/min) ou VO2/vitesse selon ergomètre
 *      avec zone stable sélectionnable
 *
 * Panneau latéral live avec toutes les valeurs recalculées.
 * Boutons : Enregistrer · Valider · Retour.
 * Auto-détection des seuils sur demande (méthode V-slope + équivalents).
 *
 * Persistance : POST /api/medical-exams/:id/graph-config (curseurs + zones + validation)
 * ============================================================ */
(function () {
  'use strict';

  // === État courant ===
  let _exam = null;
  let _cycles = [];
  let _keyMap = {};         // normalized header → original header
  let _charts = {};
  let _cursors = {};        // sv1_t, sv2_t, vo2max_t en secondes
  let _zones = {};          // energy/cost start/end
  let _vo2Manual = {};      // status, has_plateau

  // ============================================================
  // === Plugin Chart.js : curseurs verticaux ==================
  // ============================================================
  const cursorPlugin = {
    id: 'verticalCursors',
    afterDraw(chart, args, opts) {
      if (!opts || !opts.cursors) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      opts.cursors.forEach(cur => {
        if (cur.value == null || cur.hidden) return;
        const x = xScale.getPixelForValue(cur.value);
        if (x < chartArea.left || x > chartArea.right) return;
        ctx.save();
        ctx.strokeStyle = cur.color || '#ef4444';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cur.color || '#ef4444';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(cur.label || '', x, chartArea.top - 4);
        ctx.restore();
      });
    }
  };
  if (window.Chart) Chart.register(cursorPlugin);

  // ============================================================
  // === Helpers numériques + matching de clés =================
  // ============================================================
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v instanceof Date) return null;
    const s = String(v).replace(/\s/g, '').replace(',', '.');
    const x = parseFloat(s);
    return isFinite(x) ? x : null;
  }

  // Normalise une clé : lowercase, sans accents, sans unités, sans espaces/séparateurs
  function normKey(k) {
    return String(k || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accents
      .replace(/\[[^\]]*\]/g, '')                          // [unit]
      .replace(/\([^)]*\)/g, '')                           // (unit)
      .replace(/['"`’]/g, '')                              // apostrophes
      .replace(/[\s_\-\.]/g, '')                           // espaces/séparateurs
      .replace(/₂/g, '2').replace(/₀/g, '0').replace(/₁/g, '1')
      .replace(/˙/g, '')                              // dot above (V̇)
      .trim();
  }

  // Construit la table : norm(header) → header original (premier rencontré)
  function buildKeyMap() {
    _keyMap = {};
    for (const c of _cycles) {
      for (const k of Object.keys(c)) {
        const n = normKey(k);
        if (n && !(n in _keyMap)) _keyMap[n] = k;
      }
    }
  }

  // Récupère une valeur du cycle en essayant plusieurs alias
  function getCol(c, ...names) {
    if (!c) return null;
    for (const n of names) {
      const key = _keyMap[normKey(n)];
      if (key != null && c[key] != null && c[key] !== '') {
        const v = num(c[key]);
        if (v != null) return v;
      }
    }
    return null;
  }

  // === Alias usuels (COSMED FR / EN) ===
  function getVO2(c)   { return getCol(c, 'VO2', 'V\'O2', 'V̇O2', 'VO_2', 'VO2 STPD', 'VO2STPD'); }
  function getVCO2(c)  { return getCol(c, 'VCO2', 'V\'CO2', 'V̇CO2', 'VCO_2', 'VCO2 STPD'); }
  function getVE(c)    { return getCol(c, 'VE', 'V\'E', 'V̇E', 'Ve', 'VE BTPS', 'VEBTPS', 'VE STPD'); }
  function getHR(c)    { return getCol(c, 'HR', 'Hr', 'FC', 'Heart Rate', 'HeartRate', 'Frequence cardiaque'); }
  function getPower(c) { return getCol(c, 'Power', 'Watt', 'W', 'WR', 'Charge', 'Load'); }
  function getRER(c)   { return getCol(c, 'RQ', 'RER', 'R'); }
  function getVO2Kg(c) { return getCol(c, 'VO2/Kg', 'VO2Kg', 'VO2/kg', 'VO2_kg'); }
  function getPetO2(c) { return getCol(c, 'PetO2', 'PETO2', 'PetO_2', 'PET O2', 'P\'ETO2'); }
  function getPetCO2(c){ return getCol(c, 'PetCO2', 'PETCO2', 'PetCO_2', 'PET CO2', 'P\'ETCO2'); }
  function getVEVO2(c) { return getCol(c, 'VE/VO2', 'EqO2', 'Eq O2', 'EqVO2'); }
  function getVEVCO2(c){ return getCol(c, 'VE/VCO2', 'EqCO2', 'Eq CO2', 'EqVCO2'); }
  function getSpeed(c) { return getCol(c, 'Speed', 'Vitesse', 'V', 'Kph', 'Km/h'); }

  function getTime(c) {
    const t = c.t ?? c.Time ?? c.time ?? c.T;
    if (t == null) {
      // Essai via keyMap
      const k = _keyMap[normKey('t')] || _keyMap[normKey('time')];
      if (k != null) return parseT(c[k]);
      return null;
    }
    return parseT(t);
  }
  function parseT(t) {
    if (t == null) return null;
    if (typeof t === 'number') return t > 100000 ? t / 1000 : t;
    if (typeof t === 'string') {
      const parts = t.split(':').map(s => parseFloat(s));
      if (parts.length === 3 && parts.every(isFinite)) return parts[0]*3600 + parts[1]*60 + parts[2];
      if (parts.length === 2 && parts.every(isFinite)) return parts[0]*60 + parts[1];
      return num(t);
    }
    if (t instanceof Date) return t.getHours()*3600 + t.getMinutes()*60 + t.getSeconds();
    return null;
  }

  function lastTime() {
    for (let i = _cycles.length - 1; i >= 0; i--) {
      const t = getTime(_cycles[i]);
      if (t != null) return t;
    }
    return 600;
  }
  function firstTime() {
    for (const c of _cycles) {
      const t = getTime(c);
      if (t != null) return t;
    }
    return 0;
  }
  function clampT(t) {
    const lo = firstTime(), hi = lastTime();
    if (t == null || !isFinite(t)) return Math.round((lo + hi) / 2);
    return Math.max(lo, Math.min(hi, t));
  }
  function nearestCycle(timeS) {
    let best = null, bestDiff = Infinity;
    for (const c of _cycles) {
      const t = getTime(c);
      if (t == null) continue;
      const d = Math.abs(t - timeS);
      if (d < bestDiff) { bestDiff = d; best = c; }
    }
    return best;
  }

  // === Génération d'une série {x, y} pour Chart.js ===
  function seriesComputed(fn) {
    const out = [];
    for (const c of _cycles) {
      const t = getTime(c);
      const y = fn(c);
      if (t != null && y != null && isFinite(y)) out.push({ x: t, y });
    }
    return out;
  }

  // ============================================================
  // === Algorithmes de détection seuils + VO2max ===============
  // ============================================================

  // V-slope segmenté : trouve le point d'inflexion VCO2 vs VO2
  // où la pente passe de a1 < 1 à a2 > 1 (ou clairement au-dessus)
  function detectVT1_Vslope() {
    const pts = [];
    for (const c of _cycles) {
      const t = getTime(c);
      const vo2 = getVO2(c);
      const vco2 = getVCO2(c);
      if (t != null && vo2 != null && vco2 != null && vo2 > 200) {
        pts.push({ t, vo2, vco2 });
      }
    }
    if (pts.length < 12) return null;
    // Cherche le break point qui minimise la somme des erreurs des 2 régressions
    let bestErr = Infinity, bestIdx = -1;
    const minSeg = Math.max(5, Math.floor(pts.length * 0.15));
    for (let i = minSeg; i < pts.length - minSeg; i++) {
      const r1 = lineReg(pts.slice(0, i), p => p.vo2, p => p.vco2);
      const r2 = lineReg(pts.slice(i), p => p.vo2, p => p.vco2);
      if (!r1 || !r2) continue;
      // Critère : a1 < 1 (ou proche) et a2 > a1 + 0.1 (rupture)
      if (r1.slope < r2.slope - 0.05 && r1.slope < 1.05) {
        const err = r1.err + r2.err;
        if (err < bestErr) { bestErr = err; bestIdx = i; }
      }
    }
    return bestIdx >= 0 ? pts[bestIdx].t : null;
  }

  // VT2 (RCP) : point où VE/VCO2 commence à remonter après une phase stable/décroissante
  function detectVT2_VeVco2() {
    const pts = [];
    for (const c of _cycles) {
      const t = getTime(c);
      let r = getVEVCO2(c);
      if (r == null) {
        const ve = getVE(c), vco2 = getVCO2(c);
        if (ve != null && vco2 != null && vco2 > 0) r = ve / (vco2 / 1000);
      }
      if (t != null && r != null && isFinite(r)) pts.push({ t, r });
    }
    if (pts.length < 12) return null;
    // Lissage : moyenne mobile sur 5 points
    const sm = pts.map((p, i) => {
      const w = pts.slice(Math.max(0, i - 2), i + 3);
      return { t: p.t, r: w.reduce((a, x) => a + x.r, 0) / w.length };
    });
    // Cherche le minimum local après le milieu du test
    const tMid = (sm[0].t + sm[sm.length - 1].t) / 2;
    let minIdx = -1, minR = Infinity;
    for (let i = Math.floor(sm.length / 3); i < sm.length - 5; i++) {
      if (sm[i].t < tMid * 0.6) continue;
      if (sm[i].r < minR) { minR = sm[i].r; minIdx = i; }
    }
    return minIdx >= 0 ? sm[minIdx].t : null;
  }

  // Régression linéaire simple y = a·x + b ; retourne slope, intercept, err résiduelle
  function lineReg(pts, fx, fy) {
    if (!pts || pts.length < 2) return null;
    const n = pts.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (const p of pts) {
      const x = fx(p), y = fy(p);
      sx += x; sy += y; sxy += x * y; sxx += x * x;
    }
    const d = n * sxx - sx * sx;
    if (d === 0) return null;
    const slope = (n * sxy - sx * sy) / d;
    const intercept = (sy - slope * sx) / n;
    let err = 0;
    for (const p of pts) {
      const e = fy(p) - (slope * fx(p) + intercept);
      err += e * e;
    }
    return { slope, intercept, err: Math.sqrt(err / n) };
  }

  // Détection automatique de plateau de VO2 :
  // ΔVO2 entre les 30 dernières secondes et les 30 secondes précédentes < 150 mL/min
  function detectPlateau() {
    const vo2s = seriesComputed(getVO2);
    if (vo2s.length < 6) return false;
    const tEnd = vo2s[vo2s.length - 1].x;
    const last30 = vo2s.filter(p => p.x >= tEnd - 30);
    const prev30 = vo2s.filter(p => p.x >= tEnd - 60 && p.x < tEnd - 30);
    if (last30.length < 2 || prev30.length < 2) return false;
    const mLast = last30.reduce((a, p) => a + p.y, 0) / last30.length;
    const mPrev = prev30.reduce((a, p) => a + p.y, 0) / prev30.length;
    return Math.abs(mLast - mPrev) < 150;
  }

  function guessVO2max() {
    let best = null, tBest = lastTime();
    // Sur fenêtre lissée 15s
    const vo2s = seriesComputed(getVO2);
    for (let i = 0; i < vo2s.length; i++) {
      const win = vo2s.filter(p => p.x >= vo2s[i].x - 7.5 && p.x <= vo2s[i].x + 7.5);
      const mean = win.reduce((a, p) => a + p.y, 0) / win.length;
      if (best == null || mean > best) { best = mean; tBest = vo2s[i].x; }
    }
    return tBest;
  }

  // ============================================================
  // === Ouverture de la modale =================================
  // ============================================================
  window.openCpetGraphPreview = async function (examId) {
    try {
      const r = await window.MarfanAPI.medicalExams.get(examId);
      _exam = r.exam;
      if (_exam.exam_type !== 'cpet') {
        alert('L\'aperçu graphique est disponible uniquement pour les examens CPET.');
        return;
      }
      _cycles = (_exam.parsed_full && _exam.parsed_full.cycles) || [];
      if (!_cycles.length) {
        alert('Aucune donnée cycle-par-cycle disponible.\nL\'aperçu graphique nécessite un fichier CPET avec cycles détaillés.');
        return;
      }
      buildKeyMap();
      console.log('[CPET] keyMap :', _keyMap);
      console.log('[CPET] sample cycle :', _cycles[0]);

      const cfg = _exam.graph_config || {};
      const s = _exam.parsed_summary || {};
      const tmax = lastTime();

      // SV1/SV2 : on prend la config sauvegardée, sinon parsed_summary CLAMPÉ, sinon auto-détection
      _cursors = {
        sv1_t: clampT(cfg.cursor_sv1_t_s != null ? cfg.cursor_sv1_t_s :
                      (clampValidT(num(s.sv1_t), tmax) ?? detectVT1_Vslope() ?? Math.round(tmax * 0.45))),
        sv2_t: clampT(cfg.cursor_sv2_t_s != null ? cfg.cursor_sv2_t_s :
                      (clampValidT(num(s.sv2_t), tmax) ?? detectVT2_VeVco2() ?? Math.round(tmax * 0.75))),
        vo2max_t: clampT(cfg.cursor_vo2max_t_s != null ? cfg.cursor_vo2max_t_s : guessVO2max())
      };
      _zones = {
        energy_start: cfg.energy_zone_start_s != null ? cfg.energy_zone_start_s : firstTime(),
        energy_end:   cfg.energy_zone_end_s   != null ? cfg.energy_zone_end_s   : tmax,
        cost_start:   cfg.cost_zone_start_s   != null ? cfg.cost_zone_start_s   : firstTime(),
        cost_end:     cfg.cost_zone_end_s     != null ? cfg.cost_zone_end_s     : tmax
      };
      _vo2Manual = {
        status: cfg.vo2_status || 'peak',
        has_plateau: cfg.has_plateau != null ? cfg.has_plateau : detectPlateau()
      };

      buildModal();
      switchTab('wasserman');
      recompute();
    } catch (e) {
      console.error(e);
      alert('Erreur ouverture aperçu graphique : ' + e.message);
    }
  };
  // Ne valide une valeur t qu'elle est dans [0, tmax * 1.1] (sinon c'est une valeur sentinelle)
  function clampValidT(t, tmax) {
    if (t == null || !isFinite(t)) return null;
    if (t < 0 || t > tmax * 1.1) return null;
    return t;
  }

  // ============================================================
  // === Construction de la modale ==============================
  // ============================================================
  function buildModal() {
    const old = document.getElementById('cpetGraphPreviewModal');
    if (old) old.remove();
    const isValidated = _exam.status === 'validated' || _exam.status === 'modified_after_validation';
    const tmax = Math.ceil(lastTime());

    const html = `
    <div id="cpetGraphPreviewModal" style="position:fixed; inset:0; background:rgba(11,21,48,0.92); z-index:10010; display:flex; flex-direction:column; padding:14px; overflow:hidden;">
      <div style="background:white; border-radius:12px 12px 0 0; padding:14px 22px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0;">
        <div>
          <h3 style="margin:0; color:#0b1530; font-size:18px;">📊 Aperçu graphique CPET — Examen #${_exam.id}</h3>
          <p style="margin:3px 0 0; font-size:12px; color:#64748b;">
            Patient ${_exam.patient_id}
            ${_exam.exam_date ? ' · ' + new Date(_exam.exam_date).toLocaleDateString('fr-FR') : ''}
            · ${_cycles.length} cycles
            · durée ${Math.round(tmax/60)}min ${tmax%60}s
            · ${isValidated ? '<span style="color:#16a34a; font-weight:600;">✓ Validé</span>' : '<span style="color:#d97706; font-weight:600;">⏳ Non validé</span>'}
          </p>
        </div>
        <div style="display:flex; gap:8px;">
          <button onclick="window.__cpetGraphAutoDetect()" style="border:1px solid #c084fc; background:white; color:#7c3aed; padding:7px 12px; border-radius:8px; font-weight:600; cursor:pointer; font-size:12px;" title="Détecter automatiquement SV1 (V-slope) et SV2 (point d'inflexion VE/VCO₂)">🎯 Auto-détecter seuils</button>
          <button onclick="window.__closeCpetGraphPreview()" style="border:none; background:#f1f5f9; color:#475569; padding:8px 16px; border-radius:8px; font-weight:600; cursor:pointer; font-size:13px;">✕ Fermer</button>
        </div>
      </div>

      <div style="background:#f8fafc; padding:10px 22px; border-bottom:1px solid #e2e8f0; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="cpetGraphTab" data-tab="wasserman" onclick="window.__cpetGraphSwitchTab('wasserman')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">🫁 Wasserman + V-slope</button>
        <button class="cpetGraphTab" data-tab="vo2max" onclick="window.__cpetGraphSwitchTab('vo2max')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">📈 VO₂ max / Plateau / OUES</button>
        <button class="cpetGraphTab" data-tab="energy" onclick="window.__cpetGraphSwitchTab('energy')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">⚡ Dépense énergétique (Weir)</button>
        <button class="cpetGraphTab" data-tab="cost" onclick="window.__cpetGraphSwitchTab('cost')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">💰 Coût énergétique</button>
      </div>

      <div style="flex:1; display:grid; grid-template-columns: 1fr 340px; gap:0; background:white; overflow:hidden;">
        <div id="cpetGraphArea" style="overflow-y:auto; padding:14px 18px; background:#fafbfd;">
          <div class="cpetGraphTabPanel" data-tab="wasserman" style="display:none;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
              <div class="gp-card"><div class="gp-title">VE/VO₂ — repère de SV1</div><div style="height:230px;"><canvas id="gpChartVEVO2"></canvas></div></div>
              <div class="gp-card"><div class="gp-title">VE/VCO₂ — repère de SV2 (RCP)</div><div style="height:230px;"><canvas id="gpChartVEVCO2"></canvas></div></div>
              <div class="gp-card"><div class="gp-title">PetO₂ (mmHg) — augmente à SV1</div><div style="height:230px;"><canvas id="gpChartPetO2"></canvas></div></div>
              <div class="gp-card"><div class="gp-title">PetCO₂ (mmHg) — chute à SV2</div><div style="height:230px;"><canvas id="gpChartPetCO2"></canvas></div></div>
            </div>
            <div class="gp-card" style="margin-top:14px;">
              <div class="gp-title">V-slope (VCO₂ vs VO₂) — méthode Beaver pour VT1</div>
              <div style="height:280px;"><canvas id="gpChartVslope"></canvas></div>
              <div style="font-size:11px; color:#64748b; margin-top:4px;">Le point d'inflexion (changement de pente de a₁&lt;1 à a₂&gt;1) identifie VT1. Ligne pointillée à 45° pour repère.</div>
            </div>
            ${slidersBlock('wasserman', tmax)}
          </div>

          <div class="cpetGraphTabPanel" data-tab="vo2max" style="display:none;">
            <div class="gp-card"><div class="gp-title">VO₂ en fonction du temps</div><div style="height:300px;"><canvas id="gpChartVO2"></canvas></div></div>
            <div class="gp-card" style="margin-top:14px;"><div class="gp-title">VO₂ en fonction de la puissance</div><div style="height:240px;"><canvas id="gpChartVO2Power"></canvas></div></div>
            <div class="gp-card" style="margin-top:14px;">
              <div class="gp-title">OUES — VO₂ vs log₁₀(VE) (efficacité ventilatoire)</div>
              <div style="height:240px;"><canvas id="gpChartOUES"></canvas></div>
              <div style="font-size:11px; color:#64748b; margin-top:4px;">Régression linéaire ; la pente est l'OUES. Plus elle est forte, meilleure est l'efficacité.</div>
            </div>
            <div style="margin-top:12px; padding:12px; background:white; border:1px solid #e2e8f0; border-radius:10px;">
              <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
                <div>
                  <label style="font-size:11px; color:#475569; display:block;">Curseur VO₂ retenue (s)</label>
                  <input type="range" id="gpSlVO2max" min="0" max="${tmax}" step="1" value="${_cursors.vo2max_t}" style="width:280px;">
                  <span id="gpValVO2max" style="font-weight:700; color:#16a34a;">${_cursors.vo2max_t}s</span>
                </div>
                <div>
                  <label style="font-size:11px; color:#475569; display:block;">Statut VO₂</label>
                  <select id="gpVO2Status" style="padding:5px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;">
                    <option value="max">VO₂ max (plateau confirmé)</option>
                    <option value="peak">VO₂ peak (pas de plateau)</option>
                    <option value="submaximal">Test non maximal</option>
                    <option value="uninterpretable">Test ininterprétable</option>
                  </select>
                </div>
                <label style="font-size:12px; color:#0b1530;">
                  <input type="checkbox" id="gpHasPlateau" ${_vo2Manual.has_plateau ? 'checked' : ''}> Plateau VO₂ observé
                </label>
              </div>
            </div>
          </div>

          <div class="cpetGraphTabPanel" data-tab="energy" style="display:none;">
            <div class="gp-card"><div class="gp-title">EE instantanée — Weir : 3.9·VO₂(L/min) + 1.1·VCO₂(L/min) (kcal/min)</div><div style="height:280px;"><canvas id="gpChartEEInst"></canvas></div></div>
            <div class="gp-card" style="margin-top:14px;"><div class="gp-title">EE cumulée pendant l'effort (kcal)</div><div style="height:220px;"><canvas id="gpChartEECum"></canvas></div></div>
            <div class="gp-card" style="margin-top:14px;"><div class="gp-title">Contributions substrats (% glucides / lipides)</div><div style="height:200px;"><canvas id="gpChartSubst"></canvas></div></div>
            ${zoneSlidersBlock('energy', tmax)}
          </div>

          <div class="cpetGraphTabPanel" data-tab="cost" style="display:none;">
            <div class="gp-card"><div class="gp-title">Coût énergétique instantané (mLO₂/W ou mLO₂/m)</div><div style="height:280px;"><canvas id="gpChartCost"></canvas></div></div>
            <div class="gp-card" style="margin-top:14px;"><div class="gp-title">Coût en fonction de la puissance</div><div style="height:220px;"><canvas id="gpChartCostPwr"></canvas></div></div>
            ${zoneSlidersBlock('cost', tmax)}
            <div style="margin-top:8px; font-size:11.5px; color:#64748b;">
              Sur cycle ergomètre : EC ≈ VO₂(mL/min) / Puissance(W) → typiquement 10-13 mL/W/min.
              Sélectionnez une zone d'effort stable (excluez les premières minutes et la fin).
            </div>
          </div>
        </div>

        <div style="background:white; border-left:1px solid #e2e8f0; overflow-y:auto; padding:16px;">
          <h4 style="margin:0 0 10px; color:#0b1530; font-size:14px;">📋 Valeurs retenues</h4>
          <div id="gpPanel" style="font-size:12px;"></div>
          <h4 style="margin:16px 0 8px; color:#0b1530; font-size:13px;">💬 Commentaires</h4>
          <textarea id="gpComments" placeholder="Notes cliniques, ajustements effectués, contexte du test..." style="width:100%; min-height:80px; border:1px solid #cbd5e1; border-radius:7px; padding:8px; font-size:12px; font-family:inherit; resize:vertical;">${_exam.notes || ''}</textarea>
        </div>
      </div>

      <div style="background:white; border-radius:0 0 12px 12px; padding:12px 22px; display:flex; gap:10px; justify-content:flex-end; border-top:1px solid #e2e8f0;">
        <button onclick="window.__closeCpetGraphPreview()" style="border:1px solid #cbd5e1; background:white; color:#475569; padding:9px 18px; border-radius:8px; font-weight:600; cursor:pointer; font-size:13px;">← Retour au dossier</button>
        <button onclick="window.__cpetGraphSave(false)" style="border:1px solid #2563eb; background:white; color:#2563eb; padding:9px 18px; border-radius:8px; font-weight:600; cursor:pointer; font-size:13px;">💾 Enregistrer sans valider</button>
        <button onclick="window.__cpetGraphSave(true)" style="border:none; background:linear-gradient(135deg,#10b981,#059669); color:white; padding:9px 22px; border-radius:8px; font-weight:700; cursor:pointer; font-size:13px;">✓ Valider l'analyse</button>
      </div>
    </div>

    <style>
      .gp-card { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px; box-shadow:0 1px 3px rgba(0,0,0,0.04); }
      .gp-title { font-size:12px; font-weight:700; color:#0b1530; margin-bottom:6px; }
      .cpetGraphTab { background:white; color:#475569; border:1px solid #e2e8f0 !important; }
      .cpetGraphTab.active { background:linear-gradient(135deg,#7c3aed,#a855f7) !important; color:white !important; border-color:transparent !important; }
      #gpPanel .row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px dashed #eef0f5; }
      #gpPanel .row .lab { color:#64748b; }
      #gpPanel .row .val { font-weight:700; color:#0b1530; }
      #gpPanel .grp-title { font-size:11px; font-weight:700; color:#7c3aed; text-transform:uppercase; letter-spacing:0.5px; margin:12px 0 4px; }
    </style>`;
    document.body.insertAdjacentHTML('beforeend', html);

    // Init UI
    const sel = document.getElementById('gpVO2Status');
    if (sel) sel.value = _vo2Manual.status || 'peak';

    wireSlider('gpSlSV1', 'gpValSV1', v => { _cursors.sv1_t = v; recompute(); });
    wireSlider('gpSlSV2', 'gpValSV2', v => { _cursors.sv2_t = v; recompute(); });
    wireSlider('gpSlVO2max', 'gpValVO2max', v => { _cursors.vo2max_t = v; recompute(); });
    wireSlider('gpSlEnStart', 'gpValEnStart', v => { _zones.energy_start = v; recompute(); });
    wireSlider('gpSlEnEnd', 'gpValEnEnd', v => { _zones.energy_end = v; recompute(); });
    wireSlider('gpSlCostStart', 'gpValCostStart', v => { _zones.cost_start = v; recompute(); });
    wireSlider('gpSlCostEnd', 'gpValCostEnd', v => { _zones.cost_end = v; recompute(); });
    if (sel) sel.addEventListener('change', () => { _vo2Manual.status = sel.value; recompute(); });
    const cb = document.getElementById('gpHasPlateau');
    if (cb) cb.addEventListener('change', () => { _vo2Manual.has_plateau = cb.checked; recompute(); });
  }

  function slidersBlock(tab, tmax) {
    return `
      <div style="margin-top:12px; padding:12px; background:white; border:1px solid #e2e8f0; border-radius:10px;">
        <div style="display:flex; gap:18px; flex-wrap:wrap; align-items:center;">
          <div>
            <label style="font-size:11px; color:#475569; display:block;">Curseur SV1 / VT1 (s)</label>
            <input type="range" id="gpSlSV1" min="0" max="${tmax}" step="1" value="${_cursors.sv1_t}" style="width:240px;">
            <span id="gpValSV1" style="font-weight:700; color:#dc2626;">${_cursors.sv1_t}s</span>
          </div>
          <div>
            <label style="font-size:11px; color:#475569; display:block;">Curseur SV2 / VT2 (s)</label>
            <input type="range" id="gpSlSV2" min="0" max="${tmax}" step="1" value="${_cursors.sv2_t}" style="width:240px;">
            <span id="gpValSV2" style="font-weight:700; color:#7c3aed;">${_cursors.sv2_t}s</span>
          </div>
        </div>
      </div>`;
  }
  function zoneSlidersBlock(scope, tmax) {
    const start = scope === 'energy' ? _zones.energy_start : _zones.cost_start;
    const end = scope === 'energy' ? _zones.energy_end : _zones.cost_end;
    const idS = scope === 'energy' ? 'gpSlEnStart' : 'gpSlCostStart';
    const idE = scope === 'energy' ? 'gpSlEnEnd'   : 'gpSlCostEnd';
    const idVS = scope === 'energy' ? 'gpValEnStart' : 'gpValCostStart';
    const idVE = scope === 'energy' ? 'gpValEnEnd'   : 'gpValCostEnd';
    const color = scope === 'energy' ? '#0891b2' : '#a16207';
    return `
      <div style="margin-top:12px; padding:12px; background:white; border:1px solid #e2e8f0; border-radius:10px;">
        <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
          <div>
            <label style="font-size:11px; color:#475569; display:block;">Début zone (s)</label>
            <input type="range" id="${idS}" min="0" max="${tmax}" step="1" value="${start}" style="width:220px;">
            <span id="${idVS}" style="font-weight:700; color:${color};">${start}s</span>
          </div>
          <div>
            <label style="font-size:11px; color:#475569; display:block;">Fin zone (s)</label>
            <input type="range" id="${idE}" min="0" max="${tmax}" step="1" value="${end}" style="width:220px;">
            <span id="${idVE}" style="font-weight:700; color:${color};">${end}s</span>
          </div>
        </div>
      </div>`;
  }

  function wireSlider(slId, valId, cb) {
    const sl = document.getElementById(slId);
    const v = document.getElementById(valId);
    if (!sl) return;
    sl.addEventListener('input', () => {
      const x = parseInt(sl.value, 10);
      if (v) v.textContent = x + 's';
      cb(x);
    });
  }

  // ============================================================
  // === Switch d'onglet =========================================
  // ============================================================
  function switchTab(tabName) {
    document.querySelectorAll('.cpetGraphTab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tabName);
    });
    document.querySelectorAll('.cpetGraphTabPanel').forEach(p => {
      p.style.display = p.dataset.tab === tabName ? 'block' : 'none';
    });
    if (tabName === 'wasserman' && !_charts._wasserman) buildWassermanCharts();
    if (tabName === 'vo2max' && !_charts._vo2max) buildVO2Charts();
    if (tabName === 'energy' && !_charts._energy) buildEnergyCharts();
    if (tabName === 'cost' && !_charts._cost) buildCostCharts();
    updateCursorsOnCharts();
  }
  window.__cpetGraphSwitchTab = switchTab;

  // ============================================================
  // === Construction des charts ================================
  // ============================================================
  function baseChartOpts(titleY, xLabel = 'Temps (s)') {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: ctx => xLabel.split(' ')[0] + ' = ' + Math.round(ctx[0].parsed.x) } },
        verticalCursors: { cursors: [] }
      },
      scales: {
        x: { type: 'linear', title: { display: true, text: xLabel, font: { size: 11 } }, ticks: { font: { size: 10 } } },
        y: { title: { display: true, text: titleY, font: { size: 11 } }, ticks: { font: { size: 10 } } }
      }
    };
  }

  function mkChart(canvasId, data, yLabel, color, lineLabel, opts = {}) {
    const el = document.getElementById(canvasId);
    if (!el) return null;
    return new Chart(el.getContext('2d'), {
      type: opts.type || 'line',
      data: { datasets: [{
        label: lineLabel, data,
        borderColor: color, backgroundColor: color + '22',
        borderWidth: opts.borderWidth ?? 2,
        pointRadius: opts.pointRadius ?? 0,
        tension: opts.tension ?? 0.25,
        fill: opts.fill ?? true,
        showLine: opts.showLine ?? true
      }] },
      options: opts.options || baseChartOpts(yLabel, opts.xLabel || 'Temps (s)')
    });
  }

  function buildWassermanCharts() {
    // VE/VO2 : priorité à la colonne directe, sinon calculée
    const veVo2 = seriesComputed(c => {
      const d = getVEVO2(c);
      if (d != null) return d;
      const ve = getVE(c), vo2 = getVO2(c);
      if (ve != null && vo2 != null && vo2 > 0) return ve / (vo2 / 1000);
      return null;
    });
    const veVco2 = seriesComputed(c => {
      const d = getVEVCO2(c);
      if (d != null) return d;
      const ve = getVE(c), vco2 = getVCO2(c);
      if (ve != null && vco2 != null && vco2 > 0) return ve / (vco2 / 1000);
      return null;
    });
    const petO2 = seriesComputed(getPetO2);
    const petCO2 = seriesComputed(getPetCO2);

    _charts.veVo2  = mkChart('gpChartVEVO2',  veVo2,  'VE/VO₂',  '#0891b2', 'VE/VO₂');
    _charts.veVco2 = mkChart('gpChartVEVCO2', veVco2, 'VE/VCO₂', '#7c3aed', 'VE/VCO₂');
    _charts.petO2  = mkChart('gpChartPetO2',  petO2,  'PetO₂ (mmHg)',  '#10b981', 'PetO₂');
    _charts.petCO2 = mkChart('gpChartPetCO2', petCO2, 'PetCO₂ (mmHg)', '#f59e0b', 'PetCO₂');

    // V-slope : VCO2 vs VO2
    const vsl = [];
    for (const c of _cycles) {
      const vo2 = getVO2(c), vco2 = getVCO2(c);
      if (vo2 != null && vco2 != null && vo2 > 100) vsl.push({ x: vo2 / 1000, y: vco2 / 1000 });
    }
    vsl.sort((a, b) => a.x - b.x);
    const vslEl = document.getElementById('gpChartVslope');
    if (vslEl) {
      // Ligne d'identité (y = x)
      const xMax = vsl.length ? Math.max(...vsl.map(p => p.x)) : 1;
      const identity = [{ x: 0, y: 0 }, { x: xMax, y: xMax }];
      _charts.vslope = new Chart(vslEl.getContext('2d'), {
        type: 'line',
        data: { datasets: [
          { label: 'V-slope', data: vsl, borderColor: '#dc2626', backgroundColor: '#fecaca44', borderWidth: 2, pointRadius: 1.5, tension: 0, fill: false, showLine: true },
          { label: 'Identité y=x', data: identity, borderColor: '#94a3b8', borderWidth: 1, borderDash: [4, 4], pointRadius: 0, fill: false, showLine: true }
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: true, labels: { font: { size: 10 } } } },
          scales: {
            x: { type: 'linear', title: { display: true, text: 'VO₂ (L/min)', font: { size: 11 } } },
            y: { title: { display: true, text: 'VCO₂ (L/min)', font: { size: 11 } } }
          }
        }
      });
    }
    _charts._wasserman = true;
  }

  function buildVO2Charts() {
    const vo2 = seriesComputed(getVO2);
    _charts.vo2 = mkChart('gpChartVO2', vo2, 'VO₂ (mL/min)', '#dc2626', 'VO₂');

    // VO2 vs Power
    const vo2pwr = [];
    for (const c of _cycles) {
      const v = getVO2(c), p = getPower(c);
      if (v != null && p != null && p > 0) vo2pwr.push({ x: p, y: v });
    }
    vo2pwr.sort((a, b) => a.x - b.x);
    const el2 = document.getElementById('gpChartVO2Power');
    if (el2 && vo2pwr.length) {
      _charts.vo2pwr = new Chart(el2.getContext('2d'), {
        type: 'line',
        data: { datasets: [{ label: 'VO₂ vs P', data: vo2pwr, borderColor: '#dc2626', backgroundColor: '#fecaca44', borderWidth: 2, pointRadius: 1.5, tension: 0.1, fill: true, showLine: true }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { type: 'linear', title: { display: true, text: 'Puissance (W)', font: { size: 11 } } },
            y: { title: { display: true, text: 'VO₂ (mL/min)', font: { size: 11 } } }
          }
        }
      });
    }

    // OUES : VO2 vs log10(VE)
    const oues = [];
    for (const c of _cycles) {
      const ve = getVE(c), v2 = getVO2(c);
      if (ve != null && ve > 1 && v2 != null) oues.push({ x: Math.log10(ve), y: v2 });
    }
    oues.sort((a, b) => a.x - b.x);
    const reg = lineReg(oues, p => p.x, p => p.y);
    const elO = document.getElementById('gpChartOUES');
    if (elO && oues.length) {
      const xMin = oues[0].x, xMax = oues[oues.length - 1].x;
      const regLine = reg ? [{ x: xMin, y: reg.slope * xMin + reg.intercept }, { x: xMax, y: reg.slope * xMax + reg.intercept }] : [];
      _charts.oues = new Chart(elO.getContext('2d'), {
        type: 'line',
        data: { datasets: [
          { label: 'VO₂ vs log₁₀(VE)', data: oues, borderColor: '#0891b2', backgroundColor: '#cffafe44', borderWidth: 1, pointRadius: 1.5, fill: false, showLine: false },
          { label: 'Régression (OUES = ' + (reg ? Math.round(reg.slope) : '?') + ')', data: regLine, borderColor: '#dc2626', borderWidth: 2, pointRadius: 0, fill: false, showLine: true }
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: true, labels: { font: { size: 10 } } } },
          scales: {
            x: { type: 'linear', title: { display: true, text: 'log₁₀(VE) (L/min)', font: { size: 11 } } },
            y: { title: { display: true, text: 'VO₂ (mL/min)', font: { size: 11 } } }
          }
        }
      });
    }
    _charts._vo2max = true;
  }

  function buildEnergyCharts() {
    // Weir modifiée : EE (kcal/min) = 3.9 · VO2(L/min) + 1.1 · VCO2(L/min)
    const eeInst = seriesComputed(c => {
      const vo2 = getVO2(c), vco2 = getVCO2(c);
      if (vo2 == null) return null;
      const vco2Lmin = (vco2 != null ? vco2 : vo2 * 0.9) / 1000;
      return 3.9 * (vo2 / 1000) + 1.1 * vco2Lmin;
    });
    // EE cumulée
    const eeCum = [];
    let cum = 0, lastT = null;
    for (const p of eeInst) {
      if (lastT != null) cum += p.y * ((p.x - lastT) / 60);
      eeCum.push({ x: p.x, y: cum });
      lastT = p.x;
    }
    _charts.eeInst = mkChart('gpChartEEInst', eeInst, 'EE (kcal/min)', '#059669', 'EE inst');
    _charts.eeCum  = mkChart('gpChartEECum',  eeCum,  'EE cumulée (kcal)', '#10b981', 'EE cum');

    // Contribution substrats à partir du RER : %Glucides = (RER - 0.7) / 0.3 × 100
    const glu = [];
    const lip = [];
    for (const c of _cycles) {
      const t = getTime(c), rer = getRER(c);
      if (t == null || rer == null) continue;
      const r = Math.max(0.7, Math.min(1.0, rer));
      const g = (r - 0.7) / 0.3 * 100;
      glu.push({ x: t, y: g });
      lip.push({ x: t, y: 100 - g });
    }
    const elS = document.getElementById('gpChartSubst');
    if (elS && glu.length) {
      _charts.subst = new Chart(elS.getContext('2d'), {
        type: 'line',
        data: { datasets: [
          { label: '% Glucides', data: glu, borderColor: '#f59e0b', backgroundColor: '#fef3c7', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true },
          { label: '% Lipides',  data: lip, borderColor: '#3b82f6', backgroundColor: '#dbeafe66', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: false }
        ] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: true, labels: { font: { size: 10 } } }, verticalCursors: { cursors: [] } },
          scales: {
            x: { type: 'linear', title: { display: true, text: 'Temps (s)', font: { size: 11 } } },
            y: { title: { display: true, text: '% contribution', font: { size: 11 } }, min: 0, max: 100 }
          }
        }
      });
    }
    _charts._energy = true;
  }

  function buildCostCharts() {
    // Coût = VO2 / Power (filtrage P > 20W pour éviter le bruit en début de test)
    const cost = seriesComputed(c => {
      const vo2 = getVO2(c), pwr = getPower(c);
      if (vo2 != null && pwr != null && pwr > 20) return vo2 / pwr;
      return null;
    });
    _charts.cost = mkChart('gpChartCost', cost, 'Coût (mLO₂/W·min)', '#a16207', 'Coût');

    // Coût en fonction de la puissance (= rendement delta inversé)
    const costPwr = [];
    for (const c of _cycles) {
      const v = getVO2(c), p = getPower(c);
      if (v != null && p != null && p > 20) costPwr.push({ x: p, y: v / p });
    }
    costPwr.sort((a, b) => a.x - b.x);
    const el = document.getElementById('gpChartCostPwr');
    if (el && costPwr.length) {
      _charts.costPwr = new Chart(el.getContext('2d'), {
        type: 'line',
        data: { datasets: [{ label: 'Coût vs P', data: costPwr, borderColor: '#a16207', backgroundColor: '#fef3c7', borderWidth: 2, pointRadius: 1.5, tension: 0.1, fill: true, showLine: true }] },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { type: 'linear', title: { display: true, text: 'Puissance (W)', font: { size: 11 } } },
            y: { title: { display: true, text: 'Coût (mLO₂/W·min)', font: { size: 11 } } }
          }
        }
      });
    }
    _charts._cost = true;
  }

  // ============================================================
  // === Mise à jour des curseurs sur tous les charts ===========
  // ============================================================
  function updateCursorsOnCharts() {
    const setC = (chart, cursors) => {
      if (!chart) return;
      if (!chart.options.plugins) chart.options.plugins = {};
      chart.options.plugins.verticalCursors = { cursors };
      chart.update('none');
    };
    const sv1 = { value: _cursors.sv1_t, color: '#dc2626', label: 'SV1' };
    const sv2 = { value: _cursors.sv2_t, color: '#7c3aed', label: 'SV2' };
    const v2m = { value: _cursors.vo2max_t, color: '#16a34a', label: 'VO₂max' };
    const enS = { value: _zones.energy_start, color: '#0891b2', label: 'début' };
    const enE = { value: _zones.energy_end, color: '#0891b2', label: 'fin' };
    const csS = { value: _zones.cost_start, color: '#a16207', label: 'début' };
    const csE = { value: _zones.cost_end, color: '#a16207', label: 'fin' };
    setC(_charts.veVo2,  [sv1, sv2]);
    setC(_charts.veVco2, [sv1, sv2]);
    setC(_charts.petO2,  [sv1, sv2]);
    setC(_charts.petCO2, [sv1, sv2]);
    setC(_charts.vo2,    [v2m, sv1, sv2]);
    setC(_charts.eeInst, [enS, enE]);
    setC(_charts.eeCum,  [enS, enE]);
    setC(_charts.subst,  [sv1, sv2]);
    setC(_charts.cost,   [csS, csE]);
  }

  // ============================================================
  // === Recompute (tout le panneau + valeurs sauvegardées) =====
  // ============================================================
  function recompute() {
    updateCursorsOnCharts();
    const c1 = nearestCycle(_cursors.sv1_t) || {};
    const c2 = nearestCycle(_cursors.sv2_t) || {};
    const cMax = nearestCycle(_cursors.vo2max_t) || {};
    const w = num(_exam.parsed_summary?.weight_kg) || null;
    const fmt = (v, n = 1) => v == null ? '—' : (Math.round(v * 10**n) / 10**n).toString();

    // EE sur la zone (Weir modifiée)
    let eeZone = 0, lastT = null;
    for (const c of _cycles) {
      const t = getTime(c);
      if (t == null || t < _zones.energy_start || t > _zones.energy_end) { lastT = null; continue; }
      const vo2 = getVO2(c), vco2 = getVCO2(c);
      if (vo2 == null) continue;
      const vco2Lmin = (vco2 != null ? vco2 : vo2 * 0.9) / 1000;
      const ee = 3.9 * (vo2 / 1000) + 1.1 * vco2Lmin;
      if (lastT != null) eeZone += ee * ((t - lastT) / 60);
      lastT = t;
    }

    // Coût moyen sur la zone (mLO2/W·min)
    const costVals = [];
    for (const c of _cycles) {
      const t = getTime(c);
      if (t == null || t < _zones.cost_start || t > _zones.cost_end) continue;
      const vo2 = getVO2(c), pwr = getPower(c);
      if (vo2 != null && pwr != null && pwr > 20) costVals.push(vo2 / pwr);
    }
    const costAvg = costVals.length ? costVals.reduce((a, b) => a + b, 0) / costVals.length : null;

    // VO2 retenue (lissé sur 15s autour du curseur)
    const window15 = _cycles.filter(c => {
      const t = getTime(c);
      return t != null && t >= _cursors.vo2max_t - 7.5 && t <= _cursors.vo2max_t + 7.5;
    });
    const vo2Vals = window15.map(getVO2).filter(v => v != null);
    const vo2Retained = vo2Vals.length ? vo2Vals.reduce((a, b) => a + b, 0) / vo2Vals.length : getVO2(cMax);
    const vo2KgRetained = w && vo2Retained ? vo2Retained / w : getVO2Kg(cMax);

    // RER max
    let rerMax = null;
    for (const c of _cycles) {
      const r = getRER(c);
      if (r != null && (rerMax == null || r > rerMax)) rerMax = r;
    }

    // FC max
    let hrMax = null;
    for (const c of _cycles) {
      const h = getHR(c);
      if (h != null && (hrMax == null || h > hrMax)) hrMax = h;
    }

    // P max
    let pwrMax = null;
    for (const c of _cycles) {
      const p = getPower(c);
      if (p != null && (pwrMax == null || p > pwrMax)) pwrMax = p;
    }

    // Pente VE/VCO2 : régression VE vs VCO2 de début → SV2
    const ptsVe = [];
    for (const c of _cycles) {
      const t = getTime(c);
      if (t == null || t > _cursors.sv2_t) continue;
      const ve = getVE(c), vco2 = getVCO2(c);
      if (ve != null && vco2 != null && vco2 > 0) ptsVe.push({ x: vco2 / 1000, y: ve });
    }
    const regVe = lineReg(ptsVe, p => p.x, p => p.y);
    const veVco2Slope = regVe ? regVe.slope : null;

    // OUES : pente VO2 vs log10(VE)
    const ptsO = [];
    for (const c of _cycles) {
      const ve = getVE(c), vo2 = getVO2(c);
      if (ve != null && ve > 1 && vo2 != null) ptsO.push({ x: Math.log10(ve), y: vo2 });
    }
    const regO = lineReg(ptsO, p => p.x, p => p.y);
    const oues = regO ? regO.slope : null;

    // Mémorise pour sauvegarde
    window._cpetRecalc = {
      sv1_t: _cursors.sv1_t,
      sv1_vo2: getVO2(c1),
      sv1_hr: getHR(c1),
      sv1_power: getPower(c1),
      sv1_ve_vo2: getVEVO2(c1) ?? (getVE(c1) != null && getVO2(c1) ? getVE(c1)/(getVO2(c1)/1000) : null),
      sv1_ve_vco2: getVEVCO2(c1) ?? (getVE(c1) != null && getVCO2(c1) ? getVE(c1)/(getVCO2(c1)/1000) : null),
      sv1_petO2: getPetO2(c1), sv1_petCO2: getPetCO2(c1), sv1_rer: getRER(c1),
      sv2_t: _cursors.sv2_t,
      sv2_vo2: getVO2(c2),
      sv2_hr: getHR(c2),
      sv2_power: getPower(c2),
      sv2_ve_vo2: getVEVO2(c2) ?? (getVE(c2) != null && getVO2(c2) ? getVE(c2)/(getVO2(c2)/1000) : null),
      sv2_ve_vco2: getVEVCO2(c2) ?? (getVE(c2) != null && getVCO2(c2) ? getVE(c2)/(getVCO2(c2)/1000) : null),
      sv2_petO2: getPetO2(c2), sv2_petCO2: getPetCO2(c2), sv2_rer: getRER(c2),
      vo2_retained_ml_min: vo2Retained,
      vo2_retained_ml_kg_min: vo2KgRetained,
      vo2_status: _vo2Manual.status,
      has_plateau: _vo2Manual.has_plateau,
      hr_max: hrMax, power_max: pwrMax, rer_max: rerMax,
      ve_vco2_slope: veVco2Slope, oues,
      energy_zone_kcal: eeZone, cost_avg: costAvg
    };

    const html = `
      <div class="grp-title">Seuil ventilatoire 1 (SV1 / VT1)</div>
      <div class="row"><span class="lab">Temps</span><span class="val">${fmt(_cursors.sv1_t, 0)} s</span></div>
      <div class="row"><span class="lab">VO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_vo2, 0)} mL/min</span></div>
      <div class="row"><span class="lab">FC</span><span class="val">${fmt(window._cpetRecalc.sv1_hr, 0)} bpm</span></div>
      <div class="row"><span class="lab">Puissance</span><span class="val">${fmt(window._cpetRecalc.sv1_power, 0)} W</span></div>
      <div class="row"><span class="lab">VE/VO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_ve_vo2, 1)}</span></div>
      <div class="row"><span class="lab">VE/VCO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_ve_vco2, 1)}</span></div>
      <div class="row"><span class="lab">PetO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_petO2, 1)} mmHg</span></div>
      <div class="row"><span class="lab">PetCO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_petCO2, 1)} mmHg</span></div>
      <div class="row"><span class="lab">RER</span><span class="val">${fmt(window._cpetRecalc.sv1_rer, 2)}</span></div>

      <div class="grp-title">Seuil ventilatoire 2 (SV2 / VT2 / RCP)</div>
      <div class="row"><span class="lab">Temps</span><span class="val">${fmt(_cursors.sv2_t, 0)} s</span></div>
      <div class="row"><span class="lab">VO₂</span><span class="val">${fmt(window._cpetRecalc.sv2_vo2, 0)} mL/min</span></div>
      <div class="row"><span class="lab">FC</span><span class="val">${fmt(window._cpetRecalc.sv2_hr, 0)} bpm</span></div>
      <div class="row"><span class="lab">Puissance</span><span class="val">${fmt(window._cpetRecalc.sv2_power, 0)} W</span></div>
      <div class="row"><span class="lab">VE/VO₂</span><span class="val">${fmt(window._cpetRecalc.sv2_ve_vo2, 1)}</span></div>
      <div class="row"><span class="lab">VE/VCO₂</span><span class="val">${fmt(window._cpetRecalc.sv2_ve_vco2, 1)}</span></div>
      <div class="row"><span class="lab">PetCO₂</span><span class="val">${fmt(window._cpetRecalc.sv2_petCO2, 1)} mmHg</span></div>
      <div class="row"><span class="lab">RER</span><span class="val">${fmt(window._cpetRecalc.sv2_rer, 2)}</span></div>

      <div class="grp-title">VO₂ maximale</div>
      <div class="row"><span class="lab">Statut</span><span class="val">${{max:'VO₂ max',peak:'VO₂ peak',submaximal:'Non maximal',uninterpretable:'Ininterprétable'}[_vo2Manual.status] || _vo2Manual.status}</span></div>
      <div class="row"><span class="lab">Plateau</span><span class="val">${_vo2Manual.has_plateau ? '✓ Observé' : '✗ Absent'}</span></div>
      <div class="row"><span class="lab">VO₂ retenue</span><span class="val">${fmt(vo2Retained, 0)} mL/min</span></div>
      <div class="row"><span class="lab">VO₂/Kg</span><span class="val">${fmt(vo2KgRetained, 1)} mL/kg/min</span></div>
      <div class="row"><span class="lab">FC max</span><span class="val">${fmt(hrMax, 0)} bpm</span></div>
      <div class="row"><span class="lab">P max</span><span class="val">${fmt(pwrMax, 0)} W</span></div>
      <div class="row"><span class="lab">RER max</span><span class="val">${fmt(rerMax, 2)}</span></div>
      <div class="row"><span class="lab">Pente VE/VCO₂</span><span class="val">${fmt(veVco2Slope, 1)}</span></div>
      <div class="row"><span class="lab">OUES</span><span class="val">${fmt(oues, 0)}</span></div>

      <div class="grp-title">Énergétique</div>
      <div class="row"><span class="lab">EE zone (Weir)</span><span class="val">${fmt(eeZone, 1)} kcal</span></div>
      <div class="row"><span class="lab">Coût moyen</span><span class="val">${fmt(costAvg, 2)} mLO₂/W·min</span></div>
    `;
    const panel = document.getElementById('gpPanel');
    if (panel) panel.innerHTML = html;
  }

  // ============================================================
  // === Auto-détection seuils ==================================
  // ============================================================
  window.__cpetGraphAutoDetect = function () {
    const t1 = detectVT1_Vslope();
    const t2 = detectVT2_VeVco2();
    let msg = 'Auto-détection :\n';
    if (t1) { _cursors.sv1_t = clampT(Math.round(t1)); msg += `· VT1 (V-slope) : ${Math.round(t1)}s\n`; }
    else msg += '· VT1 : non détectable (pas assez de données VO₂/VCO₂)\n';
    if (t2) { _cursors.sv2_t = clampT(Math.round(t2)); msg += `· VT2 (VE/VCO₂) : ${Math.round(t2)}s\n`; }
    else msg += '· VT2 : non détectable\n';
    _cursors.vo2max_t = clampT(guessVO2max());
    _vo2Manual.has_plateau = detectPlateau();
    msg += `· Plateau : ${_vo2Manual.has_plateau ? 'observé' : 'absent'}\n`;
    // Update sliders
    setSlider('gpSlSV1', 'gpValSV1', _cursors.sv1_t);
    setSlider('gpSlSV2', 'gpValSV2', _cursors.sv2_t);
    setSlider('gpSlVO2max', 'gpValVO2max', _cursors.vo2max_t);
    const cb = document.getElementById('gpHasPlateau');
    if (cb) cb.checked = _vo2Manual.has_plateau;
    recompute();
    alert(msg);
  };
  function setSlider(id, valId, v) {
    const s = document.getElementById(id);
    const vv = document.getElementById(valId);
    if (s) s.value = v;
    if (vv) vv.textContent = v + 's';
  }

  // ============================================================
  // === Sauvegarde / Validation ================================
  // ============================================================
  window.__cpetGraphSave = async function (validate) {
    const r = window._cpetRecalc || {};
    const graphConfig = {
      cursor_sv1_t_s: _cursors.sv1_t,
      cursor_sv2_t_s: _cursors.sv2_t,
      cursor_vo2max_t_s: _cursors.vo2max_t,
      energy_zone_start_s: _zones.energy_start,
      energy_zone_end_s: _zones.energy_end,
      cost_zone_start_s: _zones.cost_start,
      cost_zone_end_s: _zones.cost_end,
      vo2_status: _vo2Manual.status,
      has_plateau: _vo2Manual.has_plateau,
      saved_at: new Date().toISOString()
    };
    const validated = {
      ...(_exam.validated_data || _exam.parsed_summary || {}),
      sv1_t: r.sv1_t, sv1_vo2: r.sv1_vo2, sv1_hr: r.sv1_hr, sv1_power: r.sv1_power,
      sv2_t: r.sv2_t, sv2_vo2: r.sv2_vo2, sv2_hr: r.sv2_hr, sv2_power: r.sv2_power,
      vo2_max_ml_min: r.vo2_retained_ml_min,
      vo2_max_ml_kg_min: r.vo2_retained_ml_kg_min,
      hr_max: r.hr_max, power_max: r.power_max, rer_max: r.rer_max,
      ve_vco2_slope: r.ve_vco2_slope, oues: r.oues,
      vo2_status: r.vo2_status, has_plateau: r.has_plateau,
      energy_total_kcal: r.energy_zone_kcal,
      cost_avg_mlO2_W: r.cost_avg
    };
    const comments = (document.getElementById('gpComments') || {}).value || null;
    if (validate && !confirm('Valider définitivement cette analyse ?\nLes valeurs ajustées seront enregistrées avec votre identité et l\'horodatage.')) return;
    try {
      await window.MarfanAPI.medicalExams.saveGraphConfig(_exam.id, graphConfig, validated, !!validate, comments);
      alert(validate ? '✓ Analyse validée avec succès.' : '✓ Ajustements enregistrés.');
      window.__closeCpetGraphPreview();
      if (typeof window.loadMedicalExamsForCurrentPatient === 'function') {
        await window.loadMedicalExamsForCurrentPatient();
      }
    } catch (e) {
      alert('Échec de la sauvegarde : ' + e.message);
    }
  };

  window.__closeCpetGraphPreview = function () {
    const m = document.getElementById('cpetGraphPreviewModal');
    if (m) m.remove();
    Object.values(_charts).forEach(ch => { if (ch && ch.destroy) ch.destroy(); });
    _charts = {};
  };

})();
