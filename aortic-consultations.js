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
  let _echos = [];
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
      const [rA, rC, rE] = await Promise.all([
        window.MarfanAPI.consultations.getAortic(patientId),
        window.MarfanAPI.consultations.list(patientId),
        window.MarfanAPI.timeline.echoList(patientId).catch(() => ({ examens: [] }))
      ]);
      _aortic = (rA && rA.aortic) || {};
      _consultations = (rC && rC.consultations) || [];
      _echos = (rE && rE.examens) || [];
      // Expose pour la timeline des actes (renderPatientTimelineActs dans index.html)
      window._patientConsultations = _consultations;
      if (typeof window.renderPatientTimelineActs === 'function') {
        try { window.renderPatientTimelineActs(); } catch (_) {}
      }
    } catch (e) {
      console.warn('[aortic] chargement échoué :', e.message);
      _aortic = {}; _consultations = []; _echos = [];
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

  /**
   * La mesure aortique la plus récente, et d'où elle vient.
   *
   * Priorité au compte rendu d'échocardiographie : c'est le document de
   * référence. À date égale, il l'emporte sur une consultation, qui n'en est
   * qu'une retranscription.
   *
   * Renvoie null plutôt qu'une valeur par défaut : un dossier sans mesure
   * doit s'afficher sans mesure.
   */
  /**
   * Valeurs aortiques hors de toute vraisemblance, encore en base.
   *
   * 13 mm et 19 mm se sont glissés dans deux dossiers sans que rien ne les
   * signale : l'un venait d'un anneau pris pour des sinus, l'autre d'une
   * origine inconnue. Tous deux sont parfaitement plausibles PRIS
   * ISOLÉMENT — c'est ce qui les rend difficiles à voir.
   *
   * La borne dure du serveur reste large (5 à 120 mm) pour ne pas bloquer un
   * dossier pédiatrique. Mais entre « accepté » et « vraisemblable » il y a
   * de la place, et c'est là que vit cet avertissement : permanent, visible
   * tant que la valeur n'a pas été corrigée ou confirmée. Un avertissement
   * qu'on peut rater une fois ne protège de rien.
   */
  /**
   * Une valeur est-elle invraisemblable ? Réponse unique, utilisée partout.
   *
   * Elle existait en double : une fois pour le bandeau d'avertissement, et
   * nulle part ailleurs. Résultat, un diamètre de 13 mm était signalé comme
   * douteux ET servait d'« évaluation actuelle », produisant une évolution
   * de −22 mm affichée en vert, c'est-à-dire comme une amélioration.
   *
   * Signaler une valeur sans l'écarter des calculs est pire que de ne rien
   * signaler : l'avertissement donne l'impression que le problème est traité,
   * pendant que le chiffre faux continue de circuler.
   */
  function estDouteuse(valeur, site) {
    if (valeur == null) return false;
    const x = parseFloat(valeur);
    if (!isFinite(x)) return false;
    const t = String(site || '').toLowerCase();
    const estAnneau = /anneau|annulus/.test(t);
    const estSinus  = !t || /valsalva|racine|sinus/.test(t);
    const planche = estAnneau ? 14 : (estSinus ? 25 : 18);
    return x < planche || x > 90;
  }

  function valeursDouteuses() {
    const out = [];
    // Le seuil dépend du niveau mesuré, parce que les niveaux n'ont pas les
    // mêmes dimensions. Un anneau aortique de 22 mm est normal ; des sinus
    // de Valsalva à 22 mm chez un adulte n'existent pas.
    //
    // Un site non renseigné est traité comme des sinus : c'est ce que ce
    // suivi mesure par défaut, et c'est précisément dans ce cas qu'une
    // mesure prise ailleurs passe inaperçue. Le 19 mm d'un dossier était un
    // anneau enregistré sans son site.
    const juger = (v, date, origine, site) => {
      if (v == null) return;
      const x = parseFloat(v);
      if (!isFinite(x)) return;

      if (!estDouteuse(x, site)) return;
      const s = String(site || '').toLowerCase();
      const estSinus = !s || /valsalva|racine|sinus/.test(s);
      if (x < 91) {
        out.push({ valeur: x, date, origine,
          raison: estSinus
            ? 'trop bas pour des sinus de Valsalva chez un adulte — s\'agit-il de l\'anneau ?'
            : 'inhabituellement bas' + (site ? ' pour : ' + site : '') });
      } else if (x > 90) {
        out.push({ valeur: x, date, origine, raison: 'au-delà de toute valeur attendue' });
      }
    };
    const a = _aortic || {};
    juger(a.first_value_mm, a.first_diagnosis_date, 'valeur de départ', a.first_site);
    (_consultations || []).forEach(c => juger(c.aortic_value_mm, c.consultation_date, 'consultation', c.aortic_site));
    (_echos || []).forEach(e => juger(e.sinus_valsalva_mm, e.exam_date, 'échocardiographie', 'Sinus de Valsalva'));
    return out;
  }

  function bandeauDouteuses() {
    const d = valeursDouteuses();
    if (!d.length) return '';
    const jour = x => { if (!x) return 'date inconnue'; const t = new Date(x);
      return isNaN(t) ? String(x) : t.toLocaleDateString('fr-FR'); };
    return '<div style="padding:12px 15px; margin:0 0 14px; border-radius:10px; background:#fffbeb; ' +
      'border:1px solid #fde68a; border-left:4px solid #f59e0b; font-size:12.5px; color:#92400e; line-height:1.6;">' +
      '<strong>' + d.length + ' valeur(s) aortique(s) à vérifier.</strong><br>' +
      d.map(x => '• <strong>' + x.valeur + ' mm</strong> le ' + jour(x.date) +
                 ' (' + x.origine + ') — ' + x.raison).join('<br>') +
      '<br><span style="font-size:11.5px;">Vérifiez le niveau mesuré sur le compte rendu : ' +
      'un anneau aortique pris pour des sinus de Valsalva donne exactement ce genre de chiffre.</span></div>';
  }

  function mesureLaPlusRecente() {
    const points = [];

    (_echos || []).forEach(e => {
      const v = e.sinus_valsalva_mm != null ? parseFloat(e.sinus_valsalva_mm)
              : (e.aorte_max_mm != null ? parseFloat(e.aorte_max_mm) : null);
      const site = e.aorte_site_max || 'Sinus de Valsalva';
      if (v != null && e.exam_date && !estDouteuse(v, site)) {
        points.push({ date: e.exam_date, valeur: v, site: site,
                      origine: 'échocardiographie', niveau: 'mesure', rang: 2 });
      }
    });

    (_consultations || []).forEach(c => {
      const v = c.aortic_value_mm != null ? parseFloat(c.aortic_value_mm) : null;
      // Une valeur écartée n'entre pas dans le calcul : ni comme mesure
      // actuelle, ni dans l'évolution qu'on en déduirait.
      if (v != null && c.consultation_date && !estDouteuse(v, c.aortic_site)) {
        points.push({ date: c.consultation_date, valeur: v, site: c.aortic_site || null,
                      origine: 'consultation', niveau: 'declaree', rang: 1 });
      }
    });

    if (!points.length) return null;
    points.sort((x, y) => {
      const d = new Date(y.date) - new Date(x.date);
      return d !== 0 ? d : (y.rang - x.rang);
    });
    return points[0];
  }

  // ============================================================
  // === Bloc 1 : Suivi aortique ================================
  // ============================================================
  function renderAorticCard() {
    const a = _aortic || {};
    const firstBrut = a.first_value_mm != null ? parseFloat(a.first_value_mm) : null;
    const firstDouteuse = estDouteuse(firstBrut, a.first_site);
    const first = firstDouteuse ? null : firstBrut;

    // Phase 62 — La valeur « actuelle » n'est plus stockée ici. Elle l'était,
    // recopiée depuis l'écho ou la consultation, et elle divergeait dès que
    // l'originale était corrigée. Elle est maintenant DÉDUITE de la mesure
    // la plus récente, l'échocardiographie ayant priorité sur la
    // consultation à date égale : c'est le document de référence.
    const derniere = mesureLaPlusRecente();
    const curr = derniere ? derniere.valeur : null;
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
            <p style="margin:3px 0 0; font-size:11.5px; opacity:0.92;">Valeur de départ, puis mesure la plus récente — le compte rendu d'échocardiographie fait foi</p>
          </div>
          <button data-ac="edit-aortic" style="padding:7px 13px; border:1px solid rgba(255,255,255,0.35); background:rgba(255,255,255,0.15); color:white; border-radius:8px; font-weight:600; cursor:pointer; font-size:12px; white-space:nowrap;">✏️ Modifier</button>
        </div>
        <div class="ac-body">
          ${bandeauDouteuses()}
          ${derniere ? `<div style="font-size:11.5px; color:#64748b; margin-bottom:10px;">
            Mesure la plus récente : <strong>${derniere.valeur} mm</strong>${derniere.site ? ' — ' + esc(derniere.site) : ''},
            ${derniere.origine}${derniere.niveau === 'declaree' ? ' <span style="color:#92400e; font-weight:700;">(déclarée, non vérifiée)</span>' : ' <span style="color:#065f46; font-weight:700;">(mesurée)</span>'}
          </div>` : ''}
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
                ${derniere ? '📅 ' + fmtDate(derniere.date) : (valeursDouteuses().length
                    ? '<span style="color:#92400e;">valeur écartée, à vérifier</span>' : '—')}
                ${derniere && derniere.site ? '<br>📍 ' + esc(derniere.site) : ''}
                ${derniere ? '<br><span style="font-size:11px;">' + esc(derniere.origine) + '</span>' : ''}
              </div>
              ${alert ? '<div style="margin-top:6px; font-size:11px; font-weight:700; color:#991b1b;">⚠️ Seuil ≥ 45 mm</div>' : ''}
              ${warn  ? '<div style="margin-top:6px; font-size:11px; font-weight:700; color:#92400e;">⚠ Surveillance rapprochée</div>' : ''}
            </div>
            <!-- Évolution -->
            <div style="padding:12px 14px; background:#f8fafc; border-radius:10px; border-left:3px solid ${deltaColor};">
              <div style="font-size:10.5px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; font-weight:700;">Évolution</div>
              <div style="font-size:22px; font-weight:800; color:${deltaColor}; margin-top:4px;">${deltaTxt}</div>
              <div style="font-size:11.5px; color:#64748b; margin-top:3px;">${
                (first != null && curr != null) ? 'Depuis la 1ʳᵉ mesure'
                : (firstDouteuse || valeursDouteuses().length)
                  ? '<span style="color:#92400e;">Non calculée : une valeur a été écartée</span>'
                  : 'Données incomplètes'}</div>
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

            <!-- Phase 62 — La saisie d'une « évaluation actuelle » est retirée.
                 Elle créait une copie qui divergeait de la mesure d'origine
                 dès que celle-ci était corrigée, et personne ne savait plus
                 laquelle croire. Une mesure se saisit là où elle a été
                 faite : dans une consultation, ou dans le compte rendu. -->
            <div style="padding:12px 14px; margin-bottom:16px; border-radius:10px; background:#f0f9ff; border:1px solid #bae6fd; font-size:12.5px; color:#075985; line-height:1.6;">
              <strong>La mesure du jour ne se saisit plus ici.</strong><br>
              Ajoutez-la dans une <strong>consultation</strong>, ou versez le
              <strong>compte rendu d'échocardiographie</strong> — c'est lui qui fait foi.
              La valeur affichée en haut est toujours la plus récente des deux.
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
