/**
 * document-import.js — Versement de pièces médicales + extraction assistée par IA
 * ==============================================================================
 * Expose window.DocImport :
 *   mount(containerId, patientId)  → carte « Pièces du dossier médical »
 *   ouvrir(patientId, options)     → ouvre directement le sélecteur de fichier
 *
 * Parcours :
 *   1. Le soignant verse un fichier (PDF, image, texte, CSV, Word, Excel)
 *   2. Le texte est extrait DANS LE NAVIGATEUR (pdf.js / FileReader / SheetJS)
 *   3. Le texte part au serveur, qui masque l'identité puis interroge l'IA
 *   4. L'IA PROPOSE des faits datés — rien n'est enregistré à ce stade
 *   5. Le soignant relit, décoche ce qui est faux, corrige, puis valide
 *   6. Les faits validés rejoignent la chronologie du patient et le tableau BDD
 *
 * L'IA ne décide jamais seule : toute donnée d'étude passe par une relecture.
 * ============================================================================== */

(function () {
  'use strict';

  let _patientId = null;
  let _faits = [];
  let _docNom = '';

  const CATEGORIES = {
    mesure:     { l: 'Mesure',      c: '#0891b2', i: '📏' },
    biologie:   { l: 'Biologie',    c: '#7c3aed', i: '🧪' },
    traitement: { l: 'Traitement',  c: '#16a34a', i: '💊' },
    operation:  { l: 'Opération',   c: '#dc2626', i: '🔪' },
    examen:     { l: 'Examen',      c: '#2563eb', i: '🩺' },
    diagnostic: { l: 'Diagnostic',  c: '#b45309', i: '📌' },
    autre:      { l: 'Autre',       c: '#64748b', i: '📄' }
  };

  const esc = s => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

  const fmtDate = d => {
    if (!d) return 'Date inconnue';
    try { return new Date(d).toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' }); }
    catch (_) { return d; }
  };

  // ============================================================
  // === Lecture du fichier : extraction du texte ===============
  // ============================================================
  async function lireTexte(file) {
    const nom = (file.name || '').toLowerCase();
    const type = file.type || '';

    // PDF — pdf.js, déjà chargé dans la page
    if (type === 'application/pdf' || nom.endsWith('.pdf')) {
      if (window.PDFExtractor && window.PDFExtractor.extractTextFromFile) {
        const t = await window.PDFExtractor.extractTextFromFile(file);
        return { texte: t || '', mode: 'pdf' };
      }
      throw new Error("Lecteur PDF indisponible. Rechargez la page et réessayez.");
    }

    // Texte brut, CSV, JSON, HTML
    if (type.startsWith('text/') || /\.(txt|csv|tsv|json|md|htm|html|rtf)$/.test(nom)) {
      const t = await file.text();
      return { texte: t, mode: 'texte' };
    }

    // Tableurs — SheetJS si présent
    if (/\.(xlsx|xls|xlsm)$/.test(nom)) {
      if (typeof XLSX === 'undefined') throw new Error("Lecteur Excel indisponible dans cette page.");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      let t = '';
      wb.SheetNames.forEach(n => {
        t += '\n--- Feuille : ' + n + ' ---\n' + XLSX.utils.sheet_to_csv(wb.Sheets[n]);
      });
      return { texte: t, mode: 'tableur' };
    }

    // Word .docx — le texte vit dans word/document.xml de l'archive
    if (/\.docx$/.test(nom)) {
      if (typeof JSZip === 'undefined') {
        throw new Error("Lecteur Word indisponible. Enregistrez le document en PDF puis réessayez.");
      }
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const xml = await zip.file('word/document.xml').async('string');
      const t = xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ' ')
                   .replace(/[ \t]+/g, ' ').trim();
      return { texte: t, mode: 'word' };
    }

    // Images — pas de texte extractible sans OCR
    if (type.startsWith('image/')) {
      throw new Error("Les images et documents scannés ne contiennent pas de texte lisible automatiquement. Utilisez un PDF contenant du texte, ou saisissez les données manuellement.");
    }

    throw new Error('Format non pris en charge : ' + (nom.split('.').pop() || type));
  }

  // ============================================================
  // === Carte « Pièces du dossier médical » ====================
  // ============================================================
  async function mount(containerId, patientId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    _patientId = patientId;

    let faits = [];
    try {
      const r = await window.MarfanAPI.timeline.list(patientId);
      faits = (r && r.faits) || [];
    } catch (e) { console.warn('[docimport] chronologie :', e && e.message); }

    el.innerHTML = rendreCarte(patientId, faits);
    const input = el.querySelector('[data-di-input]');
    const bouton = el.querySelector('[data-di-btn]');
    if (bouton && input) {
      bouton.addEventListener('click', () => input.click());
      input.addEventListener('change', async () => {
        if (input.files && input.files[0]) await traiter(input.files[0], patientId);
        input.value = '';
      });
    }
    el.querySelectorAll('[data-di-suppr]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Supprimer définitivement cette donnée de la chronologie ?')) return;
        try {
          await window.MarfanAPI.timeline.remove(patientId, b.dataset.diSuppr);
          mount(containerId, patientId);
        } catch (e) { alert('Suppression impossible : ' + e.message); }
      });
    });
  }

  function rendreCarte(patientId, faits) {
    const parAnnee = {};
    faits.forEach(f => {
      const cle = f.event_date ? String(f.event_date).slice(0, 4) : 'Date inconnue';
      (parAnnee[cle] = parAnnee[cle] || []).push(f);
    });
    const annees = Object.keys(parAnnee).sort((a, b) => b.localeCompare(a));

    const corps = faits.length ? annees.map(an => `
      <div style="margin-bottom:14px;">
        <div style="font-size:11.5px; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:.5px; padding:5px 0; border-bottom:1px solid #e2e8f0; margin-bottom:8px;">${esc(an)}</div>
        ${parAnnee[an].map(f => {
          const cat = CATEGORIES[f.category] || CATEGORIES.autre;
          const valeur = f.value_num != null
            ? (f.value_num + (f.unit ? ' ' + f.unit : ''))
            : (f.value_text || '');
          return `
          <div style="display:flex; align-items:start; gap:10px; padding:8px 10px; border-radius:8px; background:#f8fafc; margin-bottom:5px;">
            <span title="${esc(cat.l)}" style="flex:0 0 auto; width:26px; height:26px; border-radius:7px; background:${cat.c}1a; display:flex; align-items:center; justify-content:center; font-size:13px;">${cat.i}</span>
            <div style="flex:1; min-width:0;">
              <div style="display:flex; gap:8px; align-items:baseline; flex-wrap:wrap;">
                <strong style="font-size:12.5px; color:#0b1530;">${esc(f.label)}</strong>
                ${valeur ? `<span style="font-size:12.5px; font-weight:800; color:${cat.c};">${esc(valeur)}</span>` : ''}
                <span style="font-size:11px; color:#94a3b8;">${fmtDate(f.event_date)}</span>
              </div>
              ${f.detail ? `<div style="font-size:11.5px; color:#64748b; margin-top:2px;">${esc(f.detail)}</div>` : ''}
            </div>
            <button data-di-suppr="${f.id}" title="Supprimer" style="flex:0 0 auto; border:none; background:transparent; color:#cbd5e1; cursor:pointer; font-size:14px;">✕</button>
          </div>`;
        }).join('')}
      </div>`).join('')
      : `<div style="text-align:center; padding:22px; color:#94a3b8; font-style:italic; font-size:13px;">
           Aucune donnée extraite pour l'instant.<br>
           <span style="font-size:11.5px;">Versez un compte-rendu : les mesures, traitements et examens datés seront proposés automatiquement.</span>
         </div>`;

    return `
      <article class="card" style="padding:0; margin-bottom:14px; overflow:hidden;">
        <div style="padding:14px 20px; background:linear-gradient(135deg,#1d4ed8,#3b82f6); color:white; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
          <div>
            <h3 style="margin:0; color:white; font-size:15px;">📎 Pièces du dossier médical — ${esc(patientId)}</h3>
            <p style="margin:3px 0 0; font-size:11.5px; opacity:.92;">Versez un document : les données datées sont extraites, relues par vous, puis classées chronologiquement.</p>
          </div>
          <div>
            <input type="file" data-di-input style="display:none"
              accept=".pdf,.txt,.csv,.tsv,.json,.md,.htm,.html,.rtf,.docx,.xlsx,.xls,.xlsm,application/pdf,text/*">
            <button data-di-btn style="padding:10px 18px; border:none; background:white; color:#1d4ed8; border-radius:9px; font-weight:700; cursor:pointer; font-size:12.5px; white-space:nowrap;">⬆️ Verser une pièce</button>
          </div>
        </div>
        <div style="padding:16px 20px;">
          <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:10px;">
            <strong style="font-size:13px; color:#0b1530;">Chronologie médicale</strong>
            <span style="font-size:11.5px; color:#64748b;">${faits.length} donnée(s)</span>
          </div>
          ${corps}
        </div>
      </article>`;
  }

  // ============================================================
  // === Traitement d'un fichier ================================
  // ============================================================
  async function traiter(file, patientId) {
    _patientId = patientId;
    _docNom = file.name || 'document';
    const maxMo = 10;
    if (file.size > maxMo * 1024 * 1024) {
      alert('Fichier trop volumineux (' + Math.round(file.size / 1048576) + ' Mo). Maximum ' + maxMo + ' Mo.');
      return;
    }

    ouvrirAttente('Lecture du document…', _docNom);
    let texte = '';
    try {
      const r = await lireTexte(file);
      texte = (r.texte || '').trim();
      if (texte.length < 20) {
        throw new Error("Aucun texte exploitable trouvé. S'il s'agit d'un document scanné (image), l'extraction automatique n'est pas possible.");
      }
    } catch (e) {
      majAttente('❌ ' + ((e && e.message) || 'Lecture impossible'), true);
      return;
    }

    majAttente('Analyse en cours… identité masquée avant envoi.');
    let prop;
    try {
      prop = await window.MarfanAPI.timeline.analyser(patientId, texte, null);
    } catch (e) {
      majAttente('❌ ' + ((e && e.message) || "L'analyse a échoué."), true);
      return;
    }

    _faits = (prop && prop.faits) || [];
    fermerAttente();
    if (!_faits.length) {
      alert("Aucune donnée datée n'a pu être extraite de ce document.");
      return;
    }
    ouvrirRelecture(prop);
  }

  // ============================================================
  // === Fenêtre d'attente ======================================
  // ============================================================
  function ouvrirAttente(msg, nom) {
    fermerAttente();
    document.body.insertAdjacentHTML('beforeend', `
      <div id="diAttente" style="position:fixed; inset:0; background:rgba(11,21,48,.85); z-index:10060; display:flex; align-items:center; justify-content:center; padding:20px;">
        <div style="background:white; border-radius:14px; padding:28px 32px; width:420px; max-width:94vw; text-align:center; box-shadow:0 24px 60px rgba(0,0,0,.3);">
          <div style="font-size:34px; margin-bottom:10px;">📄</div>
          <div style="font-size:13px; color:#64748b; margin-bottom:4px;">${esc(nom || '')}</div>
          <div id="diAttenteMsg" style="font-size:14px; font-weight:700; color:#0b1530;">${esc(msg)}</div>
          <div id="diAttenteBarre" style="margin-top:16px; height:6px; background:#e8edf6; border-radius:99px; overflow:hidden;">
            <div style="height:100%; width:40%; background:linear-gradient(90deg,#3b82f6,#7c3aed); border-radius:99px; animation:diPulse 1.1s ease-in-out infinite;"></div>
          </div>
          <div id="diAttenteFerme" style="display:none; margin-top:16px;">
            <button onclick="document.getElementById('diAttente').remove()" style="padding:10px 20px; border:1px solid #cbd5e1; background:white; color:#475569; border-radius:9px; font-weight:600; cursor:pointer; font-size:13px;">Fermer</button>
          </div>
        </div>
      </div>
      <style>@keyframes diPulse { 0%{margin-left:0%} 50%{margin-left:60%} 100%{margin-left:0%} }</style>`);
  }
  function majAttente(msg, fin) {
    const m = document.getElementById('diAttenteMsg');
    if (m) m.innerHTML = esc(msg).replace(/\n/g, '<br>');
    if (fin) {
      const b = document.getElementById('diAttenteBarre'); if (b) b.style.display = 'none';
      const f = document.getElementById('diAttenteFerme'); if (f) f.style.display = 'block';
    }
  }
  function fermerAttente() {
    const a = document.getElementById('diAttente'); if (a) a.remove();
  }

  // ============================================================
  // === Fenêtre de relecture ===================================
  // ============================================================
  function ouvrirRelecture(prop) {
    const old = document.getElementById('diRelecture'); if (old) old.remove();
    const lignes = _faits.map((f, i) => {
      const cat = CATEGORIES[f.category] || CATEGORIES.autre;
      const conf = f.confiance != null ? Math.round(f.confiance * 100) : null;
      const douteux = conf != null && conf < 70;
      return `
        <tr data-i="${i}" style="border-bottom:1px solid #eef1f6; ${douteux ? 'background:#fffbeb;' : ''}">
          <td style="padding:8px 6px; text-align:center;">
            <input type="checkbox" class="diCb" data-i="${i}" ${douteux ? '' : 'checked'} style="width:17px; height:17px; cursor:pointer; accent-color:#2563eb;">
          </td>
          <td style="padding:8px 6px;">
            <input type="date" class="diDate" data-i="${i}" value="${f.event_date || ''}"
              style="padding:5px 7px; border:1px solid #d8dde7; border-radius:6px; font-size:12px; width:135px;">
          </td>
          <td style="padding:8px 6px;">
            <select class="diCat" data-i="${i}" style="padding:5px 7px; border:1px solid #d8dde7; border-radius:6px; font-size:12px;">
              ${Object.keys(CATEGORIES).map(k => `<option value="${k}" ${f.category === k ? 'selected' : ''}>${CATEGORIES[k].i} ${CATEGORIES[k].l}</option>`).join('')}
            </select>
          </td>
          <td style="padding:8px 6px;">
            <input type="text" class="diLabel" data-i="${i}" value="${esc(f.label)}"
              style="padding:5px 7px; border:1px solid #d8dde7; border-radius:6px; font-size:12px; width:100%; min-width:170px;">
          </td>
          <td style="padding:8px 6px; white-space:nowrap;">
            <input type="text" class="diVal" data-i="${i}" value="${esc(f.value_num != null ? f.value_num : (f.value_text || ''))}"
              style="padding:5px 7px; border:1px solid #d8dde7; border-radius:6px; font-size:12px; width:80px;">
            <input type="text" class="diUnit" data-i="${i}" value="${esc(f.unit || '')}" placeholder="unité"
              style="padding:5px 7px; border:1px solid #d8dde7; border-radius:6px; font-size:12px; width:62px;">
          </td>
          <td style="padding:8px 6px; font-size:11px; color:#64748b; max-width:230px;">
            ${conf != null ? `<span style="display:inline-block; padding:1px 7px; border-radius:99px; font-weight:700; font-size:10.5px; background:${douteux ? '#fef3c7' : '#ecfdf5'}; color:${douteux ? '#92400e' : '#065f46'};">${conf}%</span> ` : ''}
            <span title="${esc(f.source_extrait || '')}">${esc((f.source_extrait || '').slice(0, 70))}${(f.source_extrait || '').length > 70 ? '…' : ''}</span>
          </td>
        </tr>`;
    }).join('');

    const douteuxN = _faits.filter(f => f.confiance != null && f.confiance < 0.7).length;

    document.body.insertAdjacentHTML('beforeend', `
      <div id="diRelecture" style="position:fixed; inset:0; background:rgba(11,21,48,.88); z-index:10061; display:flex; align-items:center; justify-content:center; padding:16px; overflow-y:auto;">
        <div style="background:white; border-radius:16px; width:1080px; max-width:98vw; max-height:94vh; display:flex; flex-direction:column; box-shadow:0 26px 70px rgba(0,0,0,.35);">
          <div style="padding:18px 24px; border-bottom:1px solid #e2e8f0;">
            <h3 style="margin:0; font-size:17px; color:#0b1530;">🔍 Relecture avant intégration — ${esc(_docNom)}</h3>
            <p style="margin:5px 0 0; font-size:12.5px; color:#6b7390;">
              ${_faits.length} donnée(s) proposée(s). <strong>Rien n'est enregistré tant que vous n'avez pas validé.</strong>
              Décochez ce qui est erroné, corrigez si besoin.
            </p>
            ${douteuxN ? `<div style="margin-top:9px; padding:8px 11px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; font-size:12px; color:#92400e;">
              ⚠ ${douteuxN} donnée(s) de confiance faible sont <strong>décochées par défaut</strong> — vérifiez-les dans le document d'origine avant de les inclure.
            </div>` : ''}
            <div style="margin-top:9px; font-size:11.5px; color:#64748b;">
              🔒 Identité masquée avant analyse (nom, prénom, IPP, date de naissance) · modèle ${esc(prop.modele || '')} · ${prop.duree_ms ? Math.round(prop.duree_ms / 100) / 10 + ' s' : ''}
            </div>
          </div>

          <div style="flex:1; overflow-y:auto; padding:0 24px;">
            <table style="width:100%; border-collapse:collapse; font-size:12px;">
              <thead style="position:sticky; top:0; background:white; z-index:1;">
                <tr style="border-bottom:2px solid #e2e8f0; text-align:left; color:#475569; font-size:10.5px; text-transform:uppercase; letter-spacing:.4px;">
                  <th style="padding:10px 6px; width:38px; text-align:center;"><input type="checkbox" id="diToutCocher" checked style="width:17px; height:17px; cursor:pointer; accent-color:#2563eb;"></th>
                  <th style="padding:10px 6px;">Date</th>
                  <th style="padding:10px 6px;">Catégorie</th>
                  <th style="padding:10px 6px;">Libellé</th>
                  <th style="padding:10px 6px;">Valeur</th>
                  <th style="padding:10px 6px;">Source · confiance</th>
                </tr>
              </thead>
              <tbody>${lignes}</tbody>
            </table>
          </div>

          <div style="padding:16px 24px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap;">
            <span id="diCompteur" style="font-size:12.5px; color:#475569; font-weight:600;"></span>
            <div style="display:flex; gap:9px;">
              <button onclick="document.getElementById('diRelecture').remove()" style="padding:12px 20px; border:1px solid #cbd5e1; background:white; color:#475569; border-radius:10px; font-weight:600; font-size:13.5px; cursor:pointer;">Annuler</button>
              <button id="diValider" style="padding:12px 26px; border:none; border-radius:10px; background:linear-gradient(135deg,#1d4ed8,#3b82f6); color:white; font-weight:700; font-size:13.5px; cursor:pointer;">✓ Intégrer au dossier</button>
            </div>
          </div>
        </div>
      </div>`);

    const cases = () => Array.from(document.querySelectorAll('.diCb'));
    function majCompteur() {
      const n = cases().filter(c => c.checked).length;
      const el = document.getElementById('diCompteur');
      if (el) el.textContent = n + ' donnée(s) sélectionnée(s) sur ' + _faits.length;
    }
    cases().forEach(c => c.addEventListener('change', majCompteur));
    document.getElementById('diToutCocher').addEventListener('change', function () {
      cases().forEach(c => { c.checked = this.checked; });
      majCompteur();
    });
    majCompteur();

    document.getElementById('diValider').addEventListener('click', async function () {
      const lire = (cls, i) => {
        const el = document.querySelector('.' + cls + '[data-i="' + i + '"]');
        return el ? el.value : '';
      };
      const retenus = [];
      cases().filter(c => c.checked).forEach(c => {
        const i = parseInt(c.dataset.i, 10);
        const brut = lire('diVal', i).trim().replace(',', '.');
        const num = brut !== '' && Number.isFinite(Number(brut)) ? Number(brut) : null;
        retenus.push({
          event_date:     lire('diDate', i) || null,
          date_precision: lire('diDate', i) ? 'jour' : 'inconnue',
          category:       lire('diCat', i),
          label:          lire('diLabel', i).trim() || _faits[i].label,
          value_num:      num,
          value_text:     num == null && brut !== '' ? brut : null,
          unit:           lire('diUnit', i).trim() || null,
          detail:         _faits[i].detail || null,
          source_extrait: _faits[i].source_extrait || null,
          confiance:      _faits[i].confiance
        });
      });
      if (!retenus.length) { alert('Aucune donnée sélectionnée.'); return; }

      this.disabled = true; this.textContent = 'Enregistrement…';
      try {
        await window.MarfanAPI.timeline.save(_patientId, retenus, null);
        const b = document.getElementById('diRelecture'); if (b) b.remove();
        if (typeof window.toast === 'function') {
          window.toast('✓ <strong>' + retenus.length + ' donnée(s)</strong> intégrées au dossier de ' + _patientId + '.', 'success', 6000);
        }
        // Rafraîchit la carte et le tableau « Base de données »
        try { await mount('docImportMount', _patientId); } catch (_) {}
        try { if (typeof window.refreshDbTimelineCache === 'function') await window.refreshDbTimelineCache(); } catch (_) {}
      } catch (e) {
        alert("Enregistrement impossible : " + ((e && e.message) || 'erreur'));
        this.disabled = false; this.textContent = '✓ Intégrer au dossier';
      }
    });
  }

  window.DocImport = { mount, traiter, lireTexte };
})();
