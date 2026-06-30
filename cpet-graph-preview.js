/**
 * cpet-graph-preview.js — Aperçu graphique interactif d'un test CPET
 * ============================================================
 *
 * Module autonome qui s'expose en `window.openCpetGraphPreview(examId)`.
 *
 * Affiche dans une modale plein écran :
 *   1) Courbes de Wasserman (VE/VO2, VE/VCO2, PetO2, PetCO2) avec curseurs
 *      verticaux draggables SV1 et SV2.
 *   2) Graphique VO2/temps avec marqueur VO2max + détection plateau.
 *   3) Graphique dépense énergétique (instantanée + cumulée) avec zone.
 *   4) Graphique coût énergétique avec zone d'analyse.
 *
 * Panneau latéral : valeurs recalculées en temps réel.
 * Boutons : Enregistrer sans valider · Valider l'analyse · Retour.
 *
 * Dépendances : Chart.js 4.x (déjà chargé dans index.html)
 *               window.MarfanAPI (api-client.js)
 *
 * Persistance : positions des curseurs et valeurs recalculées sauvées via
 *               POST /api/medical-exams/:id/graph-config.
 * ============================================================ */

(function () {
  'use strict';

  // === Cache global pour stocker l'état courant de l'examen ouvert ===
  let _exam = null;          // examen complet
  let _cycles = [];          // cycles parsés
  let _charts = {};          // refs Chart.js par id de canvas
  let _cursors = {};         // positions courantes des curseurs (t en s)
  let _zones = {};           // zones énergie/coût
  let _vo2Manual = {};       // choix manuel VO2 max/peak/plateau

  // === Plugin Chart.js : dessine des lignes verticales draggables ===
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
        // Label
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

  // === Helpers ===
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const x = parseFloat(String(v).replace(',', '.'));
    return isFinite(x) ? x : null;
  }
  function timeSeconds(c) {
    const t = c.t ?? c.Time ?? c.time ?? c.T;
    if (t == null) return null;
    if (typeof t === 'number') return t > 100000 ? t / 1000 : t;  // déjà secondes ou ms
    if (typeof t === 'string') {
      // Format "HH:MM:SS" ou "MM:SS"
      const parts = t.split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return num(t);
    }
    if (t instanceof Date) return t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds();
    return null;
  }
  function getKey(c, ...candidates) {
    for (const k of candidates) {
      if (c[k] != null) return num(c[k]);
    }
    return null;
  }
  function nearestCycle(timeS) {
    let best = null, bestDiff = Infinity;
    for (const c of _cycles) {
      const t = timeSeconds(c);
      if (t == null) continue;
      const d = Math.abs(t - timeS);
      if (d < bestDiff) { bestDiff = d; best = c; }
    }
    return best;
  }

  // === Extraction série pour Chart.js ===
  function series(...keys) {
    const out = [];
    for (const c of _cycles) {
      const t = timeSeconds(c);
      const y = getKey(c, ...keys);
      if (t != null && y != null) out.push({ x: t, y });
    }
    return out;
  }
  function seriesComputed(fn) {
    const out = [];
    for (const c of _cycles) {
      const t = timeSeconds(c);
      const y = fn(c);
      if (t != null && y != null && isFinite(y)) out.push({ x: t, y });
    }
    return out;
  }

  // === Détection de plateau VO2 (variation < 150 ml/min sur 30s en fin de test) ===
  function detectPlateau() {
    const vo2Series = series('VO2');
    if (vo2Series.length < 5) return false;
    // Prend les 30 dernières secondes
    const tEnd = vo2Series[vo2Series.length - 1].x;
    const tail = vo2Series.filter(p => p.x >= tEnd - 30);
    if (tail.length < 3) return false;
    const vMax = Math.max(...tail.map(p => p.y));
    const vMin = Math.min(...tail.map(p => p.y));
    return (vMax - vMin) < 150;
  }

  // ============================================================
  // === Ouverture de la modale principale ======================
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
        alert('Aucune donnée cycle-par-cycle disponible pour cet examen.\nL\'aperçu graphique nécessite un fichier CPET avec cycles détaillés.');
        return;
      }
      // Init curseurs depuis graph_config (s'il existe) ou depuis parsed_summary
      const cfg = _exam.graph_config || {};
      const s = _exam.parsed_summary || {};
      _cursors = {
        sv1_t: cfg.cursor_sv1_t_s != null ? cfg.cursor_sv1_t_s : (num(s.sv1_t) || guessSV1()),
        sv2_t: cfg.cursor_sv2_t_s != null ? cfg.cursor_sv2_t_s : (num(s.sv2_t) || guessSV2()),
        vo2max_t: cfg.cursor_vo2max_t_s != null ? cfg.cursor_vo2max_t_s : guessVO2max()
      };
      _zones = {
        energy_start: cfg.energy_zone_start_s != null ? cfg.energy_zone_start_s : 0,
        energy_end:   cfg.energy_zone_end_s != null ? cfg.energy_zone_end_s : lastTime(),
        cost_start:   cfg.cost_zone_start_s != null ? cfg.cost_zone_start_s : 0,
        cost_end:     cfg.cost_zone_end_s != null ? cfg.cost_zone_end_s : lastTime()
      };
      _vo2Manual = {
        status: cfg.vo2_status || 'peak',
        has_plateau: cfg.has_plateau != null ? cfg.has_plateau : detectPlateau()
      };
      buildModal();
      // Tab par défaut
      switchTab('wasserman');
      recompute();
    } catch (e) {
      console.error(e);
      alert('Erreur ouverture aperçu graphique : ' + e.message);
    }
  };

  // === Heuristiques d'init des curseurs ===
  function lastTime() {
    for (let i = _cycles.length - 1; i >= 0; i--) {
      const t = timeSeconds(_cycles[i]);
      if (t != null) return t;
    }
    return 600;
  }
  function guessVO2max() {
    let best = null, tBest = lastTime();
    for (const c of _cycles) {
      const t = timeSeconds(c);
      const v = getKey(c, 'VO2');
      if (t != null && v != null && (best == null || v > best)) { best = v; tBest = t; }
    }
    return tBest;
  }
  function guessSV1() { return Math.round(lastTime() * 0.45); }
  function guessSV2() { return Math.round(lastTime() * 0.75); }

  // ============================================================
  // === Construction de la modale ==============================
  // ============================================================
  function buildModal() {
    // Supprime éventuelle modale précédente
    const old = document.getElementById('cpetGraphPreviewModal');
    if (old) old.remove();

    const s = _exam.parsed_summary || {};
    const isValidated = _exam.status === 'validated' || _exam.status === 'modified_after_validation';

    const html = `
    <div id="cpetGraphPreviewModal" style="position:fixed; inset:0; background:rgba(11,21,48,0.92); z-index:10010; display:flex; flex-direction:column; padding:14px; overflow:hidden;">
      <!-- Header -->
      <div style="background:white; border-radius:12px 12px 0 0; padding:14px 22px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0;">
        <div>
          <h3 style="margin:0; color:#0b1530; font-size:18px;">📊 Aperçu graphique CPET — Examen #${_exam.id}</h3>
          <p style="margin:3px 0 0; font-size:12px; color:#64748b;">
            Patient ${_exam.patient_id}
            ${_exam.exam_date ? ' · ' + new Date(_exam.exam_date).toLocaleDateString('fr-FR') : ''}
            · ${_cycles.length} cycles
            · ${isValidated ? '<span style="color:#16a34a; font-weight:600;">✓ Validé</span>' : '<span style="color:#d97706; font-weight:600;">⏳ Non validé</span>'}
          </p>
        </div>
        <button onclick="window.__closeCpetGraphPreview()" style="border:none; background:#f1f5f9; color:#475569; padding:8px 16px; border-radius:8px; font-weight:600; cursor:pointer; font-size:13px;">✕ Fermer</button>
      </div>

      <!-- Onglets -->
      <div style="background:#f8fafc; padding:10px 22px; border-bottom:1px solid #e2e8f0; display:flex; gap:8px; flex-wrap:wrap;">
        <button class="cpetGraphTab" data-tab="wasserman" onclick="window.__cpetGraphSwitchTab('wasserman')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">🫁 Wasserman (SV1/SV2)</button>
        <button class="cpetGraphTab" data-tab="vo2max" onclick="window.__cpetGraphSwitchTab('vo2max')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">📈 VO₂ max / Plateau</button>
        <button class="cpetGraphTab" data-tab="energy" onclick="window.__cpetGraphSwitchTab('energy')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">⚡ Dépense énergétique</button>
        <button class="cpetGraphTab" data-tab="cost" onclick="window.__cpetGraphSwitchTab('cost')" style="border:none; padding:8px 14px; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">💰 Coût énergétique</button>
      </div>

      <!-- Corps : graphes + panneau valeurs -->
      <div style="flex:1; display:grid; grid-template-columns: 1fr 320px; gap:0; background:white; overflow:hidden;">
        <!-- Zone graphes -->
        <div id="cpetGraphArea" style="overflow-y:auto; padding:14px 18px; background:#fafbfd;">
          <!-- Tab Wasserman -->
          <div class="cpetGraphTabPanel" data-tab="wasserman" style="display:none;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
              <div class="gp-card"><div class="gp-title">VE/VO₂ — Détection SV1</div><div style="height:240px;"><canvas id="gpChartVEVO2"></canvas></div></div>
              <div class="gp-card"><div class="gp-title">VE/VCO₂ — Détection SV2</div><div style="height:240px;"><canvas id="gpChartVEVCO2"></canvas></div></div>
              <div class="gp-card"><div class="gp-title">PetO₂ (mmHg)</div><div style="height:240px;"><canvas id="gpChartPetO2"></canvas></div></div>
              <div class="gp-card"><div class="gp-title">PetCO₂ (mmHg)</div><div style="height:240px;"><canvas id="gpChartPetCO2"></canvas></div></div>
            </div>
            <div style="margin-top:12px; padding:12px; background:white; border:1px solid #e2e8f0; border-radius:10px;">
              <div style="display:flex; gap:18px; flex-wrap:wrap; align-items:center;">
                <div>
                  <label style="font-size:11px; color:#475569; display:block;">Curseur SV1 (s)</label>
                  <input type="range" id="gpSlSV1" min="0" max="${Math.ceil(lastTime())}" step="1" value="${_cursors.sv1_t}" style="width:240px;">
                  <span id="gpValSV1" style="font-weight:700; color:#dc2626;">${_cursors.sv1_t}s</span>
                </div>
                <div>
                  <label style="font-size:11px; color:#475569; display:block;">Curseur SV2 (s)</label>
                  <input type="range" id="gpSlSV2" min="0" max="${Math.ceil(lastTime())}" step="1" value="${_cursors.sv2_t}" style="width:240px;">
                  <span id="gpValSV2" style="font-weight:700; color:#7c3aed;">${_cursors.sv2_t}s</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Tab VO2max -->
          <div class="cpetGraphTabPanel" data-tab="vo2max" style="display:none;">
            <div class="gp-card"><div class="gp-title">VO₂ en fonction du temps</div><div style="height:340px;"><canvas id="gpChartVO2"></canvas></div></div>
            <div class="gp-card" style="margin-top:14px;"><div class="gp-title">VO₂ en fonction de la puissance (V-slope inversé)</div><div style="height:280px;"><canvas id="gpChartVO2Power"></canvas></div></div>
            <div style="margin-top:12px; padding:12px; background:white; border:1px solid #e2e8f0; border-radius:10px;">
              <div style="display:flex; gap:18px; flex-wrap:wrap; align-items:center;">
                <div>
                  <label style="font-size:11px; color:#475569; display:block;">Curseur VO₂ retenue (s)</label>
                  <input type="range" id="gpSlVO2max" min="0" max="${Math.ceil(lastTime())}" step="1" value="${_cursors.vo2max_t}" style="width:280px;">
                  <span id="gpValVO2max" style="font-weight:700; color:#16a34a;">${_cursors.vo2max_t}s</span>
                </div>
                <div>
                  <label style="font-size:11px; color:#475569; display:block;">Statut VO₂</label>
                  <select id="gpVO2Status" style="padding:5px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:12px;">
                    <option value="max">VO₂ max retenue (plateau confirmé)</option>
                    <option value="peak">VO₂ peak retenue (pas de plateau)</option>
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

          <!-- Tab Énergie -->
          <div class="cpetGraphTabPanel" data-tab="energy" style="display:none;">
            <div class="gp-card"><div class="gp-title">Dépense énergétique instantanée (kcal/min)</div><div style="height:280px;"><canvas id="gpChartEEInst"></canvas></div></div>
            <div class="gp-card" style="margin-top:14px;"><div class="gp-title">Dépense énergétique cumulée (kcal)</div><div style="height:240px;"><canvas id="gpChartEECum"></canvas></div></div>
            <div style="margin-top:12px; padding:12px; background:white; border:1px solid #e2e8f0; border-radius:10px;">
              <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
                <div>
                  <label style="font-size:11px; color:#475569; display:block;">Début zone (s)</label>
                  <input type="range" id="gpSlEnStart" min="0" max="${Math.ceil(lastTime())}" step="1" value="${_zones.energy_start}" style="width:220px;">
                  <span id="gpValEnStart" style="font-weight:700; color:#0891b2;">${_zones.energy_start}s</span>
                </div>
                <div>
                  <label style="font-size:11px; color:#475569; display:block;">Fin zone (s)</label>
                  <input type="range" id="gpSlEnEnd" min="0" max="${Math.ceil(lastTime())}" step="1" value="${_zones.energy_end}" style="width:220px;">
                  <span id="gpValEnEnd" style="font-weight:700; color:#0891b2;">${_zones.energy_end}s</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Tab Coût -->
          <div class="cpetGraphTabPanel" data-tab="cost" style="display:none;">
            <div class="gp-card"><div class="gp-title">Coût énergétique (mlO₂/W)</div><div style="height:300px;"><canvas id="gpChartCost"></canvas></div></div>
            <div style="margin-top:12px; padding:12px; background:white; border:1px solid #e2e8f0; border-radius:10px;">
              <div style="display:flex; gap:14px; flex-wrap:wrap; align-items:center;">
                <div>
                  <label style="font-size:11px; color:#475569; display:block;">Début zone stable (s)</label>
                  <input type="range" id="gpSlCostStart" min="0" max="${Math.ceil(lastTime())}" step="1" value="${_zones.cost_start}" style="width:220px;">
                  <span id="gpValCostStart" style="font-weight:700; color:#a16207;">${_zones.cost_start}s</span>
                </div>
                <div>
                  <label style="font-size:11px; color:#475569; display:block;">Fin zone stable (s)</label>
                  <input type="range" id="gpSlCostEnd" min="0" max="${Math.ceil(lastTime())}" step="1" value="${_zones.cost_end}" style="width:220px;">
                  <span id="gpValCostEnd" style="font-weight:700; color:#a16207;">${_zones.cost_end}s</span>
                </div>
              </div>
              <div style="margin-top:10px; font-size:11.5px; color:#64748b;">
                Astuce : pour évaluer un coût énergétique fiable, sélectionnez une zone d'effort stable (état stable), en excluant les premières minutes et la fin du test.
              </div>
            </div>
          </div>
        </div>

        <!-- Panneau valeurs recalculées -->
        <div style="background:white; border-left:1px solid #e2e8f0; overflow-y:auto; padding:16px;">
          <h4 style="margin:0 0 10px; color:#0b1530; font-size:14px;">📋 Valeurs retenues</h4>
          <div id="gpPanel" style="font-size:12px;"></div>

          <h4 style="margin:16px 0 8px; color:#0b1530; font-size:13px;">💬 Commentaires</h4>
          <textarea id="gpComments" placeholder="Notes cliniques sur l'analyse, ajustements effectués, contexte du test..." style="width:100%; min-height:80px; border:1px solid #cbd5e1; border-radius:7px; padding:8px; font-size:12px; font-family:inherit; resize:vertical;">${_exam.notes || ''}</textarea>
        </div>
      </div>

      <!-- Footer boutons -->
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

    // === Init select status ===
    const sel = document.getElementById('gpVO2Status');
    if (sel) sel.value = _vo2Manual.status || 'peak';

    // === Câblage des curseurs ===
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
    // Construit les charts du tab si pas encore fait
    if (tabName === 'wasserman' && !_charts._wasserman) buildWassermanCharts();
    if (tabName === 'vo2max' && !_charts._vo2max) buildVO2Charts();
    if (tabName === 'energy' && !_charts._energy) buildEnergyCharts();
    if (tabName === 'cost' && !_charts._cost) buildCostCharts();
    // Mise à jour curseurs sur tous les charts existants
    updateCursorsOnCharts();
  }
  window.__cpetGraphSwitchTab = switchTab;

  // ============================================================
  // === Construction des charts ================================
  // ============================================================
  function baseChartOpts(titleY) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { title: ctx => 't = ' + Math.round(ctx[0].parsed.x) + ' s' } },
        verticalCursors: { cursors: [] }
      },
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Temps (s)', font: { size: 11 } }, ticks: { font: { size: 10 } } },
        y: { title: { display: true, text: titleY, font: { size: 11 } }, ticks: { font: { size: 10 } } }
      }
    };
  }

  function buildWassermanCharts() {
    // VE/VO2 (utilise PetO2 si dispo, sinon VE/VO2)
    const veVo2 = seriesComputed(c => {
      const ve = getKey(c, 'VE');
      const vo2 = getKey(c, 'VO2');
      return ve != null && vo2 ? ve / (vo2 / 1000) : null;
    });
    const veVco2 = seriesComputed(c => {
      const ve = getKey(c, 'VE');
      const vco2 = getKey(c, 'VCO2');
      return ve != null && vco2 ? ve / (vco2 / 1000) : null;
    });
    const petO2 = series('PetO2', 'PETO2', 'PETO₂');
    const petCO2 = series('PetCO2', 'PETCO2', 'PETCO₂');

    _charts.veVo2 = mkChart('gpChartVEVO2', veVo2, 'VE/VO₂', '#0891b2', 'VE/VO₂');
    _charts.veVco2 = mkChart('gpChartVEVCO2', veVco2, 'VE/VCO₂', '#7c3aed', 'VE/VCO₂');
    _charts.petO2 = mkChart('gpChartPetO2', petO2.length ? petO2 : veVo2.map(p => ({x:p.x, y:null})), 'PetO₂ (mmHg)', '#10b981', 'PetO₂');
    _charts.petCO2 = mkChart('gpChartPetCO2', petCO2.length ? petCO2 : veVco2.map(p => ({x:p.x, y:null})), 'PetCO₂ (mmHg)', '#f59e0b', 'PetCO₂');
    _charts._wasserman = true;
  }

  function buildVO2Charts() {
    const vo2 = series('VO2');
    _charts.vo2 = mkChart('gpChartVO2', vo2, 'VO₂ (mL/min)', '#dc2626', 'VO₂');
    // VO2 vs Power
    const vo2pwr = [];
    for (const c of _cycles) {
      const v = getKey(c, 'VO2');
      const p = getKey(c, 'Power', 'WR');
      if (v != null && p != null) vo2pwr.push({ x: p, y: v });
    }
    vo2pwr.sort((a, b) => a.x - b.x);
    const ctx2 = document.getElementById('gpChartVO2Power');
    if (ctx2) {
      _charts.vo2pwr = new Chart(ctx2.getContext('2d'), {
        type: 'scatter',
        data: { datasets: [{ data: vo2pwr, borderColor: '#dc2626', backgroundColor: '#fecaca', pointRadius: 2, showLine: true, tension: 0.2 }] },
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
    _charts._vo2max = true;
  }

  function buildEnergyCharts() {
    // EE instantanée = VO2(L/min) * (1.232*RER + 3.815) kcal/min — formule Lusk
    const eeInst = seriesComputed(c => {
      const vo2 = getKey(c, 'VO2');     // mL/min
      const rer = getKey(c, 'RQ', 'RER');
      if (vo2 == null) return null;
      const r = rer != null && rer >= 0.7 && rer <= 1.3 ? rer : 0.9;
      return (vo2 / 1000) * (1.232 * r + 3.815);
    });
    // EE cumulée (intégrale)
    const eeCum = [];
    let cum = 0, lastT = null;
    for (const p of eeInst) {
      if (lastT != null) cum += p.y * ((p.x - lastT) / 60);
      eeCum.push({ x: p.x, y: cum });
      lastT = p.x;
    }
    _charts.eeInst = mkChart('gpChartEEInst', eeInst, 'EE (kcal/min)', '#059669', 'EE inst');
    _charts.eeCum = mkChart('gpChartEECum', eeCum, 'EE cumulée (kcal)', '#10b981', 'EE cum');
    _charts._energy = true;
  }

  function buildCostCharts() {
    // Coût énergétique = VO2 / Power (mlO2 / W / min)
    const cost = seriesComputed(c => {
      const vo2 = getKey(c, 'VO2');
      const pwr = getKey(c, 'Power', 'WR');
      return vo2 != null && pwr != null && pwr > 10 ? vo2 / pwr : null;
    });
    _charts.cost = mkChart('gpChartCost', cost, 'Coût (mLO₂/W)', '#a16207', 'Coût énergétique');
    _charts._cost = true;
  }

  function mkChart(canvasId, data, yLabel, color, lineLabel) {
    const el = document.getElementById(canvasId);
    if (!el) return null;
    return new Chart(el.getContext('2d'), {
      type: 'line',
      data: { datasets: [{ label: lineLabel, data, borderColor: color, backgroundColor: color + '22', borderWidth: 2, pointRadius: 0, tension: 0.25, fill: true }] },
      options: baseChartOpts(yLabel)
    });
  }

  // ============================================================
  // === Mise à jour des curseurs sur tous les charts ===========
  // ============================================================
  function updateCursorsOnCharts() {
    const setCursors = (chart, cursors) => {
      if (!chart) return;
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

    setCursors(_charts.veVo2,  [sv1, sv2]);
    setCursors(_charts.veVco2, [sv1, sv2]);
    setCursors(_charts.petO2,  [sv1, sv2]);
    setCursors(_charts.petCO2, [sv1, sv2]);
    setCursors(_charts.vo2,    [v2m, sv1, sv2]);
    setCursors(_charts.eeInst, [enS, enE]);
    setCursors(_charts.eeCum,  [enS, enE]);
    setCursors(_charts.cost,   [csS, csE]);
  }

  // ============================================================
  // === Recompute (toutes les valeurs dérivées) ================
  // ============================================================
  function recompute() {
    updateCursorsOnCharts();

    const c1 = nearestCycle(_cursors.sv1_t) || {};
    const c2 = nearestCycle(_cursors.sv2_t) || {};
    const cMax = nearestCycle(_cursors.vo2max_t) || {};

    const w = num(_exam.parsed_summary?.weight_kg) || null;
    const fmt = (v, n = 1) => v == null ? '—' : (Math.round(v * 10 ** n) / 10 ** n).toString();

    // EE sur la zone sélectionnée
    let eeZone = 0;
    let lastT = null;
    for (const c of _cycles) {
      const t = timeSeconds(c);
      if (t == null || t < _zones.energy_start || t > _zones.energy_end) { lastT = null; continue; }
      const vo2 = getKey(c, 'VO2');
      const rer = getKey(c, 'RQ', 'RER');
      if (vo2 == null) continue;
      const r = rer != null && rer >= 0.7 && rer <= 1.3 ? rer : 0.9;
      const ee = (vo2 / 1000) * (1.232 * r + 3.815);
      if (lastT != null) eeZone += ee * ((t - lastT) / 60);
      lastT = t;
    }

    // Coût moyen sur la zone
    const costVals = [];
    for (const c of _cycles) {
      const t = timeSeconds(c);
      if (t == null || t < _zones.cost_start || t > _zones.cost_end) continue;
      const vo2 = getKey(c, 'VO2');
      const pwr = getKey(c, 'Power', 'WR');
      if (vo2 != null && pwr != null && pwr > 10) costVals.push(vo2 / pwr);
    }
    const costAvg = costVals.length ? costVals.reduce((a, b) => a + b, 0) / costVals.length : null;

    // VO2/Kg
    const vo2cMax = getKey(cMax, 'VO2');
    const vo2KgMax = vo2cMax != null && w ? vo2cMax / w : getKey(cMax, 'VO2/Kg');

    // VE/VCO2 slope (régression linéaire VE vs VCO2 entre repos et SV2)
    const xs = [], ys = [];
    for (const c of _cycles) {
      const t = timeSeconds(c);
      if (t == null || t > _cursors.sv2_t) continue;
      const ve = getKey(c, 'VE');
      const vco2 = getKey(c, 'VCO2');
      if (ve != null && vco2 != null && vco2 > 0) { xs.push(vco2 / 1000); ys.push(ve); }
    }
    let slope = null;
    if (xs.length > 3) {
      const n = xs.length;
      const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
      const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
      const sxx = xs.reduce((a, b) => a + b * b, 0);
      const d = n * sxx - sx * sx;
      if (d > 0) slope = (n * sxy - sx * sy) / d;
    }

    // RER max
    let rerMax = null;
    for (const c of _cycles) {
      const r = getKey(c, 'RQ', 'RER');
      if (r != null && (rerMax == null || r > rerMax)) rerMax = r;
    }

    // Cache valeurs recalculées
    window._cpetRecalc = {
      sv1_t:    _cursors.sv1_t,
      sv1_vo2:  getKey(c1, 'VO2'),
      sv1_hr:   getKey(c1, 'HR'),
      sv1_power: getKey(c1, 'Power', 'WR'),
      sv1_ve_vo2:  veRatio(c1, 'VO2'),
      sv1_ve_vco2: veRatio(c1, 'VCO2'),
      sv2_t:    _cursors.sv2_t,
      sv2_vo2:  getKey(c2, 'VO2'),
      sv2_hr:   getKey(c2, 'HR'),
      sv2_power: getKey(c2, 'Power', 'WR'),
      sv2_ve_vo2:  veRatio(c2, 'VO2'),
      sv2_ve_vco2: veRatio(c2, 'VCO2'),
      vo2_retained_ml_min:    vo2cMax,
      vo2_retained_ml_kg_min: vo2KgMax,
      vo2_status:    _vo2Manual.status,
      has_plateau:   _vo2Manual.has_plateau,
      hr_max:        getKey(cMax, 'HR'),
      power_max:     getKey(cMax, 'Power', 'WR'),
      rer_max:       rerMax,
      ve_vco2_slope: slope,
      energy_zone_kcal: eeZone,
      cost_avg:      costAvg
    };

    // Maj panneau
    const html = `
      <div class="grp-title">Seuil ventilatoire 1 (SV1)</div>
      <div class="row"><span class="lab">Temps</span><span class="val">${fmt(_cursors.sv1_t, 0)} s</span></div>
      <div class="row"><span class="lab">VO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_vo2, 0)} mL/min</span></div>
      <div class="row"><span class="lab">FC</span><span class="val">${fmt(window._cpetRecalc.sv1_hr, 0)} bpm</span></div>
      <div class="row"><span class="lab">Puissance</span><span class="val">${fmt(window._cpetRecalc.sv1_power, 0)} W</span></div>
      <div class="row"><span class="lab">VE/VO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_ve_vo2, 1)}</span></div>
      <div class="row"><span class="lab">VE/VCO₂</span><span class="val">${fmt(window._cpetRecalc.sv1_ve_vco2, 1)}</span></div>

      <div class="grp-title">Seuil ventilatoire 2 (SV2)</div>
      <div class="row"><span class="lab">Temps</span><span class="val">${fmt(_cursors.sv2_t, 0)} s</span></div>
      <div class="row"><span class="lab">VO₂</span><span class="val">${fmt(window._cpetRecalc.sv2_vo2, 0)} mL/min</span></div>
      <div class="row"><span class="lab">FC</span><span class="val">${fmt(window._cpetRecalc.sv2_hr, 0)} bpm</span></div>
      <div class="row"><span class="lab">Puissance</span><span class="val">${fmt(window._cpetRecalc.sv2_power, 0)} W</span></div>
      <div class="row"><span class="lab">VE/VO₂</span><span class="val">${fmt(window._cpetRecalc.sv2_ve_vo2, 1)}</span></div>
      <div class="row"><span class="lab">VE/VCO₂</span><span class="val">${fmt(window._cpetRecalc.sv2_ve_vco2, 1)}</span></div>

      <div class="grp-title">VO₂ maximale</div>
      <div class="row"><span class="lab">Statut</span><span class="val">${{max:'VO₂ max',peak:'VO₂ peak',submaximal:'Non maximal',uninterpretable:'Ininterprétable'}[_vo2Manual.status] || _vo2Manual.status}</span></div>
      <div class="row"><span class="lab">Plateau</span><span class="val">${_vo2Manual.has_plateau ? '✓ Observé' : '✗ Absent'}</span></div>
      <div class="row"><span class="lab">VO₂ retenue</span><span class="val">${fmt(vo2cMax, 0)} mL/min</span></div>
      <div class="row"><span class="lab">VO₂/Kg</span><span class="val">${fmt(vo2KgMax, 1)} mL/kg/min</span></div>
      <div class="row"><span class="lab">FC max</span><span class="val">${fmt(window._cpetRecalc.hr_max, 0)} bpm</span></div>
      <div class="row"><span class="lab">P max</span><span class="val">${fmt(window._cpetRecalc.power_max, 0)} W</span></div>
      <div class="row"><span class="lab">RER max</span><span class="val">${fmt(rerMax, 2)}</span></div>
      <div class="row"><span class="lab">VE/VCO₂ slope</span><span class="val">${fmt(slope, 1)}</span></div>

      <div class="grp-title">Énergétique</div>
      <div class="row"><span class="lab">EE zone (kcal)</span><span class="val">${fmt(eeZone, 1)}</span></div>
      <div class="row"><span class="lab">Coût moyen</span><span class="val">${fmt(costAvg, 2)} mLO₂/W</span></div>
    `;
    const panel = document.getElementById('gpPanel');
    if (panel) panel.innerHTML = html;
  }

  function veRatio(c, key) {
    const ve = getKey(c, 'VE');
    const v = getKey(c, key);
    if (ve == null || v == null || v <= 0) return null;
    return ve / (v / 1000);
  }

  // ============================================================
  // === Sauvegarde / Validation =================================
  // ============================================================
  window.__cpetGraphSave = async function (validate) {
    const r = window._cpetRecalc || {};
    const graphConfig = {
      cursor_sv1_t_s:    _cursors.sv1_t,
      cursor_sv2_t_s:    _cursors.sv2_t,
      cursor_vo2max_t_s: _cursors.vo2max_t,
      energy_zone_start_s: _zones.energy_start,
      energy_zone_end_s:   _zones.energy_end,
      cost_zone_start_s:   _zones.cost_start,
      cost_zone_end_s:     _zones.cost_end,
      vo2_status:    _vo2Manual.status,
      has_plateau:   _vo2Manual.has_plateau,
      saved_at:      new Date().toISOString()
    };
    const validated = {
      ...(_exam.validated_data || _exam.parsed_summary || {}),
      sv1_t:    r.sv1_t,
      sv1_vo2:  r.sv1_vo2,
      sv1_hr:   r.sv1_hr,
      sv1_power: r.sv1_power,
      sv2_t:    r.sv2_t,
      sv2_vo2:  r.sv2_vo2,
      sv2_hr:   r.sv2_hr,
      sv2_power: r.sv2_power,
      vo2_max_ml_min:    r.vo2_retained_ml_min,
      vo2_max_ml_kg_min: r.vo2_retained_ml_kg_min,
      hr_max:    r.hr_max,
      power_max: r.power_max,
      rer_max:   r.rer_max,
      ve_vco2_slope:    r.ve_vco2_slope,
      vo2_status:       r.vo2_status,
      has_plateau:      r.has_plateau,
      energy_total_kcal: r.energy_zone_kcal,
      cost_avg_mlO2_W:  r.cost_avg
    };
    const comments = (document.getElementById('gpComments') || {}).value || null;

    if (validate && !confirm('Valider définitivement cette analyse ?\nLes valeurs ajustées seront enregistrées comme référence avec votre identité et l\'horodatage.')) return;

    try {
      await window.MarfanAPI.medicalExams.saveGraphConfig(_exam.id, graphConfig, validated, !!validate, comments);
      alert(validate ? '✓ Analyse validée avec succès.' : '✓ Ajustements enregistrés sans validation.');
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
    // Détruit les charts
    Object.values(_charts).forEach(ch => { if (ch && ch.destroy) ch.destroy(); });
    _charts = {};
  };

})();
