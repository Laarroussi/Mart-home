/**
 * medical-record-ui.js — UI Dossier médical structuré
 * ===================================================
 * Expose window.MedicalRecordUI :
 *   mount(containerId, patientId)  → monte la carte dans un élément DOM
 *   refresh(patientId)             → recharge depuis l'API
 *
 * 4 sub-tabs : 📋 Synthèse · ✏️ Édition · 📥 Import PDF · 📜 Historique
 * 8 sections éditables : identity, history, antecedents, patient_goals,
 *                       clinician_goals, key_points, evaluations_summary, sessions_summary
 *
 * L'aperçu PDF affiche les valeurs détectées (par section, avec confiance),
 * permet de cocher/décocher chaque champ avant intégration, et de modifier
 * les valeurs. La sauvegarde appelle /api/medical-records/.../integrate.
 * =================================================== */

(function () {
  'use strict';

  const SECTIONS = [
    { key: 'identity',            label: '👤 Identité',                 fields: [
      ['last_name','Nom'], ['first_name','Prénom'], ['birth_date','Date de naissance'],
      ['age','Âge','number'], ['sex','Sexe'], ['height_cm','Taille (cm)','number'],
      ['weight_kg','Poids (kg)','number'], ['bmi','IMC','number'],
      ['referring_doctor','Médecin référent'], ['phone','Téléphone'], ['email','Email']
    ] },
    { key: 'history',             label: '📖 Histoire de la maladie', fields: [
      ['main_diagnosis','Diagnostic principal'], ['diagnosis_date','Date de diagnostic'],
      ['clinical_context','Contexte clinique','textarea'],
      ['evolution','Évolution','textarea'], ['main_symptoms','Symptômes principaux','textarea'],
      ['functional_limitations','Limitations fonctionnelles','textarea'],
      ['important_events','Événements importants','textarea'], ['comments','Commentaires libres','textarea']
    ] },
    { key: 'antecedents',         label: '🩺 Antécédents', fields: [
      ['medical_text','Antécédents médicaux','textarea'],
      ['surgical_text','Antécédents chirurgicaux','textarea'],
      ['cardio_text','Antécédents cardiovasculaires','textarea'],
      ['respiratory_text','Antécédents respiratoires','textarea'],
      ['family_text','Antécédents familiaux','textarea'],
      ['allergies_text','Allergies','textarea'],
      ['current_treatments_text','Traitements en cours','textarea'],
      ['contraindications','Contre-indications','textarea']
    ] },
    { key: 'patient_goals',       label: '🎯 Objectifs patient', fields: [
      ['expressed_goals','Objectifs exprimés','textarea'],
      ['personal_expectations','Attentes personnelles','textarea'],
      ['functional_goals','Objectifs fonctionnels','textarea'],
      ['quality_of_life','Qualité de vie','textarea'],
      ['personal_constraints','Contraintes personnelles','textarea'],
      ['activity_preferences','Préférences d\'activité','textarea'],
      ['motivation_level','Niveau de motivation'],
      ['fears_concerns','Freins / inquiétudes','textarea']
    ] },
    { key: 'clinician_goals',     label: '🩻 Objectifs soignant', fields: [
      ['medical_goals','Objectifs médicaux','textarea'],
      ['rehab_goals','Objectifs réadaptation','textarea'],
      ['apa_goals','Objectifs APA','textarea'],
      ['prevention_goals','Objectifs de prévention','textarea'],
      ['monitoring_goals','Objectifs de suivi','textarea'],
      ['parameters_to_monitor','Paramètres à surveiller','textarea'],
      ['special_instructions','Consignes particulières','textarea'],
      ['intensity_limits','Limites d\'intensité / précautions','textarea']
    ] },
    { key: 'key_points',          label: '⚠️ Points clés', fields: [
      ['main_diagnosis','Diagnostic principal'],
      ['risk_level','Niveau de risque'],
      ['hr_max','FC max (bpm)','number'],
      ['hr_target','FC cible (bpm)','number'],
      ['vo2_max_ml_kg_min','VO₂ max/peak (ml/kg/min)','number'],
      ['sv1_t','SV1 (s)','number'],
      ['sv2_t','SV2 (s)','number'],
      ['ve_vco2_slope','VE/VCO₂ slope','number'],
      ['oues','OUES','number'],
      ['ftpwv_m_s','VOP / PWV (m/s)','number'],
      ['aix75','AIx@75 (%)','number'],
      ['sbp','PA systolique (mmHg)','number'],
      ['dbp','PA diastolique (mmHg)','number'],
      ['important_treatment','Traitement important','textarea'],
      ['contraindication','Contre-indication','textarea'],
      ['clinical_alert','Alerte clinique','textarea'],
      ['special_note','Consigne particulière','textarea']
    ] },
    { key: 'evaluations_summary', label: '📊 Résumé évaluations', fields: [
      ['cpet_text','CPET / test d\'effort','textarea'],
      ['echo_text','Échocardiographie','textarea'],
      ['pulse_wave_text','Onde de pouls','textarea'],
      ['biology_text','Biologie','textarea'],
      ['questionnaires_text','Questionnaires','textarea'],
      ['functional_tests_text','Tests fonctionnels','textarea'],
      ['other_evaluations','Autres évaluations','textarea']
    ] },
    { key: 'sessions_summary',    label: '🏋️ Résumé séances', fields: [
      ['total_sessions','Nombre total de séances','number'],
      ['last_session_date','Dernière séance'],
      ['last_session_type','Type'],
      ['avg_duration_min','Durée moyenne (min)','number'],
      ['avg_intensity','Intensité moyenne'],
      ['avg_hr','FC moyenne (bpm)','number'],
      ['max_hr','FC max observée (bpm)','number'],
      ['avg_rpe','RPE moyen','number'],
      ['symptoms','Symptômes signalés','textarea'],
      ['incidents','Incidents éventuels','textarea'],
      ['progression','Progression','textarea'],
      ['patient_comments','Commentaires patient','textarea'],
      ['clinician_comments','Commentaires soignant','textarea']
    ] }
  ];

  let _state = { patientId: null, record: null, docs: [], activeTab: 'synthese', activeSection: 'identity', extractPreview: null };

  // =============================================================
  // === API + montage ===========================================
  // =============================================================
  async function load(patientId) {
    _state.patientId = patientId;
    const r = await window.MarfanAPI.medicalRecords.get(patientId);
    _state.record = r.record || {};
    try {
      const d = await window.MarfanAPI.medicalRecords.listDocuments(patientId);
      _state.docs = d.documents || [];
    } catch (e) { _state.docs = []; }
  }

  async function mount(containerId, patientId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `<div style="padding:14px; text-align:center; color:#64748b;">Chargement du dossier médical…</div>`;
    try {
      await load(patientId);
      el.innerHTML = renderRoot();
      bindHandlers(el);
    } catch (e) {
      el.innerHTML = `<div style="padding:14px; color:#dc2626;">Erreur de chargement : ${e.message}</div>`;
    }
  }

  async function refresh() {
    if (!_state.patientId) return;
    await load(_state.patientId);
    const el = document.querySelector('[data-medrec-root]');
    if (el) {
      el.innerHTML = renderInner();
      bindHandlers(el);
    }
  }

  // =============================================================
  // === Rendu : carte principale ================================
  // =============================================================
  function renderRoot() {
    return `
      <article class="card" data-medrec-root style="padding:0; margin-bottom:14px; overflow:hidden;">
        ${renderInner()}
      </article>
      <style>
        [data-medrec-root] .mr-tab { padding:8px 14px; border:1px solid #e2e8f0; background:white; color:#475569; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px; }
        [data-medrec-root] .mr-tab.active { background:linear-gradient(135deg,#0891b2,#06b6d4); color:white; border-color:transparent; }
        [data-medrec-root] .mr-section-tab { padding:6px 10px; border:1px solid #e2e8f0; background:white; color:#475569; border-radius:7px; cursor:pointer; font-weight:600; font-size:11px; }
        [data-medrec-root] .mr-section-tab.active { background:#0891b2; color:white; border-color:transparent; }
        [data-medrec-root] .mr-card { background:white; border:1px solid #e2e8f0; border-radius:10px; padding:12px 14px; }
        [data-medrec-root] .mr-syn-block { background:white; border:1px solid #e2e8f0; border-left:3px solid #0891b2; border-radius:8px; padding:10px 12px; margin-bottom:10px; }
        [data-medrec-root] .mr-syn-block h5 { margin:0 0 6px; font-size:12px; color:#0b1530; }
        [data-medrec-root] .mr-syn-row { display:flex; justify-content:space-between; padding:3px 0; font-size:11.5px; border-bottom:1px dashed #eef0f5; }
        [data-medrec-root] .mr-syn-row .lab { color:#64748b; }
        [data-medrec-root] .mr-syn-row .val { font-weight:600; color:#0b1530; }
        [data-medrec-root] .mr-field { margin-bottom:8px; }
        [data-medrec-root] .mr-field label { display:block; font-size:11px; color:#475569; font-weight:600; margin-bottom:3px; }
        [data-medrec-root] .mr-field input, [data-medrec-root] .mr-field textarea { width:100%; padding:7px 9px; border:1px solid #cbd5e1; border-radius:6px; font-size:12.5px; font-family:inherit; }
        [data-medrec-root] .mr-field textarea { min-height:55px; resize:vertical; }
        [data-medrec-root] .mr-source-badge { display:inline-block; padding:1px 6px; border-radius:10px; font-size:10px; font-weight:600; margin-left:4px; }
        [data-medrec-root] .src-manual { background:#dbeafe; color:#1e40af; }
        [data-medrec-root] .src-pdf { background:#fef3c7; color:#92400e; }
        [data-medrec-root] .src-cpet { background:#dcfce7; color:#166534; }
        [data-medrec-root] .src-pulse_wave { background:#fce7f3; color:#9d174d; }
        [data-medrec-root] .conf-high { color:#16a34a; }
        [data-medrec-root] .conf-medium { color:#d97706; }
        [data-medrec-root] .conf-low { color:#dc2626; }
      </style>`;
  }

  function renderInner() {
    return `
      <div style="padding:18px 22px; background:linear-gradient(135deg,#0891b2,#06b6d4); color:white;">
        <h3 style="margin:0; color:white; font-size:17px;">📑 Dossier médical structuré</h3>
        <p style="margin:4px 0 0; font-size:12px;">Données identitaires, antécédents, objectifs, points clés et synthèse — saisie manuelle ou import PDF avec extraction automatique.</p>
      </div>

      <!-- Sub-tabs principaux -->
      <div style="padding:12px 22px; background:#f8fafc; border-bottom:1px solid #e2e8f0; display:flex; gap:8px; flex-wrap:wrap;">
        ${['synthese','edition','import','historique'].map(t => `
          <button class="mr-tab ${_state.activeTab === t ? 'active' : ''}" data-mr-tab="${t}">
            ${t === 'synthese' ? '📋 Synthèse' : t === 'edition' ? '✏️ Édition' : t === 'import' ? '📥 Import PDF' : '📜 Historique'}
          </button>
        `).join('')}
      </div>

      <div style="padding:14px 22px; background:white;">
        ${_state.activeTab === 'synthese' ? renderSynthese() :
          _state.activeTab === 'edition' ? renderEdition() :
          _state.activeTab === 'import' ? renderImport() :
          renderHistorique()}
      </div>
    `;
  }

  // =============================================================
  // === Sub-tab : Synthèse ======================================
  // =============================================================
  function renderSynthese() {
    const rec = _state.record || {};
    const block = (title, sectionKey, fields) => {
      const data = rec[sectionKey] || {};
      const rows = fields.map(([key, label]) => {
        const v = data[key];
        if (v == null || v === '') return '';
        const text = typeof v === 'string' && v.length > 120 ? v.substring(0, 120) + '…' : v;
        return `<div class="mr-syn-row"><span class="lab">${label}</span><span class="val">${text}</span></div>`;
      }).filter(Boolean).join('');
      if (!rows) return `<div class="mr-syn-block"><h5>${title}</h5><div style="font-size:11px; color:#94a3b8; font-style:italic;">— non renseigné</div></div>`;
      return `<div class="mr-syn-block"><h5>${title}</h5>${rows}</div>`;
    };
    return `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        ${block('👤 Identité', 'identity', SECTIONS[0].fields)}
        ${block('📖 Histoire de la maladie', 'history', SECTIONS[1].fields.slice(0, 5))}
        ${block('🩺 Antécédents', 'antecedents', SECTIONS[2].fields)}
        ${block('🎯 Objectifs patient', 'patient_goals', SECTIONS[3].fields.slice(0, 4))}
        ${block('🩻 Objectifs soignant', 'clinician_goals', SECTIONS[4].fields.slice(0, 4))}
        <div style="grid-column:1/-1;">${block('⚠️ Points clés (à retenir)', 'key_points', SECTIONS[5].fields)}</div>
        ${block('📊 Résumé évaluations', 'evaluations_summary', SECTIONS[6].fields)}
        ${block('🏋️ Résumé séances', 'sessions_summary', SECTIONS[7].fields)}
      </div>`;
  }

  // =============================================================
  // === Sub-tab : Édition =======================================
  // =============================================================
  function renderEdition() {
    const sec = SECTIONS.find(s => s.key === _state.activeSection) || SECTIONS[0];
    const data = (_state.record || {})[sec.key] || {};
    const sources = ((_state.record || {}).sources || {})[sec.key] || {};
    return `
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
        ${SECTIONS.map(s => `<button class="mr-section-tab ${s.key === _state.activeSection ? 'active' : ''}" data-mr-section="${s.key}">${s.label}</button>`).join('')}
      </div>
      <form data-mr-form="${sec.key}">
        ${sec.fields.map(([key, label, type]) => {
          const v = data[key] != null ? data[key] : '';
          const src = sources[key];
          const badge = src ? `<span class="mr-source-badge src-${src.source || 'manual'}">${(src.source||'manual')}</span>` : '';
          if (type === 'textarea') {
            return `<div class="mr-field"><label>${label}${badge}</label><textarea name="${key}">${escapeHtml(String(v))}</textarea></div>`;
          }
          return `<div class="mr-field"><label>${label}${badge}</label><input type="${type || 'text'}" name="${key}" value="${escapeHtml(String(v))}"></div>`;
        }).join('')}
        <div style="margin-top:12px; display:flex; gap:10px; justify-content:flex-end;">
          <button type="button" data-mr-action="reset" style="padding:8px 16px; border:1px solid #cbd5e1; background:white; color:#475569; border-radius:7px; font-weight:600; cursor:pointer; font-size:12px;">↺ Annuler</button>
          <button type="submit" style="padding:8px 18px; border:none; background:linear-gradient(135deg,#0891b2,#06b6d4); color:white; border-radius:7px; font-weight:700; cursor:pointer; font-size:12.5px;">💾 Enregistrer la section</button>
        </div>
      </form>`;
  }

  // =============================================================
  // === Sub-tab : Import PDF ====================================
  // =============================================================
  function renderImport() {
    const recentDocs = _state.docs.slice(0, 6);
    return `
      <div class="mr-card" style="margin-bottom:14px;">
        <h4 style="margin:0 0 6px; font-size:13px;">📥 Importer un dossier médical PDF</h4>
        <p style="font-size:11.5px; color:#64748b; margin:0 0 10px;">Le système extraira automatiquement le texte et classera les informations dans les bonnes sections. <strong>Aucune intégration définitive n'est faite avant votre validation</strong>.</p>
        <div id="mrDropZone" style="padding:20px; border:2px dashed #c4b5fd; border-radius:10px; background:#faf5ff; text-align:center; cursor:pointer;">
          <div style="font-size:30px;">📄</div>
          <div style="font-weight:600; color:#5b21b6; margin-top:4px;">Glissez un PDF ici ou cliquez pour parcourir</div>
          <div style="font-size:11px; color:#7c3aed; margin-top:4px;">PDF texte lisible · max 12 MB · OCR scanné prévu en Phase 12.2</div>
          <input id="mrPdfFile" type="file" accept=".pdf,application/pdf" style="display:none;">
        </div>
        <div id="mrExtractStatus" style="margin-top:10px;"></div>
      </div>

      ${recentDocs.length ? `
        <div class="mr-card">
          <h4 style="margin:0 0 8px; font-size:13px;">📚 PDFs importés récemment</h4>
          ${recentDocs.map(d => renderDocRow(d)).join('')}
        </div>
      ` : ''}
    `;
  }

  function renderDocRow(d) {
    const st = {
      pending: { color:'#d97706', label:'⏳ En attente' },
      reviewed: { color:'#0891b2', label:'👁 Revu' },
      integrated: { color:'#16a34a', label:'✓ Intégré' },
      rejected: { color:'#dc2626', label:'✕ Rejeté' },
      partial: { color:'#7c3aed', label:'◐ Partiel' }
    }[d.status] || { color:'#64748b', label:d.status };
    return `
      <div style="padding:8px 10px; border:1px solid #e2e8f0; border-radius:7px; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <div style="min-width:0; flex:1;">
          <div style="font-weight:600; font-size:12.5px; color:#0b1530; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📄 ${escapeHtml(d.file_name)}</div>
          <div style="font-size:10.5px; color:#64748b;">${d.file_size_kb || '?'} KB · ${new Date(d.uploaded_at).toLocaleString('fr-FR')}</div>
        </div>
        <span style="font-size:11px; font-weight:600; color:${st.color};">${st.label}</span>
        <button data-mr-doc-open="${d.id}" style="padding:5px 10px; border:1px solid #cbd5e1; background:white; color:#0b1530; border-radius:6px; font-weight:600; cursor:pointer; font-size:11px;">Ouvrir</button>
      </div>`;
  }

  // =============================================================
  // === Sub-tab : Historique ====================================
  // =============================================================
  function renderHistorique() {
    const mods = (_state.record && _state.record.modifications) || [];
    if (!mods.length) return `<div style="padding:14px; text-align:center; color:#64748b; font-style:italic;">Aucune modification enregistrée.</div>`;
    const recent = mods.slice(-50).reverse();
    return `
      <div style="font-size:11.5px;">
        ${recent.map(m => `
          <div style="padding:6px 10px; border-bottom:1px dashed #eef0f5; display:flex; gap:10px; justify-content:space-between;">
            <div style="flex:1; min-width:0;">
              <strong style="color:#0b1530;">${m.section}.${m.field}</strong>
              <span class="mr-source-badge src-${m.source||'manual'}">${m.source||'manual'}</span><br>
              <span style="color:#94a3b8; text-decoration:line-through;">${m.old != null ? escapeHtml(String(m.old)).substring(0, 80) : '∅'}</span>
              → <strong>${m.new != null ? escapeHtml(String(m.new)).substring(0, 80) : '∅'}</strong>
              ${m.comment ? `<br><em style="color:#64748b;">"${escapeHtml(m.comment)}"</em>` : ''}
            </div>
            <div style="color:#94a3b8; font-size:10.5px; text-align:right; white-space:nowrap;">${new Date(m.at).toLocaleString('fr-FR')}<br><code>${(m.by||'').substring(0,12)}</code></div>
          </div>`).join('')}
      </div>`;
  }

  // =============================================================
  // === Aperçu PDF avant intégration ============================
  // =============================================================
  function openExtractPreviewModal(extracted, fullText, docMetadata) {
    const sectionsToShow = SECTIONS.map(s => {
      const data = extracted[s.key] || {};
      const meta = extracted._extraction_meta || {};
      const rows = Object.keys(data).filter(k => k !== '_text' && k !== '_text_full_length').map(k => {
        const v = data[k];
        const m = meta[s.key + '.' + k];
        return {
          key: k, label: k.replace(/_/g, ' '), value: v,
          confidence: (m && m.confidence) || 'low',
          extract: m && m.extract
        };
      });
      return { key: s.key, label: s.label, rows, freeText: data._text };
    }).filter(s => s.rows.length || s.freeText);

    const html = `
      <div id="mrExtractModal" style="position:fixed; inset:0; background:rgba(11,21,48,0.85); z-index:10015; display:flex; flex-direction:column; padding:14px;">
        <div style="background:white; border-radius:12px 12px 0 0; padding:14px 22px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e8f0;">
          <div>
            <h3 style="margin:0; font-size:17px;">🔍 Aperçu des données extraites — ${escapeHtml(docMetadata.fileName)}</h3>
            <p style="margin:3px 0 0; font-size:11.5px; color:#64748b;">Cochez les champs à intégrer · modifiez les valeurs si besoin · rien n'est sauvegardé tant que vous ne cliquez pas "Intégrer".</p>
          </div>
          <div>
            <button onclick="window.__mrShowRawText()" style="padding:7px 13px; border:1px solid #cbd5e1; background:white; color:#475569; border-radius:8px; font-weight:600; cursor:pointer; font-size:12px; margin-right:6px;">📄 Voir texte extrait</button>
            <button onclick="document.getElementById('mrExtractModal').remove()" style="padding:7px 13px; border:none; background:#f1f5f9; color:#475569; border-radius:8px; font-weight:600; cursor:pointer; font-size:12px;">✕ Annuler</button>
          </div>
        </div>

        <div style="flex:1; overflow-y:auto; padding:14px 22px; background:#fafbfd;">
          ${sectionsToShow.length === 0 ? `<div style="padding:30px; text-align:center; color:#dc2626;">Aucune information structurée détectée. Le PDF peut être scanné ou mal formaté.</div>` :
          sectionsToShow.map(sec => `
            <div class="mr-card" style="margin-bottom:12px;">
              <h4 style="margin:0 0 8px; font-size:13px; display:flex; align-items:center; gap:8px;">
                <input type="checkbox" data-mr-section-toggle="${sec.key}" checked style="transform:scale(1.2);"> ${sec.label}
              </h4>
              ${sec.rows.length ? `<table style="width:100%; border-collapse:collapse; font-size:12px;">
                <thead><tr style="border-bottom:1px solid #e2e8f0;">
                  <th style="text-align:left; padding:4px 6px; width:40px;">✓</th>
                  <th style="text-align:left; padding:4px 6px;">Champ</th>
                  <th style="text-align:left; padding:4px 6px;">Valeur extraite</th>
                  <th style="text-align:left; padding:4px 6px; width:80px;">Confiance</th>
                </tr></thead>
                <tbody>
                ${sec.rows.map(r => `
                  <tr style="border-bottom:1px dashed #eef0f5;">
                    <td style="padding:4px 6px;"><input type="checkbox" data-mr-row="${sec.key}.${r.key}" checked></td>
                    <td style="padding:4px 6px; color:#64748b;">${escapeHtml(r.label)}</td>
                    <td style="padding:4px 6px;"><input type="text" data-mr-val="${sec.key}.${r.key}" value="${escapeHtml(String(r.value))}" style="width:100%; padding:3px 5px; border:1px solid #cbd5e1; border-radius:4px; font-size:11.5px;"></td>
                    <td style="padding:4px 6px;"><span class="conf-${r.confidence}" style="font-weight:600; font-size:11px;">${r.confidence}</span></td>
                  </tr>`).join('')}
                </tbody>
              </table>` : ''}
              ${sec.freeText ? `<details style="margin-top:8px;"><summary style="cursor:pointer; font-size:11px; color:#7c3aed; font-weight:600;">📝 Texte intégral de la section</summary><div style="margin-top:6px; padding:8px; background:#f8fafc; border-radius:6px; font-size:11px; color:#475569; white-space:pre-wrap; max-height:200px; overflow-y:auto;">${escapeHtml(sec.freeText)}</div></details>` : ''}
            </div>
          `).join('')}
        </div>

        <div style="background:white; border-radius:0 0 12px 12px; padding:12px 22px; display:flex; gap:10px; justify-content:flex-end; border-top:1px solid #e2e8f0;">
          <input type="text" id="mrExtractComment" placeholder="Commentaire (facultatif)" style="flex:1; padding:8px 10px; border:1px solid #cbd5e1; border-radius:7px; font-size:12px;">
          <button onclick="window.__mrRejectExtract()" style="padding:9px 18px; border:1px solid #dc2626; background:white; color:#dc2626; border-radius:8px; font-weight:600; cursor:pointer; font-size:12.5px;">🗑 Rejeter</button>
          <button onclick="window.__mrSaveDraft()" style="padding:9px 18px; border:1px solid #2563eb; background:white; color:#2563eb; border-radius:8px; font-weight:600; cursor:pointer; font-size:12.5px;">💾 Brouillon</button>
          <button onclick="window.__mrIntegrateExtract()" style="padding:9px 22px; border:none; background:linear-gradient(135deg,#10b981,#059669); color:white; border-radius:8px; font-weight:700; cursor:pointer; font-size:12.5px;">✓ Intégrer au dossier</button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);

    // Stocke contexte pour les boutons
    _state.extractPreview = { extracted, fullText, docMetadata };

    // Toggle section -> coche/décoche toutes les lignes
    document.querySelectorAll('[data-mr-section-toggle]').forEach(cb => {
      cb.addEventListener('change', () => {
        const sec = cb.dataset.mrSectionToggle;
        document.querySelectorAll(`[data-mr-row^="${sec}."]`).forEach(r => r.checked = cb.checked);
      });
    });
  }

  // =============================================================
  // === Handlers (clics, soumissions) ===========================
  // =============================================================
  function bindHandlers(rootEl) {
    // Sub-tabs principaux
    rootEl.querySelectorAll('[data-mr-tab]').forEach(b => {
      b.addEventListener('click', () => { _state.activeTab = b.dataset.mrTab; rerenderInner(); });
    });
    // Section tabs (édition)
    rootEl.querySelectorAll('[data-mr-section]').forEach(b => {
      b.addEventListener('click', () => { _state.activeSection = b.dataset.mrSection; rerenderInner(); });
    });
    // Formulaire édition
    rootEl.querySelectorAll('[data-mr-form]').forEach(form => {
      const sectionKey = form.dataset.mrForm;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {};
        new FormData(form).forEach((v, k) => { if (v !== '') data[k] = v; });
        // Convertit les numériques
        SECTIONS.find(s => s.key === sectionKey).fields.forEach(([key, _, type]) => {
          if (type === 'number' && data[key]) data[key] = parseFloat(data[key]);
        });
        try {
          await window.MarfanAPI.medicalRecords.patchSection(_state.patientId, sectionKey, data, 'manual', null, null);
          alert('✓ Section "' + sectionKey + '" enregistrée.');
          await refresh();
        } catch (e) { alert('Erreur : ' + e.message); }
      });
      form.querySelector('[data-mr-action="reset"]').addEventListener('click', () => rerenderInner());
    });
    // Import PDF
    const dropZone = rootEl.querySelector('#mrDropZone');
    const fileInput = rootEl.querySelector('#mrPdfFile');
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.background = '#ede9fe'; });
      dropZone.addEventListener('dragleave', () => { dropZone.style.background = '#faf5ff'; });
      dropZone.addEventListener('drop', e => {
        e.preventDefault(); dropZone.style.background = '#faf5ff';
        if (e.dataTransfer.files && e.dataTransfer.files[0]) handlePdfFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', () => { if (fileInput.files[0]) handlePdfFile(fileInput.files[0]); });
    }
    // Ouvrir un doc
    rootEl.querySelectorAll('[data-mr-doc-open]').forEach(b => {
      b.addEventListener('click', () => openExistingDoc(parseInt(b.dataset.mrDocOpen, 10)));
    });
  }

  function rerenderInner() {
    const el = document.querySelector('[data-medrec-root]');
    if (el) { el.innerHTML = renderInner(); bindHandlers(el); }
  }

  // =============================================================
  // === Pipeline import PDF =====================================
  // =============================================================
  async function handlePdfFile(file) {
    const statusEl = document.getElementById('mrExtractStatus');
    if (!window.PDFExtractor) { statusEl.innerHTML = `<div style="background:#fee2e2; color:#991b1b; padding:8px; border-radius:7px; font-size:11.5px;">✖ Module pdf-extractor non chargé</div>`; return; }
    if (file.size > 12 * 1024 * 1024) { statusEl.innerHTML = `<div style="background:#fee2e2; color:#991b1b; padding:8px; border-radius:7px; font-size:11.5px;">✖ Fichier > 12 MB</div>`; return; }

    statusEl.innerHTML = `<div style="background:#dbeafe; color:#1e40af; padding:8px; border-radius:7px; font-size:11.5px;">⏳ Extraction du texte en cours…</div>`;
    try {
      const r = await window.PDFExtractor.extractAll(file);
      if (r.isScanned) {
        statusEl.innerHTML = `<div style="background:#fef3c7; color:#92400e; padding:8px; border-radius:7px; font-size:11.5px;">⚠ Le PDF semble scanné — l'OCR n'est pas encore activé (Phase 12.2). Une validation manuelle est requise.</div>`;
      } else {
        statusEl.innerHTML = `<div style="background:#dcfce7; color:#166534; padding:8px; border-radius:7px; font-size:11.5px;">✓ Extraction réussie (${r.pages.length} pages, ${r.fullText.length} caractères). Ouverture de l'aperçu…</div>`;
      }
      openExtractPreviewModal(r.extracted_data, r.fullText, { fileName: file.name, file, isScanned: r.isScanned });
    } catch (e) {
      console.error(e);
      statusEl.innerHTML = `<div style="background:#fee2e2; color:#991b1b; padding:8px; border-radius:7px; font-size:11.5px;">✖ Échec de l'extraction : ${e.message}</div>`;
    }
  }

  async function openExistingDoc(docId) {
    try {
      const r = await window.MarfanAPI.medicalRecords.getDocument(_state.patientId, docId);
      const d = r.document;
      const extracted = d.extracted_data || {};
      openExtractPreviewModal(extracted, d.extracted_text || '', { fileName: d.file_name, docId, savedStatus: d.status });
    } catch (e) { alert('Erreur : ' + e.message); }
  }

  // =============================================================
  // === Actions sur la modale d'aperçu ==========================
  // =============================================================
  window.__mrShowRawText = function () {
    const p = _state.extractPreview;
    if (!p) return;
    const w = window.open('', '_blank');
    w.document.write('<pre style="white-space:pre-wrap; font-family:system-ui; padding:20px; max-width:800px; margin:auto;">' +
      (p.fullText || '').replace(/</g, '&lt;') + '</pre>');
  };

  function collectSelectedSections() {
    const p = _state.extractPreview;
    if (!p) return null;
    const result = {};
    document.querySelectorAll('[data-mr-section-toggle]').forEach(cb => {
      if (!cb.checked) return;
      const secKey = cb.dataset.mrSectionToggle;
      const secData = {};
      document.querySelectorAll(`[data-mr-row^="${secKey}."]`).forEach(row => {
        if (!row.checked) return;
        const fullKey = row.dataset.mrRow;
        const fieldKey = fullKey.substring(secKey.length + 1);
        const valEl = document.querySelector(`[data-mr-val="${secKey}.${fieldKey}"]`);
        if (valEl && valEl.value !== '') {
          const val = valEl.value;
          // Tente de convertir en nombre si la valeur originale était numérique
          const orig = (p.extracted[secKey] || {})[fieldKey];
          secData[fieldKey] = typeof orig === 'number' && !isNaN(parseFloat(val)) ? parseFloat(val) : val;
        }
      });
      // Ajoute le texte de la section s'il existe
      const origTxt = (p.extracted[secKey] || {})._text;
      if (origTxt) secData._text_from_pdf = origTxt;
      if (Object.keys(secData).length) result[secKey] = secData;
    });
    return result;
  }

  window.__mrIntegrateExtract = async function () {
    const p = _state.extractPreview;
    if (!p) return;
    const sectionsToIntegrate = collectSelectedSections();
    if (!sectionsToIntegrate || !Object.keys(sectionsToIntegrate).length) {
      alert('Aucune donnée sélectionnée à intégrer.'); return;
    }
    const comment = (document.getElementById('mrExtractComment') || {}).value || null;
    try {
      let docId = p.docMetadata.docId;
      // S'il n'y a pas encore de docId, on upload d'abord
      if (!docId) {
        const base64 = await window.PDFExtractor.fileToBase64(p.docMetadata.file);
        const u = await window.MarfanAPI.medicalRecords.uploadDocument(_state.patientId, {
          file_name: p.docMetadata.fileName,
          file_size_kb: Math.round(p.docMetadata.file.size / 1024),
          file_mime: 'application/pdf',
          raw_file: base64,
          extracted_text: p.fullText,
          extracted_data: p.extracted,
          ocr_used: false
        });
        docId = u.document.id;
      }
      await window.MarfanAPI.medicalRecords.integrate(_state.patientId, docId, sectionsToIntegrate, comment);
      alert('✓ Données intégrées au dossier médical.');
      document.getElementById('mrExtractModal').remove();
      await refresh();
    } catch (e) { alert('Erreur : ' + e.message); }
  };

  window.__mrSaveDraft = async function () {
    const p = _state.extractPreview;
    if (!p) return;
    if (p.docMetadata.docId) { alert('Document déjà enregistré comme brouillon.'); return; }
    try {
      const base64 = await window.PDFExtractor.fileToBase64(p.docMetadata.file);
      await window.MarfanAPI.medicalRecords.uploadDocument(_state.patientId, {
        file_name: p.docMetadata.fileName,
        file_size_kb: Math.round(p.docMetadata.file.size / 1024),
        file_mime: 'application/pdf',
        raw_file: base64,
        extracted_text: p.fullText,
        extracted_data: p.extracted,
        ocr_used: false
      });
      alert('✓ Brouillon enregistré (statut "pending"). Vous pourrez l\'ouvrir et l\'intégrer plus tard.');
      document.getElementById('mrExtractModal').remove();
      await refresh();
    } catch (e) { alert('Erreur : ' + e.message); }
  };

  window.__mrRejectExtract = async function () {
    const p = _state.extractPreview;
    if (!p) return;
    if (!confirm('Rejeter ce document ? Il sera marqué comme rejeté.')) return;
    try {
      if (p.docMetadata.docId) {
        await window.MarfanAPI.medicalRecords.reject(_state.patientId, p.docMetadata.docId, 'Rejeté depuis l\'aperçu');
      }
      document.getElementById('mrExtractModal').remove();
      await refresh();
    } catch (e) { alert('Erreur : ' + e.message); }
  };

  // =============================================================
  // === Utils ===================================================
  // =============================================================
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }

  // =============================================================
  // === Exports =================================================
  // =============================================================
  window.MedicalRecordUI = { mount, refresh, SECTIONS };

})();
