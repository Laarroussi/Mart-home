/**
 * aortic-consultations.js — Suivi aortique + Consultations chronologiques
 * =======================================================================
 * Expose window.AorticConsultUI :
 *   mount(containerId, patientId) → monte la carte complète
 *   refresh()                     → recharge depuis l'API
 *
 * 2 blocs :
 *   1. Suivi aortique : valeur initiale (1er diagnostic) + valeur actuelle + delta
 *   2. Consultations : formulaire "Consultation du jour" + historique chronologique
 *
 * Design : léger, aligné sur le style existant (cartes blanches, accents cyan/violet).
 * ======================================================================= */

(function () {
  'use strict';

  let _patientId = null;
  let _aortic = {};
  let _consultations = [];
  let _showForm = false;
  let _editingId = null;

  const SITES = ['Sinus de Valsalva', 'Anneau aortique', 'Jonction sino-tubulaire', 'Aorte ascendante', 'Crosse aortique', 'Aorte descendante'];
  const METHODS = ['ETT (échographie transthoracique)', 'ETO (transœsophagienne)', 'Angio-TDM', 'IRM cardiaque', 'Autre'];
  const EVOLUTIONS = [
    { v: 'stable',        l: '➡️ Stable',        c: '#0891b2' },
    { v: 'amelioration',  l: '✅ Amélioration',  c: '#16a34a' },
    { v: 'aggravation',   l: '⚠️ Aggravation',   c: '#dc2626' },
    { v: 'non_evaluable', l: '❔ Non évaluable', c: '#64748b' }
  ];

  // ============================================================
  // === Chargement des données ================================
  // ============================================================
  async function load(patientId) {
    _patientId = patientId;
    try {
      const [rA, rC] = await Promise.all([
        window.MarfanAPI.consultations.getAortic(patientId),
        window.MarfanAPI.consultations.list(patientId)
      ]);
      _aortic = (rA && rA.aortic) || {};
      _consultations = (rC && rC.consultations) || [];
      // Expose pour la timeline des actes (renderPatientTimelineActs dans index.html)
      window._patientConsultations = _consultations;
      if (typeof window.renderPatientTimelineActs === 'function') {
        try { window.renderPatientTimelineActs(); } catch (_) {}
      }
    } catch (e) {
      console.warn('[aortic] chargement échoué :', e.message);
      _aortic = {}; _consultations = [];
      window._patientConsultations = [];
    }
  }

  async function mount(containerId, patientId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '<div style="padding:14px; text-align:center; color:#64748b;">Chargement du suivi aortique…</div>';
    await load(patientId);
    el.innerHTML = render();
    bind(el);
  }

  async function refresh() {
    if (!_patientId) return;
    await load(_patientId);
    const el = document.querySelector('[data-aortic-root]');
    if (el) { el.outerHTML = render(); bind(document.querySelector('[data-aortic-root]').parentElement); }
  }

  // ============================================================
  // === Rendu principal ========================================
  // ============================================================
  function render() {
    return `<div data-aortic-root>${renderAorticCard()}${renderConsultationsCard()}</div>
      <style>
        [data-aortic-root] .ac-card { background:white; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:14px; overflow:hidden; }
        [data-aortic-root] .ac-head { padding:14px 20px; display:flex; justify-content:space-between; align-items:center; gap:10px; }
        [data-aortic-root] .ac-body { padding:16px 20px; }
        [data-aortic-root] .ac-field { margin-bottom:10px; }
        [data-aortic-root] .ac-field label { display:block; font-size:11px; font-weight:700; color:#475569; margin-bottom:4px; text-transform:uppercase; letter-spacing:0.3px; }
        [data-aortic-root] .ac-field input, [data-aortic-root] .ac-field select, [data-aortic-root] .ac-field textarea {
          width:100%; padding:9px 11px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; font-family:inherit; box-sizing:border-box;
        }
        [data-aortic-root] .ac-field textarea { min-height:60px; resize:vertical; }
        [data-aortic-root] .ac-grid { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:12px; }
        [data-aortic-root] .ac-btn { padding:10px 18px; border:none; border-radius:9px; font-weight:700; cursor:pointer; font-size:13px; }
        [data-aortic-root] .ac-btn-primary { background:linear-gradient(135deg,#dc2626,#f43f5e); color:white; }
        [data-aortic-root] .ac-btn-ghost { background:white; color:#475569; border:1px solid #cbd5e1; font-weight:600; }
        [data-aortic-root] .ac-consult { padding:12px 0; border-bottom:1px dashed #eef0f5; }
        [data-aortic-root] .ac-consult:last-child { border-bottom:none; }
        @media (max-width: 900px) { [data-aortic-root] .ac-grid { grid-template-columns:1fr !important; } }
      </style>`;
  }

  // ============================================================
  // === Bloc 1 : Suivi aortique ================================
  // ============================================================
  function renderAorticCard() {
    const a = _aortic || {};
    const first = a.first_value_mm != null ? parseFloat(a.first_value_mm) : null;
    const curr  = a.current_value_mm != null ? parseFloat(a.current_value_mm) : null;
    const delta = (first != null && curr != null) ? (curr - first) : null;
    const deltaColor = delta == null ? '#64748b' : (delta > 1 ? '#dc2626' : (delta < -1 ? '#16a34a' : '#0891b2'));
    const deltaTxt = delta == null ? '—' : ((delta > 0 ? '+' : '') + delta.toFixed(1) + ' mm');

    // Seuil clinique d'alerte : > 45 mm (indication chirurgicale discutée en Marfan)
    const alert = curr != null && curr >= 45;
    const warn  = curr != null && curr >= 42 && curr < 45;

    return `
      <article class="ac-card">
        <div class="ac-head" style="background:linear-gradient(135deg,#dc2626,#f43f5e); color:white;">
          <div>
            <h3 style="margin:0; color:white; font-size:15px;">🫀 Suivi de la dilatation aortique <span style="font-weight:600; opacity:0.9;">— ${esc(_patientId || '?')}</span></h3>
            <p style="margin:3px 0 0; font-size:11.5px; opacity:0.92;">Racine aortique / sinus de Valsalva — diagnostic initial Marfan vs évaluation actuelle</p>
          </div>
          <button data-ac="edit-aortic" style="padding:7px 13px; border:1px solid rgba(255,255,255,0.35); background:rgba(255,255,255,0.15); color:white; border-radius:8px; font-weight:600; cursor:pointer; font-size:12px; white-space:nowrap;">✏️ Modifier</button>
        </div>
        <div class="ac-body">
          <div style="display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:14px;">
            <!-- Valeur initiale -->
            <div style="padding:12px 14px; background:#f8fafc; border-radius:10px; border-left:3px solid #94a3b8;">
              <div style="font-size:10.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; font-weight:700;">Diagnostic initial Marfan</div>
              <div style="font-size:22px; font-weight:800; color:#0b1530; margin-top:4px;">${first != null ? first.toFixed(1) + ' <span style="font-size:13px; font-weight:600;">mm</span>' : '<span style="font-size:14px; color:#94a3b8;">Non renseigné</span>'}</div>
              <div style="font-size:11.5px; color:#64748b; margin-top:3px;">
                ${a.first_diagnosis_date ? '📅 ' + fmtDate(a.first_diagnosis_date) : '📅 Date non renseignée'}
                ${a.first_site ? '<br>📍 ' + esc(a.first_site) : ''}
              </div>
              ${a.first_comment ? `<div style="margin-top:6px; font-size:11.5px; color:#475569; font-style:italic;">📝 ${esc(a.first_comment)}</div>` : ''}
            </div>
            <!-- Valeur actuelle -->
            <div style="padding:12px 14px; background:${alert ? '#fee2e2' : (warn ? '#fef3c7' : '#eff6ff')}; border-radius:10px; border-left:3px solid ${alert ? '#dc2626' : (warn ? '#f59e0b' : '#3b82f6')};">
              <div style="font-size:10.5px; color:${alert ? '#991b1b' : (warn ? '#92400e' : '#1e40af')}; text-transform:uppercase; letter-spacing:0.5px; font-weight:700;">Évaluation actuelle</div>
              <div style="font-size:22px; font-weight:800; color:#0b1530; margin-top:4px;">${curr != null ? curr.toFixed(1) + ' <span style="font-size:13px; font-weight:600;">mm</span>' : '<span style="font-size:14px; color:#94a3b8;">Non renseigné</span>'}</div>
              <div style="font-size:11.5px; color:#64748b; margin-top:3px;">
                ${a.current_date ? '📅 ' + fmtDate(a.current_date) : '—'}
                ${a.current_site ? '<br>📍 ' + esc(a.current_site) : ''}
              </div>
              ${alert ? '<div style="margin-top:6px; font-size:11px; font-weight:700; color:#991b1b;">⚠️ Seuil ≥ 45 mm</div>' : ''}
              ${warn  ? '<div style="margin-top:6px; font-size:11px; font-weight:700; color:#92400e;">⚠ Surveillance rapprochée</div>' : ''}
            </div>
            <!-- Évolution -->
            <div style="padding:12px 14px; background:#f8fafc; border-radius:10px; border-left:3px solid ${deltaColor};">
              <div style="font-size:10.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; font-weight:700;">Évolution</div>
              <div style="font-size:22px; font-weight:800; color:${deltaColor}; margin-top:4px;">${deltaTxt}</div>
              <div style="font-size:11.5px; color:#64748b; margin-top:3px;">${first != null && curr != null ? 'Depuis la 1ʳᵉ mesure' : 'Données incomplètes'}</div>
            </div>
          </div>
          ${a.notes ? `<div style="margin-top:12px; padding:10px 12px; background:#f8fafc; border-radius:8px; font-size:12.5px; color:#475569;">📝 ${esc(a.notes)}</div>` : ''}
        </div>
      </article>`;
  }

  // ============================================================
  // === Bloc 2 : Consultations =================================
  // ============================================================
  function renderConsultationsCard() {
    return `
      <article class="ac-card">
        <div class="ac-head" style="background:linear-gradient(135deg,#7c3aed,#a855f7); color:white;">
          <div>
            <h3 style="margin:0; color:white; font-size:15px;">🗓️ Consultations <span style="font-weight:600; opacity:0.9;">— ${esc(_patientId || '?')}</span></h3>
            <p style="margin:3px 0 0; font-size:11.5px; opacity:0.92;">Historique chronologique — ${_consultations.length} consultation(s)</p>
          </div>
          <button data-ac="new-consult" style="padding:8px 15px; border:none; background:white; color:#7c3aed; border-radius:8px; font-weight:700; cursor:pointer; font-size:12.5px; white-space:nowrap;">+ Consultation du jour</button>
        </div>
        <div class="ac-body">
          <div id="acFormZone">${_showForm ? renderConsultForm() : ''}</div>
          <div id="acHistory">${renderHistory()}</div>
        </div>
      </article>`;
  }

  function renderConsultForm() {
    const editing = _editingId ? _consultations.find(c => c.id === _editingId) : null;
    const today = new Date().toISOString().slice(0, 10);
    const v = (k, d) => editing && editing[k] != null ? editing[k] : (d || '');
    return `
      <div style="padding:16px; background:#faf5ff; border:1px solid #d8b4fe; border-radius:10px; margin-bottom:16px;">
        <h4 style="margin:0 0 12px; font-size:13.5px; color:#5b21b6;">
          ${editing ? '✏️ Modifier la consultation du ' + fmtDate(editing.consultation_date) : '📋 Nouvelle consultation'}
        </h4>

        <div class="ac-grid" style="margin-bottom:4px;">
          <div class="ac-field">
            <label>Date de consultation</label>
            <input type="date" id="ac_date" value="${v('consultation_date', today).slice(0,10)}">
          </div>
          <div class="ac-field">
            <label>Mesure aortique (mm)</label>
            <input type="number" step="0.1" id="ac_value" placeholder="ex. 42.0" value="${v('aortic_value_mm')}">
          </div>
          <div class="ac-field">
            <label>Site mesuré</label>
            <select id="ac_site">
              <option value="">— Non précisé —</option>
              ${SITES.map(s => `<option value="${s}" ${v('aortic_site') === s ? 'selected' : ''}>${s}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="ac-grid">
          <div class="ac-field">
            <label>Méthode d'imagerie</label>
            <select id="ac_method">
              <option value="">— Non précisé —</option>
              ${METHODS.map(m => `<option value="${m}" ${v('aortic_method') === m ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </div>
          <div class="ac-field">
            <label>Évolution depuis la dernière consultation</label>
            <select id="ac_evolution">
              <option value="">— Non précisé —</option>
              ${EVOLUTIONS.map(e => `<option value="${e.v}" ${v('evolution') === e.v ? 'selected' : ''}>${e.l}</option>`).join('')}
            </select>
          </div>
          <div class="ac-field">
            <label>Détail de l'évolution</label>
            <input type="text" id="ac_evolutionDetail" placeholder="ex. +1 mm en 6 mois" value="${esc(v('evolution_detail'))}">
          </div>
        </div>

        <div class="ac-field">
          <label>Adaptation de l'activité physique adaptée (APA)</label>
          <textarea id="ac_apa" placeholder="ex. Maintien de l'intensité modérée, éviter Valsalva, limiter la charge isométrique…">${esc(v('apa_adaptation'))}</textarea>
        </div>

        <div class="ac-field">
          <label>Modification thérapeutique</label>
          <input type="text" id="ac_treatment" placeholder="ex. Bêta-bloquant maintenu / dose ajustée" value="${esc(v('treatment_change'))}">
        </div>

        <div class="ac-field">
          <label>Commentaire libre</label>
          <textarea id="ac_comment" placeholder="Observations cliniques, symptômes, contexte…">${esc(v('comment'))}</textarea>
        </div>

        ${renderSessionsSnapshot()}

        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
          <button class="ac-btn ac-btn-ghost" data-ac="cancel-consult">Annuler</button>
          <button class="ac-btn" style="background:linear-gradient(135deg,#7c3aed,#a855f7); color:white;" data-ac="save-consult">
            ${editing ? '💾 Mettre à jour' : '✓ Enregistrer la consultation'}
          </button>
        </div>
      </div>`;
  }

  // Résumé simple des séances récentes (si dispo dans le contexte global)
  function renderSessionsSnapshot() {
    const p = (window.patients || []).find(x => x.id === _patientId);
    const sessions = (p && p.trainingSessions) || window._recentTrainingSessions || [];
    if (!sessions.length) return '';
    const recent = sessions.slice(-5);
    const avgHr = Math.round(recent.reduce((s, x) => s + (x.avgHr || x.hr_avg || 0), 0) / recent.length) || null;
    const avgRpe = (recent.reduce((s, x) => s + (x.rpe || 0), 0) / recent.length).toFixed(1);
    const totalMin = recent.reduce((s, x) => s + (x.durationMin || x.duration_min || 0), 0);
    return `
      <div style="margin-top:8px; padding:10px 12px; background:#ecfdf5; border:1px solid #a7f3d0; border-radius:8px; font-size:12px; color:#065f46;">
        <strong>🏃 Séances récentes (auto)</strong> — ${recent.length} séance(s)
        ${avgHr ? ' · FC moy <strong>' + avgHr + ' bpm</strong>' : ''}
        ${avgRpe > 0 ? ' · RPE moy <strong>' + avgRpe + '/20</strong>' : ''}
        ${totalMin ? ' · <strong>' + totalMin + ' min</strong> cumulées' : ''}
      </div>`;
  }

  function renderHistory() {
    if (!_consultations.length) {
      return `<div style="text-align:center; padding:24px; color:#94a3b8; font-style:italic; font-size:13px;">
        Aucune consultation enregistrée.<br>
        <span style="font-size:11.5px;">Cliquez sur « + Consultation du jour » pour créer la première.</span>
      </div>`;
    }
    return _consultations.map(c => {
      const evo = EVOLUTIONS.find(e => e.v === c.evolution);
      return `
        <div class="ac-consult">
          <div style="display:flex; justify-content:space-between; align-items:start; gap:10px;">
            <div style="flex:1; min-width:0;">
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <strong style="font-size:13.5px; color:#0b1530;">📅 ${fmtDate(c.consultation_date)}</strong>
                ${c.aortic_value_mm != null ? `<span style="padding:2px 9px; background:#fee2e2; color:#991b1b; border-radius:99px; font-size:11.5px; font-weight:700;">🫀 ${parseFloat(c.aortic_value_mm).toFixed(1)} mm</span>` : ''}
                ${evo ? `<span style="padding:2px 9px; background:${evo.c}18; color:${evo.c}; border-radius:99px; font-size:11.5px; font-weight:600;">${evo.l}</span>` : ''}
              </div>
              ${c.aortic_site || c.aortic_method ? `<div style="font-size:11.5px; color:#64748b; margin-top:3px;">${[c.aortic_site, c.aortic_method].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
              ${c.evolution_detail ? `<div style="font-size:12.5px; color:#475569; margin-top:5px;"><strong>Évolution :</strong> ${esc(c.evolution_detail)}</div>` : ''}
              ${c.apa_adaptation ? `<div style="font-size:12.5px; color:#475569; margin-top:4px;"><strong>APA :</strong> ${esc(c.apa_adaptation)}</div>` : ''}
              ${c.treatment_change ? `<div style="font-size:12.5px; color:#475569; margin-top:4px;"><strong>Traitement :</strong> ${esc(c.treatment_change)}</div>` : ''}
              ${c.comment ? `<div style="font-size:12.5px; color:#64748b; margin-top:5px; font-style:italic;">« ${esc(c.comment)} »</div>` : ''}
            </div>
            <button data-ac="edit-consult" data-id="${c.id}" style="padding:5px 11px; border:1px solid #e2e8f0; background:white; color:#64748b; border-radius:7px; font-size:11.5px; cursor:pointer; white-space:nowrap;">✏️</button>
          </div>
        </div>`;
    }).join('');
  }

  // ============================================================
  // === Handlers ===============================================
  // ============================================================
  function bind(root) {
    if (!root) return;
    root.querySelectorAll('[data-ac]').forEach(btn => {
      const action = btn.dataset.ac;
      btn.addEventListener('click', async () => {
        if (action === 'new-consult') { _showForm = true; _editingId = null; rerender(); }
        else if (action === 'cancel-consult') { _showForm = false; _editingId = null; rerender(); }
        else if (action === 'edit-consult') { _showForm = true; _editingId = parseInt(btn.dataset.id, 10); rerender(); }
        else if (action === 'save-consult') { await saveConsult(); }
        else if (action === 'edit-aortic') { openAorticModal(); }
      });
    });
  }

  function rerender() {
    const root = document.querySelector('[data-aortic-root]');
    if (!root) return;
    const parent = root.parentElement;
    root.outerHTML = render();
    bind(parent);
  }

  async function saveConsult() {
    const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const payload = {
      consultation_date: val('ac_date') || null,
      aortic_value_mm:   val('ac_value') ? parseFloat(val('ac_value')) : null,
      aortic_site:       val('ac_site') || null,
      aortic_method:     val('ac_method') || null,
      evolution:         val('ac_evolution') || null,
      evolution_detail:  val('ac_evolutionDetail') || null,
      apa_adaptation:    val('ac_apa') || null,
      treatment_change:  val('ac_treatment') || null,
      comment:           val('ac_comment') || null
    };
    try {
      if (_editingId) {
        await window.MarfanAPI.consultations.update(_patientId, _editingId, payload);
      } else {
        await window.MarfanAPI.consultations.create(_patientId, payload);
      }
      _showForm = false; _editingId = null;
      await load(_patientId);
      rerender();
      toastAC(_editingId ? '✓ Consultation mise à jour' : '✓ Consultation enregistrée');
    } catch (e) {
      alert('Erreur : ' + e.message);
    }
  }

  // Modale d'édition du suivi aortique (baseline + actuel)
  function openAorticModal() {
    const a = _aortic || {};
    const old = document.getElementById('acAorticModal');
    if (old) old.remove();
    const html = `
      <div id="acAorticModal" style="position:fixed; inset:0; background:rgba(11,21,48,0.75); z-index:10025; display:flex; align-items:center; justify-content:center; padding:16px;">
        <div style="background:white; border-radius:16px; width:560px; max-width:96vw; max-height:92vh; overflow-y:auto; box-shadow:0 28px 70px rgba(0,0,0,0.30);">
          <div style="padding:18px 24px; background:linear-gradient(135deg,#dc2626,#f43f5e); color:white;">
            <h3 style="margin:0; color:white; font-size:16px;">🫀 Suivi de la dilatation aortique</h3>
            <p style="margin:3px 0 0; font-size:12px; opacity:0.92;">Renseignez le diagnostic initial Marfan et l'évaluation actuelle.</p>
          </div>
          <div style="padding:20px 24px;">
            <h4 style="margin:0 0 4px; font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Diagnostic initial Marfan</h4>
            <p style="margin:0 0 10px; font-size:11.5px; color:#94a3b8;">Laisser vide si non connu — jamais rempli automatiquement avec la date du jour.</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px;">
              <div><label style="display:block; font-size:11px; font-weight:700; color:#475569; margin-bottom:4px;">Date du diagnostic / première constatation</label>
                <input type="date" id="ao_firstDate" value="${(a.first_diagnosis_date || '').slice(0,10)}" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; box-sizing:border-box;"></div>
              <div><label style="display:block; font-size:11px; font-weight:700; color:#475569; margin-bottom:4px;">Diamètre à cette date (mm)</label>
                <input type="number" step="0.1" id="ao_firstValue" value="${a.first_value_mm != null ? a.first_value_mm : ''}" placeholder="ex. 38.5 — si connu" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; box-sizing:border-box;"></div>
              <div style="grid-column:1/-1;"><label style="display:block; font-size:11px; font-weight:700; color:#475569; margin-bottom:4px;">Site</label>
                <select id="ao_firstSite" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; box-sizing:border-box;">
                  <option value="">— Non précisé —</option>
                  ${SITES.map(s => `<option value="${s}" ${a.first_site === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select></div>
              <div style="grid-column:1/-1;"><label style="display:block; font-size:11px; font-weight:700; color:#475569; margin-bottom:4px;">Commentaire (facultatif)</label>
                <input type="text" id="ao_firstComment" value="${esc(a.first_comment || '')}" placeholder="ex. Mesure issue du compte-rendu du CHU de..." style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; box-sizing:border-box;"></div>
            </div>

            <h4 style="margin:0 0 10px; font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px;">Évaluation actuelle</h4>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:16px;">
              <div><label style="display:block; font-size:11px; font-weight:700; color:#475569; margin-bottom:4px;">Date de mesure</label>
                <input type="date" id="ao_currDate" value="${(a.current_date || new Date().toISOString().slice(0,10)).slice(0,10)}" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; box-sizing:border-box;"></div>
              <div><label style="display:block; font-size:11px; font-weight:700; color:#475569; margin-bottom:4px;">Valeur (mm)</label>
                <input type="number" step="0.1" id="ao_currValue" value="${a.current_value_mm != null ? a.current_value_mm : ''}" placeholder="ex. 42.0" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; box-sizing:border-box;"></div>
              <div style="grid-column:1/-1;"><label style="display:block; font-size:11px; font-weight:700; color:#475569; margin-bottom:4px;">Site</label>
                <select id="ao_currSite" style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; box-sizing:border-box;">
                  <option value="">— Non précisé —</option>
                  ${SITES.map(s => `<option value="${s}" ${a.current_site === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select></div>
            </div>

            <div><label style="display:block; font-size:11px; font-weight:700; color:#475569; margin-bottom:4px;">Notes sur l'évaluation actuelle</label>
              <textarea id="ao_notes" placeholder="Contexte, traitement, surveillance prévue…" style="width:100%; min-height:60px; padding:9px; border:1px solid #cbd5e1; border-radius:8px; font-size:13px; font-family:inherit; resize:vertical; box-sizing:border-box;">${esc(a.notes || '')}</textarea></div>
          </div>
          <div style="padding:14px 24px 20px; display:flex; gap:8px; justify-content:flex-end;">
            <button onclick="document.getElementById('acAorticModal').remove()" style="padding:10px 18px; border:1px solid #cbd5e1; background:white; color:#475569; border-radius:9px; font-weight:600; cursor:pointer; font-size:13px;">Annuler</button>
            <button onclick="window.__saveAorticFollowup()" style="padding:10px 20px; border:none; background:linear-gradient(135deg,#dc2626,#f43f5e); color:white; border-radius:9px; font-weight:700; cursor:pointer; font-size:13px;">💾 Enregistrer</button>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  window.__saveAorticFollowup = async function () {
    const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const payload = {
      first_diagnosis_date: v('ao_firstDate') || null,
      first_value_mm:       v('ao_firstValue') ? parseFloat(v('ao_firstValue')) : null,
      first_site:           v('ao_firstSite') || null,
      first_comment:        v('ao_firstComment') || null,
      current_date:         v('ao_currDate') || null,
      current_value_mm:     v('ao_currValue') ? parseFloat(v('ao_currValue')) : null,
      current_site:         v('ao_currSite') || null,
      notes:                v('ao_notes') || null
    };
    try {
      await window.MarfanAPI.consultations.patchAortic(_patientId, payload);
      const m = document.getElementById('acAorticModal'); if (m) m.remove();
      await load(_patientId);
      rerender();
      toastAC('✓ Suivi aortique mis à jour');
    } catch (e) { alert('Erreur : ' + e.message); }
  };

  // ============================================================
  // === Utils ==================================================
  // ============================================================
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }
  function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' }); }
    catch (_) { return d; }
  }
  function toastAC(msg) {
    const t = document.createElement('div');
    t.style.cssText = 'position:fixed; top:18px; right:18px; z-index:10030; padding:11px 18px; background:#059669; color:white; border-radius:9px; font-size:13px; font-weight:600; box-shadow:0 8px 24px rgba(0,0,0,0.25); opacity:0; transition:opacity .2s;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.style.opacity = '1', 10);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 2800);
  }

  window.AorticConsultUI = { mount, refresh };
})();
