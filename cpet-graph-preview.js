/**
 * cpet-graph-preview.js — Aperçu graphique interactif d'un test CPET (v3)
 * ============================================================
 * v3 : sliders sous chaque graphe, équivalents fusionnés, couleurs
 *      O₂ = bleu / CO₂ = rouge, plateau VO₂ en rampe (VO₂ vs Puissance),
 *      OUES robuste avec fallback VE = EqO2 × VO₂.
 * ============================================================ */
(function () {
  'use strict';

  // === Couleurs unifiées ===
  const C_O2  = '#2563eb';   // bleu = O₂
  const C_CO2 = '#dc2626';   // rouge = CO₂
  const C_SV1 = '#1d4ed8';   // SV1 (O₂)
  const C_SV2 = '#b91c1c';   // SV2 (CO₂)
  const C_VO2MAX = '#16a34a';
  const C_ZONE   = '#a16207';

  let _exam = null;
  let _cycles = [];
  let _keyMap = {};
  let _charts = {};
  let _cursors = {};
  let _zones = {};
  let _vo2Manual = {};
  let _plateauInfo = {};

  // === Plugin Chart.js : curseurs verticaux ===
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
        ctx.strokeStyle = cur.color || '#dc2626';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cur.color || '#dc2626';
        ctx.font = 'bold 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(cur.label || '', x, chartArea.top - 4);
        ctx.restore();
      });
    }
  };
  if (window.Chart) Chart.register(cursorPlugin);

  // === Helpers numériques + matching fuzzy ===
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (v instanceof Date) return null;
    const s = String(v).replace(/\s/g, '').replace(',', '.');
    const x = parseFloat(s);
    return isFinite(x) ? x : null;
  }
  function normKey(k) {
    return String(k || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/['"`’]/g, '')
      .replace(/[\s_\-\.]/g, '')
      .replace(/₂/g, '2').replace(/₀/g, '0').replace(/₁/g, '1')
      .replace(/˙/g, '')
      .trim();
  }
  function buildKeyMap() {
    _keyMap = {};
    for (const c of _cycles) {
      for (const k of Object.keys(c)) {
        const n = normKey(k);
        if (n && !(n in _keyMap)) _keyMap[n] = k;
      }
    }
  }
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
  function getVO2(c)   { return getCol(c, 'VO2', 'V\'O2', 'V̇O2', 'VO_2', 'VO2 STPD'); }
  function getVCO2(c)  { return getCol(c, 'VCO2', 'V\'CO2', 'V̇CO2', 'VCO_2', 'VCO2 STPD'); }
  function getVE(c)    { return getCol(c, 'VE', 'V\'E', 'V̇E', 'Ve', 'VE BTPS', 'VE STPD'); }
  function getHR(c)    { return getCol(c, 'HR', 'Hr', 'FC', 'Heart Rate', 'HeartRate'); }
  function getPower(c) { return getCol(c, 'Power', 'Watt', 'W', 'WR', 'Charge', 'Load'); }
  function getRER(c)   { return getCol(c, 'RQ', 'RER', 'R'); }
  function getVO2Kg(c) { return getCol(c, 'VO2/Kg', 'VO2Kg', 'VO2/kg', 'VO2_kg'); }
  function getPetO2(c) { return getCol(c, 'PetO2', 'PETO2', 'PetO_2', 'PET O2', 'P\'ETO2'); }
  function getPetCO2(c){ return getCol(c, 'PetCO2', 'PETCO2', 'PetCO_2', 'PET CO2', 'P\'ETCO2'); }
  function getVEVO2(c) { return getCol(c, 'VE/VO2', 'EqO2', 'Eq O2', 'EqVO2'); }
  function getVEVCO2(c){ return getCol(c, 'VE/VCO2', 'EqCO2', 'Eq CO2', 'EqVCO2'); }

  /** VE effectif : si la colonne VE n'existe pas, on reconstruit à partir des
   *  équivalents (VE = EqO2 × VO2_Lmin ou EqCO2 × VCO2_Lmin). */
  function getVEEffective(c) {
    const ve = getVE(c);
    if (ve != null && ve > 0) return ve;
    const eqO2 = getVEVO2(c), vo2 = getVO2(c);
    if (eqO2 != null && vo2 != null && vo2 > 0) return eqO2 * (vo2 / 1000);
    const eqCO2 = getVEVCO2(c), vco2 = getVCO2(c);
    if (eqCO2 != null && vco2 != null && vco2 > 0) return eqCO2 * (vco2 / 1000);
    return null;
  }

  function getTime(c) {
    const t = c.t ?? c.Time ?? c.time ?? c.T;
    if (t != null) return parseT(t);
    const k = _keyMap[normKey('t')] || _keyMap[normKey('time')];
    if (k != null) return parseT(c[k]);
    return null;
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
  function clampValidT(t, tmax) {
    if (t == null || !isFinite(t)) return null;
    if (t < 0 || t > tmax * 1.1) return null;
    return t;
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
  function seriesComputed(fn) {
    const out = [];
    for (const c of _cycles) {
      const t = getTime(c);
      const y = fn(c);
      if (t != null && y != null && isFinite(y)) out.push({ x: t, y });
    }
    return out;
  }

  // === Régression linéaire ===
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
    return { slope, intercept, err: Math.sqrt(err / n), n };
  }

  // === V-slope segmenté (VT1) ===
  function detectVT1_Vslope() {
    const pts = [];
    for (const c of _cycles) {
      const t = getTime(c), v2 = getVO2(c), vc = getVCO2(c);
      if (t != null && v2 != null && vc != null && v2 > 200) pts.push({ t, v2, vc });
    }
    if (pts.length < 12) return null;
    let bestErr = Infinity, bestIdx = -1;
    const minSeg = Math.max(5, Math.floor(pts.length * 0.15));
    for (let i = minSeg; i < pts.length - minSeg; i++) {
      const r1 = lineReg(pts.slice(0, i), p => p.v2, p => p.vc);
      const r2 = lineReg(pts.slice(i),   p => p.v2, p => p.vc);
      if (!r1 || !r2) continue;
      if (r1.slope < r2.slope - 0.05 && r1.slope < 1.05) {
        const err = r1.err + r2.err;
        if (err < bestErr) { bestErr = err; bestIdx = i; }
      }
    }
    return bestIdx >= 0 ? pts[bestIdx].t : null;
  }

  // === Point d'inflexion VE/VCO2 (VT2 / RCP) ===
  function detectVT2_VeVco2() {
    const pts = [];
    for (const c of _cycles) {
      const t = getTime(c);
      let r = getVEVCO2(c);
      if (r == null) {
        const ve = getVEEffective(c), vco2 = getVCO2(c);
        if (ve != null && vco2 != null && vco2 > 0) r = ve / (vco2 / 1000);
      }
      if (t != null && r != null && isFinite(r)) pts.push({ t, r });
    }
    if (pts.length < 12) return null;
    const sm = pts.map((p, i) => {
      const w = pts.slice(Math.max(0, i - 2), i + 3);
      return { t: p.t, r: w.reduce((a, x) => a + x.r, 0) / w.length };
    });
    let minIdx = -1, minR = Infinity;
    for (let i = Math.floor(sm.length / 3); i < sm.length - 5; i++) {
      if (sm[i].r < minR) { minR = sm[i].r; minIdx = i; }
    }
    return minIdx >= 0 ? sm[minIdx].t : null;
  }

  // === Plateau VO₂ en RAMPE — analyse VO₂ vs Puissance ===
  // Critère 1 (relatif) : pente_dernière_min < 50% × pente_référence_VT1→fin-60s
  // Critère 2 (Taylor)  : ΔVO₂ sur la dernière minute < 150 mL/min
  function detectPlateauRamp() {
    const info = { plateau: false, ref_slope: null, final_slope: null, ratio: null, delta_vo2: null, criterion: null };
    const pts = [];
    for (const c of _cycles) {
      const t = getTime(c), vo2 = getVO2(c), pwr = getPower(c);
      if (t != null && vo2 != null && pwr != null && pwr > 5) pts.push({ t, vo2, p: pwr });
    }
    if (pts.length < 20) return info;
    pts.sort((a, b) => a.t - b.t);
    const tEnd = pts[pts.length - 1].t;
    const sv1 = _cursors.sv1_t || pts[Math.floor(pts.length * 0.3)].t;

    const ref = pts.filter(p => p.t >= sv1 && p.t <= tEnd - 60);
    const fin = pts.filter(p => p.t > tEnd - 60);
    if (ref.length < 5 || fin.length < 3) return info;

    const r1 = lineReg(ref, p => p.p, p => p.vo2);
    const r2 = lineReg(fin, p => p.p, p => p.vo2);
    if (!r1 || !r2) return info;

    info.ref_slope = r1.slope;
    info.final_slope = r2.slope;
    info.ratio = r2.slope / r1.slope;

    // ΔVO₂ entre VO2 il y a 60s et VO2 actuelle (lissés)
    const lastWin = fin.map(p => p.vo2);
    const prevWin = pts.filter(p => p.t > tEnd - 120 && p.t <= tEnd - 60).map(p => p.vo2);
    if (lastWin.length && prevWin.length) {
      const mLast = lastWin.reduce((a, b) => a + b, 0) / lastWin.length;
      const mPrev = prevWin.reduce((a, b) => a + b, 0) / prevWin.length;
      info.delta_vo2 = mLast - mPrev;
    }

    const c1 = info.ratio != null && info.ratio < 0.5;
    const c2 = info.delta_vo2 != null && info.delta_vo2 < 150;
    info.plateau = c1 || c2;
    info.criterion = c1 ? 'pente relative < 50%' : (c2 ? 'ΔVO₂ < 150 mL/min (Taylor)' : 'aucun critère atteint');
    return info;
  }

  function guessVO2max() {
    const vo2s = seriesComputed(getVO2);
    if (!vo2s.length) return lastTime();
    let best = null, tBest = lastTime();
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
      if (_exam.exam_type !== 'cpet') { alert('Aperçu graphique disponible uniquement pour CPET.'); return; }
      _cycles = (_exam.parsed_full && _exam.parsed_full.cycles) || [];
      if (!_cycles.length) { alert('Pas de cycles dans ce fichier CPET.'); return; }
      buildKeyMap();
      console.log('[CPET] keyMap', _keyMap);
      console.log('[CPET] sample', _cycles[0]);

      const cfg = _exam.graph_config || {};
      const s = _exam.parsed_summary || {};
      const tmax = lastTime();

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
      _plateauInfo = detectPlateauRamp();
      _vo2Manual = {
        status: cfg.vo2_status || (_plateauInfo.plateau ? 'max' : 'peak'),
        has_plateau: cfg.has_plateau != null ? cfg.has_plateau : _plateauInfo.plateau
      };

      buildModal();
      switchTab('wasserman');
      recompute();
    } catch (e) {
      console.error(e);
      alert('Erreur : ' + e.message);
    }
  };

  // ============================================================
  // === Mini-helper : un slider sous un graphe =================
  // ============================================================
  function sliderInline(label, color, idSl, idVal, val, max, hint) {
    return `
      <div style="margin-top:8px; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px;">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
          <label style="font-size:11px; color:#475569; font-weight:600; min-width:130px;">${label}</label>
          <input type="range" id="${idSl}" min="0" max="${max}" step="1" value="${val}" style="flex:1; min-width:200px; accent-color:${color};">
          <span id="${idVal}" style="font-weight:700; color:${color}; min-width:50px; text-align:right;">${val}s</span>
        </div>
        ${hint ? `<div style="font-size:10.5px; color:#64748b; margin-top:3px;">${hint}</div>` : ''}
      </div>`;
  }

  function buildModal() {
    const old = document.getElementById('cpetGraphPreviewModal');
    if (old) old.remove();
    const isVal = _exam.status === 'validated' || _exam.status === 'modified_after_validation';
    const tmax = Math.ceil(lastTime());

    const html = `
    <div id="cpetGraphPreviewModal" style="position:fixed; inset:0; background:rgba(11,21,48,0.92); z-index:10010; display:flex; flex-direction:column; padding:14px; overflow:hidden;">
      <div style="background:white; border-radius:12px 12px 0 0; padding:14px 22px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0;">
        <div>
          <h3 style="margin:0; color:#0b1530; font-size:18px;">📊 Aperçu graphique CPET — Examen #${_exam.id}</h3>
          <p style="margin:3px 0 0; font-size:12px; color:#64748b;">
            Patient ${_exam.patient_id}${_exam.exam_date ? ' · ' + new Date(_exam.exam_date).toLocaleDateString('fr-FR') : ''}
            · ${_cycles.length} cycles · durée ${Math.round(tmax/60)}min ${tmax%60}s
            · ${isVal ? '<span style="color:#16a34a; font-weight:600;">✓ Validé</span>' : '<span style="color:#d97706; font-weight:600;">⏳ Non validé</span>'}
          </p>
        </div>
        <div style="display:flex; gap:8px;">
          <button onclick="window.__cpetGraphAutoDetect()" style="border:1px solid #c084fc; background:white; color:#7c3aed; padding:7px 12px; border-radius:8px; font-weight:600; cursor:pointer; font-size:12px;" title="Détecter SV1 (V-slope) + SV2 (VE/VCO₂) + plateau VO₂">🎯 Auto-détecter</button>
          <button onclick="window.__closeCpetGraphPreview()" style="border:none; background:#f1f5f9; color:#475569; padding:8px 16px; border-radius:8px; font-weight:600; cursor:pointer; font-size:13px;">✕ Fermer</button>
        </div>
      </div>

      <div style="background:#f8fafc; padding:10px 22px; border-bottom:1px solid #e2e8f0; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="cpetGraphTab" data-tab="wasserman" onclick="window.__cpetGraphSwitchTab('wasserman')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">🫁 Équivalents + Pet + V-slope</button>
        <button class="cpetGraphTab" data-tab="vo2max" onclick="window.__cpetGraphSwitchTab('vo2max')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">📈 VO₂ max / Plateau (rampe) / OUES</button>
        <button class="cpetGraphTab" data-tab="energy" onclick="window.__cpetGraphSwitchTab('energy')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">⚡ Dépense énergétique (Weir)</button>
        <button class="cpetGraphTab" data-tab="cost" onclick="window.__cpetGraphSwitchTab('cost')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">💰 Coût énergétique</button>
      </div>

      <div style="flex:1; display:grid; grid-template-columns: 1fr 340px; gap:0; background:white; overflow:hidden;">
        <div id="cpetGraphArea" style="overflow-y:auto; padding:14px 18px; background:#fafbfd;">

          <!-- ========== Wasserman ========== -->
          <div class="cpetGraphTabPanel" data-tab="wasserman" style="display:none;">
            <div class="gp-card">
              <div class="gp-title">Équivalents ventilatoires — VE/VO₂ (bleu, SV1) & VE/VCO₂ (rouge, SV2)</div>
              <div style="height:280px;"><canvas id="gpChartEquiv"></canvas></div>
              <div style="font-size:11px; color:#64748b; margin-top:4px;">
                <strong>SV1</strong> = point où <span style="color:${C_O2}">VE/VO₂</span> remonte alors que VE/VCO₂ reste stable.
                <strong>SV2</strong> = point où <span style="color:${C_CO2}">VE/VCO₂</span> remonte après être resté stable/descendant.
              </div>
              ${sliderInline('🔵 Curseur SV1 (O₂)', C_SV1, 'gpSlSV1', 'gpValSV1', _cursors.sv1_t, tmax)}
              ${sliderInline('🔴 Curseur SV2 (CO₂)', C_SV2, 'gpSlSV2', 'gpValSV2', _cursors.sv2_t, tmax)}
            </div>

            <div class="gp-card" style="margin-top:14px;">
              <div class="gp-title" style="color:${C_O2};">PetO₂ (mmHg) — augmente à SV1</div>
              <div style="height:220px;"><canvas id="gpChartPetO2"></canvas></div>
              ${sliderInline('🔵 Curseur SV1 sur PetO₂', C_SV1, 'gpSlSV1b', 'gpValSV1b', _cursors.sv1_t, tmax)}
            </div>

            <div class="gp-card" style="margin-top:14px;">
              <div class="gp-title" style="color:${C_CO2};">PetCO₂ (mmHg) — chute à SV2</div>
              <div style="height:220px;"><canvas id="gpChartPetCO2"></canvas></div>
              ${sliderInline('🔴 Curseur SV2 sur PetCO₂', C_SV2, 'gpSlSV2b', 'gpValSV2b', _cursors.sv2_t, tmax)}
            </div>

            <div class="gp-card" style="margin-top:14px;">
              <div class="gp-title">V-slope (VCO₂ vs VO₂) — méthode Beaver pour VT1</div>
              <div style="height:260px;"><canvas id="gpChartVslope"></canvas></div>
              <div style="font-size:11px; color:#64748b; margin-top:4px;">Point d'inflexion : pente a₁&lt;1 → a₂&gt;1 (rupture). Ligne pointillée = identité y=x.</div>
            </div>
          </div>

          <!-- ========== VO2max / Plateau ========== -->
          <div class="cpetGraphTabPanel" data-tab="vo2max" style="display:none;">
            <div class="gp-card">
              <div class="gp-title" style="color:${C_O2};">VO₂ en fonction de la PUISSANCE — détection du plateau en rampe</div>
              <div style="height:300px;"><canvas id="gpChartVO2Power"></canvas></div>
              <div id="gpPlateauReport" style="margin-top:6px; padding:8px 10px; background:#f1f5f9; border-radius:7px; font-size:11.5px; color:#0b1530;"></div>
              ${sliderInline('🟢 Curseur VO₂ retenue', C_VO2MAX, 'gpSlVO2max', 'gpValVO2max', _cursors.vo2max_t, tmax, 'Le curseur définit la VO₂ retenue (moyenne ±7.5s).')}
            </div>

            <div class="gp-card" style="margin-top:14px;">
              <div class="gp-title" style="color:${C_O2};">VO₂ en fonction du temps (vue complémentaire)</div>
              <div style="height:240px;"><canvas id="gpChartVO2"></canvas></div>
              ${sliderInline('🟢 Curseur VO₂ retenue', C_VO2MAX, 'gpSlVO2maxB', 'gpValVO2maxB', _cursors.vo2max_t, tmax)}
            </div>

            <div class="gp-card" style="margin-top:14px;">
              <div class="gp-title">OUES — VO₂ vs log₁₀(VE)</div>
              <div style="height:240px;"><canvas id="gpChartOUES"></canvas></div>
              <div style="font-size:11px; color:#64748b; margin-top:4px;">Régression linéaire ; la pente est l'OUES. Plus elle est forte, meilleure est l'efficacité.</div>
            </div>

            <div style="margin-top:12px; padding:12px; background:white; border:1px solid #e2e8f0; border-radius:10px;">
              <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
                <div>
                  <label style="font-size:11px; color:#475569; display:block; font-weight:600;">Statut VO₂</label>
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

          <!-- ========== Énergie ========== -->
          <div class="cpetGraphTabPanel" data-tab="energy" style="display:none;">
            <div class="gp-card">
              <div class="gp-title">EE instantanée — Weir : 3.9·VO₂(L/min) + 1.1·VCO₂(L/min) (kcal/min)</div>
              <div style="height:260px;"><canvas id="gpChartEEInst"></canvas></div>
              ${sliderInline('Début zone analyse', C_ZONE, 'gpSlEnStart', 'gpValEnStart', _zones.energy_start, tmax)}
              ${sliderInline('Fin zone analyse', C_ZONE, 'gpSlEnEnd', 'gpValEnEnd', _zones.energy_end, tmax)}
            </div>
            <div class="gp-card" style="margin-top:14px;">
              <div class="gp-title">EE cumulée pendant l'effort (kcal)</div>
              <div style="height:220px;"><canvas id="gpChartEECum"></canvas></div>
            </div>
            <div class="gp-card" style="margin-top:14px;">
              <div class="gp-title">Contributions substrats : %Glu = (RER-0.7)/0.3 × 100</div>
              <div style="height:200px;"><canvas id="gpChartSubst"></canvas></div>
            </div>
          </div>

          <!-- ========== Coût ========== -->
          <div class="cpetGraphTabPanel" data-tab="cost" style="display:none;">
            <div class="gp-card">
              <div class="gp-title">Coût énergétique instantané (mLO₂/W·min)</div>
              <div style="height:260px;"><canvas id="gpChartCost"></canvas></div>
              ${sliderInline('Début zone stable', C_ZONE, 'gpSlCostStart', 'gpValCostStart', _zones.cost_start, tmax)}
              ${sliderInline('Fin zone stable', C_ZONE, 'gpSlCostEnd', 'gpValCostEnd', _zones.cost_end, tmax)}
              <div style="font-size:11px; color:#64748b; margin-top:4px;">Cible : zone d'état stable (excluez les premières minutes et la fin du test).</div>
            </div>
            <div class="gp-card" style="margin-top:14px;">
              <div class="gp-title">Coût en fonction de la puissance</div>
              <div style="height:220px;"><canvas id="gpChartCostPwr"></canvas></div>
            </div>
          </div>

        </div>

        <div style="background:white; border-left:1px solid #e2e8f0; overflow-y:auto; padding:16px;">
          <h4 style="margin:0 0 10px; color:#0b1530; font-size:14px;">📋 Valeurs retenues</h4>
          <div id="gpPanel" style="font-size:12px;"></div>
          <h4 style="margin:16px 0 8px; color:#0b1530; font-size:13px;">💬 Commentaires</h4>
          <textarea id="gpComments" placeholder="Notes cliniques, ajustements..." style="width:100%; min-height:80px; border:1px solid #cbd5e1; border-radius:7px; padding:8px; font-size:12px; font-family:inherit; resize:vertical;">${_exam.notes || ''}</textarea>
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

    // === Synchroniser tous les sliders qui partagent une même cible ===
    function bindSyncSliders(targetIds, valIds, onChange) {
      const els = targetIds.map(id => document.getElementById(id)).filter(Boolean);
      const vels = valIds.map(id => document.getElementById(id)).filter(Boolean);
      els.forEach((sl, idx) => {
        sl.addEventListener('input', () => {
          const x = parseInt(sl.value, 10);
          els.forEach(e => { if (e !== sl) e.value = x; });
          vels.forEach(v => v.textContent = x + 's');
          onChange(x);
        });
      });
    }
    bindSyncSliders(['gpSlSV1', 'gpSlSV1b'], ['gpValSV1', 'gpValSV1b'], v => { _cursors.sv1_t = v; recompute(); });
    bindSyncSliders(['gpSlSV2', 'gpSlSV2b'], ['gpValSV2', 'gpValSV2b'], v => { _cursors.sv2_t = v; recompute(); });
    bindSyncSliders(['gpSlVO2max', 'gpSlVO2maxB'], ['gpValVO2max', 'gpValVO2maxB'], v => { _cursors.vo2max_t = v; recompute(); });
    bindSyncSliders(['gpSlEnStart'], ['gpValEnStart'], v => { _zones.energy_start = v; recompute(); });
    bindSyncSliders(['gpSlEnEnd'], ['gpValEnEnd'], v => { _zones.energy_end = v; recompute(); });
    bindSyncSliders(['gpSlCostStart'], ['gpValCostStart'], v => { _zones.cost_start = v; recompute(); });
    bindSyncSliders(['gpSlCostEnd'], ['gpValCostEnd'], v => { _zones.cost_end = v; recompute(); });

    const sel = document.getElementById('gpVO2Status');
    if (sel) { sel.value = _vo2Manual.status || 'peak'; sel.addEventListener('change', () => { _vo2Manual.status = sel.value; recompute(); }); }
    const cb = document.getElementById('gpHasPlateau');
    if (cb) cb.addEventListener('change', () => { _vo2Manual.has_plateau = cb.checked; recompute(); });
  }

  // ============================================================
  // === Switch onglet ==========================================
  // ============================================================
  function switchTab(tabName) {
    document.querySelectorAll('.cpetGraphTab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    document.querySelectorAll('.cpetGraphTabPanel').forEach(p => p.style.display = p.dataset.tab === tabName ? 'block' : 'none');
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
  function baseOpts(titleY, xLabel = 'Temps (s)', showLeg = false) {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: showLeg, labels: { font: { size: 11 } } },
        tooltip: { callbacks: { title: ctx => xLabel.split(' ')[0] + ' = ' + Math.round(ctx[0].parsed.x) } },
        verticalCursors: { cursors: [] }
      },
      scales: {
        x: { type: 'linear', title: { display: true, text: xLabel, font: { size: 11 } }, ticks: { font: { size: 10 } } },
        y: { title: { display: true, text: titleY, font: { size: 11 } }, ticks: { font: { size: 10 } } }
      }
    };
  }

  function buildWassermanCharts() {
    // === Graphe Wasserman fusionné : VE/VO2 (bleu) + VE/VCO2 (rouge) ===
    const veVo2 = seriesComputed(c => {
      const d = getVEVO2(c);
      if (d != null) return d;
      const ve = getVEEffective(c), vo2 = getVO2(c);
      if (ve != null && vo2 != null && vo2 > 0) return ve / (vo2 / 1000);
      return null;
    });
    const veVco2 = seriesComputed(c => {
      const d = getVEVCO2(c);
      if (d != null) return d;
      const ve = getVEEffective(c), vco2 = getVCO2(c);
      if (ve != null && vco2 != null && vco2 > 0) return ve / (vco2 / 1000);
      return null;
    });
    const elE = document.getElementById('gpChartEquiv');
    if (elE) {
      _charts.equiv = new Chart(elE.getContext('2d'), {
        type: 'line',
        data: { datasets: [
          { label: 'VE/VO₂ (O₂)',  data: veVo2,  borderColor: C_O2,  backgroundColor: C_O2 + '11',  borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false },
          { label: 'VE/VCO₂ (CO₂)', data: veVco2, borderColor: C_CO2, backgroundColor: C_CO2 + '11', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: false }
        ] },
        options: baseOpts('Équivalent ventilatoire', 'Temps (s)', true)
      });
    }

    // === PetO2 (bleu) + PetCO2 (rouge) ===
    const petO2 = seriesComputed(getPetO2);
    const petCO2 = seriesComputed(getPetCO2);
    _charts.petO2  = mkChart('gpChartPetO2',  petO2,  'PetO₂ (mmHg)',  C_O2,  'PetO₂');
    _charts.petCO2 = mkChart('gpChartPetCO2', petCO2, 'PetCO₂ (mmHg)', C_CO2, 'PetCO₂');

    // === V-slope ===
    const vsl = [];
    for (const c of _cycles) {
      const vo2 = getVO2(c), vco2 = getVCO2(c);
      if (vo2 != null && vco2 != null && vo2 > 100) vsl.push({ x: vo2 / 1000, y: vco2 / 1000 });
    }
    vsl.sort((a, b) => a.x - b.x);
    const vslEl = document.getElementById('gpChartVslope');
    if (vslEl) {
      const xMax = vsl.length ? Math.max(...vsl.map(p => p.x)) : 1;
      const identity = [{ x: 0, y: 0 }, { x: xMax, y: xMax }];
      _charts.vslope = new Chart(vslEl.getContext('2d'), {
        type: 'line',
        data: { datasets: [
          { label: 'V-slope (VCO₂ vs VO₂)', data: vsl, borderColor: C_CO2, backgroundColor: C_CO2 + '22', borderWidth: 2, pointRadius: 1.2, tension: 0, fill: false, showLine: true },
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
    // === VO2 vs Puissance avec pentes ref + finale ===
    const vo2pwr = [];
    for (const c of _cycles) {
      const v = getVO2(c), p = getPower(c), t = getTime(c);
      if (v != null && p != null && p > 0 && t != null) vo2pwr.push({ x: p, y: v, t });
    }
    vo2pwr.sort((a, b) => a.t - b.t);
    const elP = document.getElementById('gpChartVO2Power');
    if (elP && vo2pwr.length) {
      const datasets = [
        { label: 'VO₂ vs P', data: vo2pwr.map(d => ({ x: d.x, y: d.y })), borderColor: C_O2, backgroundColor: C_O2 + '22', borderWidth: 2, pointRadius: 1.2, tension: 0.1, fill: true, showLine: true }
      ];
      // Ajoute les régressions ref + finale
      if (_plateauInfo.ref_slope != null) {
        const tEnd = vo2pwr[vo2pwr.length - 1].t;
        const ref = vo2pwr.filter(d => d.t >= _cursors.sv1_t && d.t <= tEnd - 60);
        const fin = vo2pwr.filter(d => d.t > tEnd - 60);
        if (ref.length > 2 && fin.length > 1) {
          const xR0 = Math.min(...ref.map(d => d.x)), xR1 = Math.max(...ref.map(d => d.x));
          const xF0 = Math.min(...fin.map(d => d.x)), xF1 = Math.max(...fin.map(d => d.x));
          const r1 = lineReg(ref, d => d.x, d => d.y);
          const r2 = lineReg(fin, d => d.x, d => d.y);
          if (r1) datasets.push({ label: 'Pente référence (VT1→fin-60s)', data: [{ x: xR0, y: r1.slope * xR0 + r1.intercept }, { x: xR1, y: r1.slope * xR1 + r1.intercept }], borderColor: '#16a34a', borderWidth: 2.5, borderDash: [], pointRadius: 0, fill: false, showLine: true });
          if (r2) datasets.push({ label: 'Pente dernière minute', data: [{ x: xF0, y: r2.slope * xF0 + r2.intercept }, { x: xF1, y: r2.slope * xF1 + r2.intercept }], borderColor: '#dc2626', borderWidth: 2.5, borderDash: [6, 4], pointRadius: 0, fill: false, showLine: true });
        }
      }
      _charts.vo2pwr = new Chart(elP.getContext('2d'), {
        type: 'line',
        data: { datasets },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: true, labels: { font: { size: 10 } } } },
          scales: {
            x: { type: 'linear', title: { display: true, text: 'Puissance (W)', font: { size: 11 } } },
            y: { title: { display: true, text: 'VO₂ (mL/min)', font: { size: 11 } } }
          }
        }
      });
    }

    // === VO2/temps ===
    const vo2 = seriesComputed(getVO2);
    _charts.vo2 = mkChart('gpChartVO2', vo2, 'VO₂ (mL/min)', C_O2, 'VO₂');

    // === OUES ===
    const oues = [];
    for (const c of _cycles) {
      const ve = getVEEffective(c), v2 = getVO2(c);
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
          { label: 'VO₂ vs log₁₀(VE)', data: oues, borderColor: C_O2, backgroundColor: C_O2 + '33', borderWidth: 1, pointRadius: 1.5, fill: false, showLine: false },
          { label: 'Régression — OUES = ' + (reg ? Math.round(reg.slope) : '?'), data: regLine, borderColor: '#dc2626', borderWidth: 2, pointRadius: 0, fill: false, showLine: true }
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
    const eeInst = seriesComputed(c => {
      const vo2 = getVO2(c), vco2 = getVCO2(c);
      if (vo2 == null) return null;
      const vco2Lmin = (vco2 != null ? vco2 : vo2 * 0.9) / 1000;
      return 3.9 * (vo2 / 1000) + 1.1 * vco2Lmin;
    });
    const eeCum = [];
    let cum = 0, lastT = null;
    for (const p of eeInst) {
      if (lastT != null) cum += p.y * ((p.x - lastT) / 60);
      eeCum.push({ x: p.x, y: cum });
      lastT = p.x;
    }
    _charts.eeInst = mkChart('gpChartEEInst', eeInst, 'EE (kcal/min)', '#059669', 'EE inst');
    _charts.eeCum  = mkChart('gpChartEECum',  eeCum,  'EE cumulée (kcal)', '#10b981', 'EE cum');

    const glu = [], lip = [];
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
          { label: '% Lipides',  data: lip, borderColor: C_O2, backgroundColor: C_O2 + '22', borderWidth: 2, pointRadius: 0, tension: 0.3, fill: false }
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
    const cost = seriesComputed(c => {
      const vo2 = getVO2(c), pwr = getPower(c);
      if (vo2 != null && pwr != null && pwr > 20) return vo2 / pwr;
      return null;
    });
    _charts.cost = mkChart('gpChartCost', cost, 'Coût (mLO₂/W·min)', C_ZONE, 'Coût');

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
        data: { datasets: [{ label: 'Coût vs P', data: costPwr, borderColor: C_ZONE, backgroundColor: '#fef3c7', borderWidth: 2, pointRadius: 1.2, tension: 0.1, fill: true, showLine: true }] },
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

  function mkChart(canvasId, data, yLabel, color, lineLabel) {
    const el = document.getElementById(canvasId);
    if (!el) return null;
    return new Chart(el.getContext('2d'), {
      type: 'line',
      data: { datasets: [{ label: lineLabel, data, borderColor: color, backgroundColor: color + '22', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true }] },
      options: baseOpts(yLabel)
    });
  }

  // ============================================================
  // === Mise à jour des curseurs ===============================
  // ============================================================
  function updateCursorsOnCharts() {
    const setC = (chart, cursors) => {
      if (!chart) return;
      if (!chart.options.plugins) chart.options.plugins = {};
      chart.options.plugins.verticalCursors = { cursors };
      chart.update('none');
    };
    const sv1 = { value: _cursors.sv1_t, color: C_SV1, label: 'SV1' };
    const sv2 = { value: _cursors.sv2_t, color: C_SV2, label: 'SV2' };
    const v2m = { value: _cursors.vo2max_t, color: C_VO2MAX, label: 'VO₂max' };
    const enS = { value: _zones.energy_start, color: C_ZONE, label: 'début' };
    const enE = { value: _zones.energy_end, color: C_ZONE, label: 'fin' };
    const csS = { value: _zones.cost_start, color: C_ZONE, label: 'début' };
    const csE = { value: _zones.cost_end, color: C_ZONE, label: 'fin' };
    setC(_charts.equiv,  [sv1, sv2]);
    setC(_charts.petO2,  [sv1]);
    setC(_charts.petCO2, [sv2]);
    setC(_charts.vo2,    [v2m, sv1, sv2]);
    setC(_charts.eeInst, [enS, enE]);
    setC(_charts.eeCum,  [enS, enE]);
    setC(_charts.subst,  [sv1, sv2]);
    setC(_charts.cost,   [csS, csE]);
  }

  // ============================================================
  // === Recompute ===============================================
  // ============================================================
  function recompute() {
    updateCursorsOnCharts();
    const c1 = nearestCycle(_cursors.sv1_t) || {};
    const c2 = nearestCycle(_cursors.sv2_t) || {};
    const cMax = nearestCycle(_cursors.vo2max_t) || {};
    const w = num(_exam.parsed_summary?.weight_kg) || null;
    const fmt = (v, n = 1) => v == null ? '—' : (Math.round(v * 10**n) / 10**n).toString();

    // EE Weir
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
    const costVals = [];
    for (const c of _cycles) {
      const t = getTime(c);
      if (t == null || t < _zones.cost_start || t > _zones.cost_end) continue;
      const vo2 = getVO2(c), pwr = getPower(c);
      if (vo2 != null && pwr != null && pwr > 20) costVals.push(vo2 / pwr);
    }
    const costAvg = costVals.length ? costVals.reduce((a, b) => a + b, 0) / costVals.length : null;

    // VO2 retenue lissée ±7.5s
    const win = _cycles.filter(c => {
      const t = getTime(c);
      return t != null && t >= _cursors.vo2max_t - 7.5 && t <= _cursors.vo2max_t + 7.5;
    });
    const vos = win.map(getVO2).filter(v => v != null);
    const vo2Ret = vos.length ? vos.reduce((a, b) => a + b, 0) / vos.length : getVO2(cMax);
    const vo2KgRet = w && vo2Ret ? vo2Ret / w : getVO2Kg(cMax);

    let rerMax = null, hrMax = null, pwrMax = null;
    for (const c of _cycles) {
      const r = getRER(c), h = getHR(c), p = getPower(c);
      if (r != null && (rerMax == null || r > rerMax)) rerMax = r;
      if (h != null && (hrMax == null || h > hrMax)) hrMax = h;
      if (p != null && (pwrMax == null || p > pwrMax)) pwrMax = p;
    }

    // VE/VCO2 slope (régression jusqu'à SV2)
    const ptsVe = [];
    for (const c of _cycles) {
      const t = getTime(c);
      if (t == null || t > _cursors.sv2_t) continue;
      const ve = getVEEffective(c), vco2 = getVCO2(c);
      if (ve != null && vco2 != null && vco2 > 0) ptsVe.push({ x: vco2 / 1000, y: ve });
    }
    const regVe = lineReg(ptsVe, p => p.x, p => p.y);
    const veVco2Slope = regVe ? regVe.slope : null;

    // OUES
    const ptsO = [];
    for (const c of _cycles) {
      const ve = getVEEffective(c), v2 = getVO2(c);
      if (ve != null && ve > 1 && v2 != null) ptsO.push({ x: Math.log10(ve), y: v2 });
    }
    const regO = lineReg(ptsO, p => p.x, p => p.y);
    const oues = regO ? regO.slope : null;

    // Recalcule plateau si sv1 a changé (impact sur la pente référence)
    _plateauInfo = detectPlateauRamp();

    // Cache pour sauvegarde
    window._cpetRecalc = {
      sv1_t: _cursors.sv1_t,
      sv1_vo2: getVO2(c1), sv1_hr: getHR(c1), sv1_power: getPower(c1),
      sv1_ve_vo2: getVEVO2(c1) ?? (getVEEffective(c1) && getVO2(c1) ? getVEEffective(c1) / (getVO2(c1) / 1000) : null),
      sv1_ve_vco2: getVEVCO2(c1) ?? (getVEEffective(c1) && getVCO2(c1) ? getVEEffective(c1) / (getVCO2(c1) / 1000) : null),
      sv1_petO2: getPetO2(c1), sv1_petCO2: getPetCO2(c1), sv1_rer: getRER(c1),
      sv2_t: _cursors.sv2_t,
      sv2_vo2: getVO2(c2), sv2_hr: getHR(c2), sv2_power: getPower(c2),
      sv2_ve_vo2: getVEVO2(c2) ?? (getVEEffective(c2) && getVO2(c2) ? getVEEffective(c2) / (getVO2(c2) / 1000) : null),
      sv2_ve_vco2: getVEVCO2(c2) ?? (getVEEffective(c2) && getVCO2(c2) ? getVEEffective(c2) / (getVCO2(c2) / 1000) : null),
      sv2_petO2: getPetO2(c2), sv2_petCO2: getPetCO2(c2), sv2_rer: getRER(c2),
      vo2_retained_ml_min: vo2Ret, vo2_retained_ml_kg_min: vo2KgRet,
      vo2_status: _vo2Manual.status, has_plateau: _vo2Manual.has_plateau,
      plateau_ref_slope: _plateauInfo.ref_slope, plateau_final_slope: _plateauInfo.final_slope,
      plateau_ratio: _plateauInfo.ratio, plateau_delta_vo2: _plateauInfo.delta_vo2, plateau_criterion: _plateauInfo.criterion,
      hr_max: hrMax, power_max: pwrMax, rer_max: rerMax,
      ve_vco2_slope: veVco2Slope, oues,
      energy_zone_kcal: eeZone, cost_avg: costAvg
    };

    // Maj panneau
    const html = `
      <div class="grp-title">SV1 / VT1 (analyse O₂)</div>
      <div class="row"><span class="lab">Temps</span><span class="val">${fmt(_cursors.sv1_t, 0)} s</span></div>
      <div class="row"><span class="lab">VO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_vo2, 0)} mL/min</span></div>
      <div class="row"><span class="lab">FC</span><span class="val">${fmt(window._cpetRecalc.sv1_hr, 0)} bpm</span></div>
      <div class="row"><span class="lab">Puissance</span><span class="val">${fmt(window._cpetRecalc.sv1_power, 0)} W</span></div>
      <div class="row"><span class="lab" style="color:${C_O2};">VE/VO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_ve_vo2, 1)}</span></div>
      <div class="row"><span class="lab" style="color:${C_O2};">PetO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_petO2, 1)} mmHg</span></div>
      <div class="row"><span class="lab">RER</span><span class="val">${fmt(window._cpetRecalc.sv1_rer, 2)}</span></div>

      <div class="grp-title">SV2 / VT2 / RCP (analyse CO₂)</div>
      <div class="row"><span class="lab">Temps</span><span class="val">${fmt(_cursors.sv2_t, 0)} s</span></div>
      <div class="row"><span class="lab">VO₂</span><span class="val">${fmt(window._cpetRecalc.sv2_vo2, 0)} mL/min</span></div>
      <div class="row"><span class="lab">FC</span><span class="val">${fmt(window._cpetRecalc.sv2_hr, 0)} bpm</span></div>
      <div class="row"><span class="lab">Puissance</span><span class="val">${fmt(window._cpetRecalc.sv2_power, 0)} W</span></div>
      <div class="row"><span class="lab" style="color:${C_CO2};">VE/VCO₂</span><span class="val">${fmt(window._cpetRecalc.sv2_ve_vco2, 1)}</span></div>
      <div class="row"><span class="lab" style="color:${C_CO2};">PetCO₂</span><span class="val">${fmt(window._cpetRecalc.sv2_petCO2, 1)} mmHg</span></div>
      <div class="row"><span class="lab">RER</span><span class="val">${fmt(window._cpetRecalc.sv2_rer, 2)}</span></div>

      <div class="grp-title">VO₂ maximale</div>
      <div class="row"><span class="lab">Statut</span><span class="val">${{max:'VO₂ max',peak:'VO₂ peak',submaximal:'Non maximal',uninterpretable:'Ininterprétable'}[_vo2Manual.status] || _vo2Manual.status}</span></div>
      <div class="row"><span class="lab">Plateau (rampe)</span><span class="val">${_vo2Manual.has_plateau ? '✓ Observé' : '✗ Absent'}</span></div>
      <div class="row"><span class="lab">Pente réf VO₂/W</span><span class="val">${fmt(_plateauInfo.ref_slope, 1)} mL/W</span></div>
      <div class="row"><span class="lab">Pente finale VO₂/W</span><span class="val">${fmt(_plateauInfo.final_slope, 1)} mL/W</span></div>
      <div class="row"><span class="lab">Ratio finale/réf</span><span class="val">${fmt(_plateauInfo.ratio, 2)}</span></div>
      <div class="row"><span class="lab">ΔVO₂ dernière min</span><span class="val">${fmt(_plateauInfo.delta_vo2, 0)} mL/min</span></div>
      <div class="row"><span class="lab">VO₂ retenue</span><span class="val">${fmt(vo2Ret, 0)} mL/min</span></div>
      <div class="row"><span class="lab">VO₂/Kg</span><span class="val">${fmt(vo2KgRet, 1)} mL/kg/min</span></div>
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

    // Rapport plateau sous le graphe VO2/Power
    const rep = document.getElementById('gpPlateauReport');
    if (rep) {
      const sym = _plateauInfo.plateau ? '✓' : '✗';
      const color = _plateauInfo.plateau ? '#16a34a' : '#dc2626';
      rep.innerHTML = `
        <strong style="color:${color};">${sym} Plateau ${_plateauInfo.plateau ? 'détecté' : 'non détecté'}</strong>
        — pente réf ${fmt(_plateauInfo.ref_slope, 1)} mL/W
        · pente finale ${fmt(_plateauInfo.final_slope, 1)} mL/W
        · ratio ${fmt(_plateauInfo.ratio, 2)} (critère &lt; 0.5)
        · ΔVO₂ ${fmt(_plateauInfo.delta_vo2, 0)} mL/min (critère &lt; 150 — Taylor)
        ${_plateauInfo.criterion ? '<br>Critère atteint : <em>' + _plateauInfo.criterion + '</em>' : ''}
      `;
    }
  }

  // ============================================================
  // === Auto-détection seuils + plateau ========================
  // ============================================================
  window.__cpetGraphAutoDetect = function () {
    const t1 = detectVT1_Vslope();
    const t2 = detectVT2_VeVco2();
    let msg = 'Auto-détection :\n';
    if (t1) { _cursors.sv1_t = clampT(Math.round(t1)); msg += `· VT1 (V-slope) : ${Math.round(t1)}s\n`; }
    else msg += '· VT1 : non détectable\n';
    if (t2) { _cursors.sv2_t = clampT(Math.round(t2)); msg += `· VT2 (VE/VCO₂) : ${Math.round(t2)}s\n`; }
    else msg += '· VT2 : non détectable\n';
    _cursors.vo2max_t = clampT(guessVO2max());
    _plateauInfo = detectPlateauRamp();
    _vo2Manual.has_plateau = _plateauInfo.plateau;
    _vo2Manual.status = _plateauInfo.plateau ? 'max' : 'peak';
    msg += `· Plateau rampe : ${_plateauInfo.plateau ? 'observé (' + _plateauInfo.criterion + ')' : 'absent'}\n`;
    // Sync sliders
    ['gpSlSV1', 'gpSlSV1b'].forEach(id => { const e = document.getElementById(id); if (e) e.value = _cursors.sv1_t; });
    ['gpSlSV2', 'gpSlSV2b'].forEach(id => { const e = document.getElementById(id); if (e) e.value = _cursors.sv2_t; });
    ['gpSlVO2max', 'gpSlVO2maxB'].forEach(id => { const e = document.getElementById(id); if (e) e.value = _cursors.vo2max_t; });
    ['gpValSV1', 'gpValSV1b'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = _cursors.sv1_t + 's'; });
    ['gpValSV2', 'gpValSV2b'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = _cursors.sv2_t + 's'; });
    ['gpValVO2max', 'gpValVO2maxB'].forEach(id => { const e = document.getElementById(id); if (e) e.textContent = _cursors.vo2max_t + 's'; });
    const cb = document.getElementById('gpHasPlateau'); if (cb) cb.checked = _vo2Manual.has_plateau;
    const sel = document.getElementById('gpVO2Status'); if (sel) sel.value = _vo2Manual.status;
    recompute();
    alert(msg);
  };

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
      plateau_info: _plateauInfo,
      saved_at: new Date().toISOString()
    };
    const validated = {
      ...(_exam.validated_data || _exam.parsed_summary || {}),
      sv1_t: r.sv1_t, sv1_vo2: r.sv1_vo2, sv1_hr: r.sv1_hr, sv1_power: r.sv1_power,
      sv2_t: r.sv2_t, sv2_vo2: r.sv2_vo2, sv2_hr: r.sv2_hr, sv2_power: r.sv2_power,
      vo2_max_ml_min: r.vo2_retained_ml_min, vo2_max_ml_kg_min: r.vo2_retained_ml_kg_min,
      hr_max: r.hr_max, power_max: r.power_max, rer_max: r.rer_max,
      ve_vco2_slope: r.ve_vco2_slope, oues: r.oues,
      vo2_status: r.vo2_status, has_plateau: r.has_plateau,
      plateau_ref_slope: r.plateau_ref_slope, plateau_final_slope: r.plateau_final_slope,
      energy_total_kcal: r.energy_zone_kcal, cost_avg_mlO2_W: r.cost_avg
    };
    const comments = (document.getElementById('gpComments') || {}).value || null;
    if (validate && !confirm('Valider définitivement cette analyse ?')) return;
    try {
      await window.MarfanAPI.medicalExams.saveGraphConfig(_exam.id, graphConfig, validated, !!validate, comments);
      alert(validate ? '✓ Analyse validée.' : '✓ Ajustements enregistrés.');
      window.__closeCpetGraphPreview();
      if (typeof window.loadMedicalExamsForCurrentPatient === 'function') {
        await window.loadMedicalExamsForCurrentPatient();
      }
    } catch (e) {
      alert('Échec sauvegarde : ' + e.message);
    }
  };

  window.__closeCpetGraphPreview = function () {
    const m = document.getElementById('cpetGraphPreviewModal');
    if (m) m.remove();
    Object.values(_charts).forEach(ch => { if (ch && ch.destroy) ch.destroy(); });
    _charts = {};
  };

})();
