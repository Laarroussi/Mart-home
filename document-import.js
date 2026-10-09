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
  let _conteneurId = null;
  let _zoneId = null;
  let _faits = [];
  let _echo = null;
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
  /**
   * Lit les quatre premiers octets pour reconnaître un vrai classeur Excel.
   *
   * Les logiciels d'épreuve d'effort COSMED exportent un classeur Excel sous
   * l'extension .csv. Traité comme du texte, il ne donnait que des caractères
   * illisibles. La signature ZIP « PK\x03\x04 » lève l'ambiguïté.
   */
  async function estClasseurExcel(file) {
    try {
      const t = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      return t[0] === 0x50 && t[1] === 0x4B && t[2] === 0x03 && t[3] === 0x04;
    } catch (_) { return false; }
  }

  /**
   * Lit un classeur Excel, feuille par feuille.
   *
   * Les feuilles très hautes sont condensées, et c'est essentiel : un examen
   * d'épreuve d'effort contient plusieurs centaines de lignes cycle par
   * cycle. Transmises intégralement, elles saturent la limite de lecture et
   * la feuille « Résultats » — celle qui porte les seuils ventilatoires,
   * donc la seule vraiment exploitable — se retrouvait tronquée.
   *
   * On conserve l'en-tête, le début et la fin de chaque grande feuille : de
   * quoi reconnaître le format et les valeurs de repos comme de pic, sans
   * noyer le reste.
   */
  const LIGNES_MAX = 45;
  function lireClasseur(buf) {
    if (typeof XLSX === 'undefined') throw new Error("Lecteur Excel indisponible dans cette page.");
    const wb = XLSX.read(buf, { type: 'array' });
    const blocs = [];
    wb.SheetNames.forEach(n => {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n]);
      const lignes = csv.split('\n');
      let corps;
      if (lignes.length <= LIGNES_MAX) {
        corps = csv;
      } else {
        const tete = lignes.slice(0, LIGNES_MAX - 8).join('\n');
        const queue = lignes.slice(-6).join('\n');
        corps = tete +
          '\n[… ' + (lignes.length - LIGNES_MAX + 2) + ' lignes intermédiaires omises …]\n' +
          queue;
      }
      blocs.push({ nom: n, texte: '\n--- Feuille : ' + n + ' ---\n' + corps, taille: lignes.length });
    });
    // Les feuilles de synthèse passent en premier : ce sont les plus denses
    // en information, et elles ne doivent jamais être celles qu'on tronque.
    blocs.sort((a, b) => a.taille - b.taille);
    return blocs.map(b => b.texte).join('\n');
  }

  async function lireTexte(file) {
    const nom = (file.name || '').toLowerCase();
    const type = file.type || '';

    // Contrôle du contenu AVANT tout aiguillage par extension : un fichier
    // nommé .csv peut être un classeur Excel déguisé.
    if (await estClasseurExcel(file)) {
      // Un .docx est aussi une archive ZIP : on ne détourne que ce qui n'est
      // pas déjà traité comme un document Word.
      if (!/\.docx$/.test(nom)) {
        return { texte: lireClasseur(await file.arrayBuffer()), mode: 'tableur' };
      }
    }

    // PDF — pdf.js, déjà chargé dans la page
    if (type === 'application/pdf' || nom.endsWith('.pdf')) {
      if (window.PDFExtractor && window.PDFExtractor.extractTextFromFile) {
        // extractTextFromFile renvoie un OBJET { pages, fullText, isScanned },
        // pas une chaîne. Le prendre pour du texte cassait tout versement de
        // PDF dès le premier caractère lu.
        const r = await window.PDFExtractor.extractTextFromFile(file);
        const brut = (r && typeof r === 'object') ? (r.fullText || '') : String(r || '');
        return {
          texte: brut,
          mode: 'pdf',
          // Un compte rendu scanné n'a pas de couche de texte : on le signale
          // pour que la lecture passe par l'OCR du serveur.
          scanne: !!(r && r.isScanned),
          pages: (r && r.numPages) || null
        };
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
      return { texte: lireClasseur(await file.arrayBuffer()), mode: 'tableur' };
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

    // Images (photo ou scan de compte-rendu) : pas de texte extractible ici,
    // mais l'OCR du serveur sait les lire. On renvoie donc un texte vide.
    if (type.startsWith('image/')) {
      return { texte: '', mode: 'image', ocrRequis: true };
    }

    throw new Error('Format non pris en charge : ' + (nom.split('.').pop() || type));
  }

  /**
   * Les photos prises avec un iPhone sont au format HEIC, que les services
   * d'OCR ne savent pas lire. Safari, lui, sait le décoder : on le convertit
   * donc en JPEG directement dans la page avant l'envoi.
   * Renvoie le fichier d'origine si ce n'est pas du HEIC.
   */
  async function convertirSiHeic(file) {
    const nom = (file.name || '').toLowerCase();
    const estHeic = /\.(heic|heif)$/.test(nom) ||
                    /image\/hei[cf]/i.test(file.type || '');
    if (!estHeic) return file;

    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error(
          "Ce navigateur ne sait pas lire le format HEIC des photos iPhone.\n\n" +
          "Deux solutions : ouvrez la photo dans l'app Photos, menu Fichier > Exporter, " +
          "et choisissez JPEG. Ou bien, sur l'iPhone : Réglages > Appareil photo > Formats > " +
          "« Le plus compatible »."));
        im.src = url;
      });
      // On borne la taille : au-delà, le fichier devient lourd sans gain de lisibilité
      const maxCote = 2200;
      const ratio = Math.min(1, maxCote / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * ratio);
      cv.height = Math.round(img.height * ratio);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.88));
      if (!blob) throw new Error("Conversion de la photo impossible.");
      return new File([blob], nom.replace(/\.(heic|heif)$/, '.jpg'), { type: 'image/jpeg' });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Convertit un fichier en base64 (sans le préfixe data:) pour l'envoi OCR */
  function versBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result || '');
        const i = s.indexOf(',');
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      fr.onerror = () => reject(new Error('Lecture du fichier impossible'));
      fr.readAsDataURL(file);
    });
  }

  // ============================================================
  // === Carte « Pièces du dossier médical » ====================
  // ============================================================
  async function mount(containerId, patientId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    _patientId = patientId;
    _conteneurId = containerId;

    let faits = [];
    try {
      const r = await window.MarfanAPI.timeline.list(patientId);
      faits = (r && r.faits) || [];
    } catch (e) { console.warn('[docimport] chronologie :', e && e.message); }

    el.innerHTML = rendreCarte(patientId, faits);
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
            <h3 style="margin:0; color:white; font-size:15px;">📎 Données extraites des pièces — ${esc(patientId)}</h3>
            <p style="margin:3px 0 0; font-size:11.5px; opacity:.92;">Chaque mesure, traitement ou examen daté retrouvé dans un document versé, relu par vous, classé chronologiquement.</p>
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
  /**
   * Ce fichier est-il une épreuve d'effort ?
   *
   * On ne se fie pas à l'extension : les logiciels d'épreuve d'effort
   * exportent couramment un classeur Excel sous le nom « .csv ». On regarde
   * donc le contenu — la signature d'un classeur, ou les en-têtes de colonnes
   * qu'aucun compte rendu clinique ne contient.
   */
  async function reconnaitreAppareil(file) {
    const nom = (file.name || '').toLowerCase();
    if (!/\.(csv|tsv|txt|xlsx?|xlsm)$/i.test(nom)) return null;
    if (typeof XLSX === 'undefined') return null;

    // Classeur Excel, quelle que soit son extension : signature ZIP « PK ».
    try {
      const debut = new Uint8Array(await file.slice(0, 2).arrayBuffer());
      if (debut[0] === 0x50 && debut[1] === 0x4B) return 'cpet';
    } catch (_) {}

    let tete = '';
    try { tete = await file.slice(0, 20000).text(); } catch (_) { return null; }

    // Onde de pouls : en-têtes propres à l'appareil, reconnaissables à coup sûr.
    if (/^#Patient\s/m.test(tete) || /^#FTPWV\s/m.test(tete) || /^#SBP\s/m.test(tete)) {
      return 'pulse_wave';
    }

    // Épreuve d'effort en texte : colonnes d'un cycle respiratoire. Trois
    // marqueurs suffisent, aucun ne se trouve dans un courrier ou un compte
    // rendu.
    const marqueurs = [/\bVO2\b/i, /\bVCO2\b/i, /VE\/VO2/i, /VE\/VCO2/i,
                       /\bRER\b/i, /\bWatt/i, /\bPhase\b/i, /\bFETO2\b/i];
    if (marqueurs.filter(r => r.test(tete)).length >= 3) return 'cpet';
    return null;
  }

  /**
   * Onde de pouls : un tracé de signal, pas un texte.
   *
   * Le lecteur générique en tirerait les mêmes absurdités qu'avec une épreuve
   * d'effort. On la confie au parseur dédié et on la range dans les examens.
   */
  async function traiterOndeDePouls(file, patientId) {
    ouvrirAttente("Onde de pouls reconnue — lecture du tracé…", _docNom);
    try {
      const texte = await file.text();
      const r = window.MedicalParsers.parsePulseWaveCSV(texte);
      await window.MarfanAPI.medicalExams.create({
        patient_id: patientId,
        exam_type: 'pulse_wave',
        exam_date: new Date().toISOString().slice(0, 10),
        file_name: file.name || _docNom,
        file_size_kb: Math.round(file.size / 1024),
        file_mime: file.type || 'text/csv',
        raw_file: await versBase64(file),
        parsed_summary: r.summary || {},
        parsed_full: r.full || {},
        notes: 'Versé depuis « Pièces du dossier médical ».'
      });
      majAttente("✅ Onde de pouls enregistrée dans les examens.\n\n" +
                 "Elle est consultable dans « Pièces & examens ».", true);
    } catch (e) {
      majAttente("❌ " + ((e && e.message) || 'Lecture impossible') +
                 "\n\nAucune donnée n'a été enregistrée.", true);
    }
  }

  /**
   * Une épreuve d'effort versée ici n'est pas un document à lire.
   *
   * Auparavant elle partait au lecteur générique, qui la confiait à l'IA pour
   * en extraire du texte. Le modèle y trouvait des nombres et les interprétait
   * à sa façon : un export COSMED a ainsi produit un « diamètre aortique de
   * 45 mm » qui ne figurait nulle part dans le fichier. Une mesure clinique
   * inventée dans un dossier, à partir d'un examen qui ne la contenait pas.
   *
   * Le fichier est donc analysé ici même par le module dédié — VO2 pic, seuils
   * ventilatoires, OUES, pente VE/VCO2, zones d'entraînement — et aucune
   * valeur n'est déduite d'une lecture de texte.
   */
  async function traiterEpreuveDEffort(file, patientId) {
    ouvrirAttente("Épreuve d'effort reconnue — analyse des cycles respiratoires…", _docNom);

    let av;
    try {
      const ab = await file.arrayBuffer();
      av = window.CpetAnalyse.analyserClasseur(ab);
    } catch (e) {
      majAttente("❌ Analyse impossible : " + ((e && e.message) || 'fichier illisible') +
                 "\n\nVous pouvez réessayer depuis « Examens médicaux ».", true);
      return;
    }
    if (!av || av.erreur) {
      majAttente("❌ " + ((av && av.erreur) || "Aucun cycle exploitable.") +
                 "\n\nAucune donnée n'a été enregistrée.", true);
      return;
    }

    // La date du test vient du fichier quand il la porte ; sinon aujourd'hui.
    const dateTest = dateDuTest(av) || new Date().toISOString().slice(0, 10);

    majAttente("Analyse terminée — enregistrement dans le suivi…");

    // On conserve d'abord le fichier source : une évaluation sans la pièce
    // dont elle est tirée n'est pas vérifiable.
    try {
      const base64 = await versBase64(file);
      const parse = (window.MedicalParsers && window.MedicalParsers.parseCPETXlsx)
        ? window.MedicalParsers.parseCPETXlsx(await file.arrayBuffer())
        : { summary: {}, full: {} };
      await window.MarfanAPI.medicalExams.create({
        patient_id: patientId,
        exam_type: 'cpet',
        exam_date: dateTest,
        file_name: file.name || _docNom,
        file_size_kb: Math.round(file.size / 1024),
        file_mime: file.type || 'application/octet-stream',
        raw_file: base64,
        parsed_summary: Object.assign({}, parse.summary, av),
        parsed_full: Object.assign({}, parse.full, { analyse_avancee: av }),
        notes: 'Versé depuis « Documents & examens » du dossier patient.'
      });
    } catch (e) {
      console.warn('[docimport] conservation du fichier CPET :', e && e.message);
    }

    // Puis l'évaluation : c'est elle qui alimente les graphiques, le tableau
    // de la base et les zones d'entraînement.
    try {
      await window.MarfanAPI.evaluations.create(patientId, {
        label: "Épreuve d'effort" + (av.sujet && av.sujet.date_test ? ' — ' + av.sujet.date_test : ''),
        date: dateTest,
        vo2: av.vo2_pic_ml_kg_min != null ? av.vo2_pic_ml_kg_min : null,
        sv1: av.sv1_vo2 != null ? Math.round(av.sv1_vo2 / 10) / 100 : null,
        sv2: av.sv2_vo2 != null ? Math.round(av.sv2_vo2 / 10) / 100 : null,
        ve_vco2_slope: av.ve_vco2_pente,
        watts: av.watts_pic,
        fc_max: av.fc_pic,
        note: av.nature_vo2 === 'VO2max'
          ? 'VO₂ max — effort maximal confirmé'
          : 'VO₂ pic — effort maximal non confirmé',
        thresholds: {
          fcRepos: av.fc_repos, fcPeak: av.fc_pic,
          sv1Fc: av.sv1_fc, sv2Fc: av.sv2_fc,
          sv1Watts: av.sv1_watts, sv2Watts: av.sv2_watts,
          sv1Vo2: av.sv1_vo2, sv2Vo2: av.sv2_vo2,
          oues: av.oues_ml_min, ouesParKg: av.oues_par_kg,
          veVco2Pente: av.ve_vco2_pente, veVco2R2: av.ve_vco2_r2,
          natureVo2: av.nature_vo2, criteres: av.criteres_maximalite,
          zones: av.zones
        }
      });
    } catch (e) {
      majAttente("❌ Évaluation non créée : " + ((e && e.message) || 'erreur') +
                 "\n\nLe fichier a été conservé ; l'analyse peut être relancée.", true);
      return;
    }

    try { if (typeof loadPatientsFromApi === 'function') await loadPatientsFromApi(); } catch (_) {}
    try { if (typeof renderDbTable === 'function') renderDbTable(); } catch (_) {}

    const l = v => (v == null ? '—' : v);
    majAttente(
      "✅ Épreuve d'effort analysée et enregistrée.\n\n" +
      (av.nature_vo2 === 'VO2max' ? 'VO₂ max' : 'VO₂ pic') + ' : ' +
        l(av.vo2_pic_ml_kg_min) + ' mL/kg/min\n' +
      'Seuils SV1 / SV2 : ' + l(av.sv1_fc) + ' / ' + l(av.sv2_fc) + ' bpm\n' +
      'Pente VE/VCO₂ : ' + l(av.ve_vco2_pente) + '\n' +
      'Puissance pic : ' + l(av.watts_pic) + ' W\n\n' +
      "Les graphiques et les zones d'entraînement sont à jour.", true);

    if (_conteneurId) { try { await mount(_conteneurId, patientId); } catch (_) {} }
  }

  /** Date du test telle que le fichier la porte, en ISO si on sait la lire. */
  function dateDuTest(av) {
    const brut = av && av.sujet && av.sujet.date_test;
    if (!brut) return null;
    const m = String(brut).match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (m) {
      let a = m[3]; if (a.length === 2) a = (Number(a) > 50 ? '19' : '20') + a;
      return a + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    }
    const iso = String(brut).match(/(\d{4})-(\d{2})-(\d{2})/);
    return iso ? iso[0] : null;
  }

  async function traiter(file, patientId) {
    _patientId = patientId;
    _docNom = file.name || 'document';
    // Un enregistrement de consultation pèse naturellement plus qu'un PDF :
    // on lui accorde un peu plus de marge, sans dépasser la limite d'envoi
    // du serveur (15 Mo une fois encodé en base64).
    const estAudioFichier = (file.type || '').startsWith('audio/') ||
                            /\.(mp3|m4a|wav|ogg|opus|webm|aac|flac)$/i.test(file.name || '');
    const maxMo = estAudioFichier ? 12 : 10;
    if (file.size > maxMo * 1024 * 1024) {
      alert('Fichier trop volumineux (' + Math.round(file.size / 1048576) + ' Mo). Maximum ' + maxMo + ' Mo.' +
            (estAudioFichier ? '\n\nCela représente environ 25 minutes en qualité voix. Découpez l\'enregistrement, ou réenregistrez en qualité inférieure.' : ''));
      return;
    }

    // ============================================================
    // Une épreuve d'effort n'est pas un document à lire : c'est un tableau
    // de mesures à analyser.
    //
    // Versée ici, elle partait au lecteur générique, qui la confiait à l'IA
    // pour en extraire du texte. Le modèle y trouvait des nombres et les
    // interprétait à sa façon : un fichier COSMED a ainsi produit un
    // « diamètre aortique de 45 mm » qui n'existait nulle part. Une donnée
    // clinique inventée dans un dossier, à partir d'un examen qui n'en
    // parlait pas.
    //
    // On reconnaît donc le format avant d'envoyer quoi que ce soit, et on
    // oriente vers l'analyse dédiée — celle qui calcule VO2 pic, seuils
    // ventilatoires, OUES et pente VE/VCO2.
    // ============================================================
    try {
      const nature = await reconnaitreAppareil(file);
      if (nature === 'cpet') { await traiterEpreuveDEffort(file, patientId); return; }
      if (nature === 'pulse_wave') { await traiterOndeDePouls(file, patientId); return; }
    } catch (e) {
      console.warn('[docimport] reconnaissance du fichier :', e && e.message);
    }

    ouvrirAttente('Lecture du document…', _docNom);

    // Photo iPhone au format HEIC : conversion en JPEG avant toute chose
    try {
      const avant = file;
      file = await convertirSiHeic(file);
      if (file !== avant) majAttente('Photo iPhone convertie — préparation…');
    } catch (e) {
      majAttente('❌ ' + ((e && e.message) || 'Conversion impossible'), true);
      return;
    }

    // Un enregistrement sonore ne se lit pas dans le navigateur : on saute
    // l'extraction de texte et on l'envoie tel quel à la transcription.
    const estAudio = (file.type || '').startsWith('audio/') ||
                     /\.(mp3|m4a|wav|ogg|opus|webm|aac|flac)$/i.test(file.name || _docNom || '');

    let texte = '', base64 = null, scanne = false;
    if (!estAudio) {
      try {
        const r = await lireTexte(file);
        // Ceinture et bretelles : si un lecteur renvoie autre chose qu'une
        // chaîne, on le convertit plutôt que de laisser échouer .trim().
        texte = (typeof r.texte === 'string' ? r.texte : String(r.texte || '')).trim();
        scanne = !!r.scanne;
      } catch (e) {
        majAttente('❌ ' + ((e && e.message) || 'Lecture impossible'), true);
        return;
      }
    }

    // Audio, document scanné ou photo : rien d'exploitable dans le navigateur,
    // le serveur s'en charge — transcription Voxtral ou OCR Mistral.
    const besoinOcr = estAudio || scanne || texte.length < 20;
    if (besoinOcr) {
      const estLisibleParServeur = estAudio ||
                               /\.(pdf|png|jpe?g|webp|tiff?|heic|heif)$/i.test(file.name || _docNom) ||
                               (file.type || '').startsWith('image/') ||
                               file.type === 'application/pdf';
      if (!estLisibleParServeur) {
        majAttente("❌ Aucun texte exploitable dans ce document.", true);
        return;
      }
      if (estAudio && file.size > 12 * 1024 * 1024) {
        majAttente('❌ Enregistrement trop volumineux (' + Math.round(file.size / 1048576) +
                   ' Mo). Limite : 12 Mo, soit environ 25 minutes en qualité voix.', true);
        return;
      }
      majAttente(estAudio
        ? "Transcription de l'enregistrement en cours…\nComptez environ une minute pour dix minutes d'audio."
        : 'Document scanné détecté — lecture optique en cours…\nCela peut prendre quelques secondes.');
      try { base64 = await versBase64(file); }
      catch (e) { majAttente('❌ ' + e.message, true); return; }
    } else {
      majAttente('Analyse en cours… identité masquée avant envoi.');
    }

    let prop;
    try {
      prop = await window.MarfanAPI.timeline.analyser(
        patientId, texte, null, base64, file.type || 'application/pdf', false, file.name);
    } catch (e) {
      majAttente('❌ ' + ((e && e.message) || "L'analyse a échoué."), true);
      return;
    }

    _faits = (prop && prop.faits) || [];
    _echo = (prop && prop.echo) || null;
    fermerAttente();
    if (!_faits.length && !_echo) {
      alert("Aucune donnée datée n'a pu être extraite de ce document.");
      return;
    }
    ouvrirRelecture(prop);
  }

  // ============================================================
  // === Bloc de relecture des mesures d'échocardiographie ======
  // ============================================================
  // Groupes affichés dans l'ordre de lecture d'un compte-rendu ETT.
  const GROUPES_ECHO = [
    { titre: 'Aorte — niveaux de mesure', couleur: '#dc2626', champs: [
      ['anneau_aortique_mm', 'Anneau aortique', 'mm'],
      ['sinus_valsalva_mm', 'Sinus de Valsalva', 'mm'],
      ['jonction_sinotub_mm', 'Jonction sino-tubulaire', 'mm'],
      ['aorte_ascendante_mm', 'Aorte ascendante', 'mm'],
      ['crosse_aortique_mm', 'Crosse aortique', 'mm'],
      ['aorte_descendante_mm', 'Aorte descendante', 'mm'],
      ['aorte_abdominale_mm', 'Aorte abdominale', 'mm'],
      ['aorte_max_mm', 'Diamètre maximal', 'mm']
    ]},
    { titre: 'Ventricule gauche', couleur: '#0891b2', champs: [
      ['divgd_cm', 'DIVGd', 'cm'], ['divgs_cm', 'DIVGs', 'cm'],
      ['sivgd_cm', 'SIVGd', 'cm'], ['ppvgd_cm', 'PPVGd', 'cm'],
      ['fr_teicholz_pct', 'FR Teicholz', '%'], ['fe_teicholz_pct', 'FE Teicholz', '%'],
      ['fevg_bp_pct', 'FEVG biplan', '%'],
      ['mvg_g', 'Masse VG', 'g'], ['mvg_ind_g_m2', 'Masse VG indexée', 'g/m²'],
      ['h_sur_r', 'h/R', ''],
      ['vtd_bp_ml', 'VTD biplan', 'mL'], ['vts_bp_ml', 'VTS biplan', 'mL'],
      ['vtd_bp_ind_ml_m2', 'VTD indexé', 'mL/m²'], ['vts_bp_ind_ml_m2', 'VTS indexé', 'mL/m²'],
      ['ve_bp_ml', 'Volume éjection', 'mL'], ['ve_bp_ind_ml_m2', 'VE indexé', 'mL/m²'],
      ['vtd_a4c_ml', 'VTD A4C', 'mL'], ['vts_a4c_ml', 'VTS A4C', 'mL'],
      ['vtd_a2c_ml', 'VTD A2C', 'mL'], ['vts_a2c_ml', 'VTS A2C', 'mL']
    ]},
    { titre: 'Oreillette gauche', couleur: '#7c3aed', champs: [
      ['vts_og_bp_ml', 'VTS OG', 'mL'], ['vts_og_bp_ind_ml_m2', 'VTS OG indexé', 'mL/m²']
    ]},
    { titre: 'Valves', couleur: '#16a34a', champs: [
      ['vit_pic_e_vm_cm_s', 'Onde E mitrale', 'cm/s'],
      ['vit_pic_a_vm_cm_s', 'Onde A mitrale', 'cm/s'],
      ['td_vm_s', 'TD mitral', 's'],
      ['vmax_va_cm_s', 'Vmax aortique', 'cm/s'], ['itv_va_cm', 'ITV aortique', 'cm'],
      ['grad_max_va_mmhg', 'Gradient max aortique', 'mmHg'],
      ['vmax_it_cm_s', 'Vmax tricuspide', 'cm/s'],
      ['grad_max_it_mmhg', 'Gradient max tricuspide', 'mmHg']
    ]},
    { titre: 'Morphologie', couleur: '#64748b', champs: [
      ['taille_cm', 'Taille', 'cm'], ['poids_kg', 'Poids', 'kg'],
      ['surface_corporelle_m2', 'Surface corporelle', 'm²']
    ]}
  ];

  function rendreBlocEcho(e) {
    if (!e) return '';
    const champ = (cle, lib, unite) => {
      const v = e[cle];
      const vide = (v == null || v === '');
      return `
        <div style="display:flex; align-items:center; gap:6px; padding:4px 0;">
          <label style="flex:1; min-width:0; font-size:11.5px; color:${vide ? '#cbd5e1' : '#475569'};">${lib}</label>
          <input type="text" class="echoF" data-k="${cle}" value="${v == null ? '' : esc(v)}"
            style="width:74px; padding:4px 7px; border:1px solid ${vide ? '#eef1f6' : '#cbd5e1'}; border-radius:6px; font-size:12px; text-align:right; font-weight:${vide ? '400' : '700'}; color:#0b1530;">
          <span style="width:42px; font-size:10.5px; color:#94a3b8;">${unite}</span>
        </div>`;
    };
    const sinus = e.sinus_valsalva_mm;
    const alerte = sinus != null && sinus >= 45;
    const vigilance = sinus != null && sinus >= 42 && sinus < 45;

    return `
      <div style="margin:0 0 18px; border:1px solid #bfdbfe; border-radius:12px; overflow:hidden;">
        <div style="padding:12px 16px; background:linear-gradient(135deg,#1d4ed8,#3b82f6); color:white;">
          <strong style="font-size:14px;">🫀 Compte-rendu d'échocardiographie reconnu</strong>
          <div style="font-size:11.5px; opacity:.93; margin-top:2px;">
            Ces mesures formeront une ligne complète dans le tableau « Échocardiographie » de la base de données.
          </div>
        </div>
        <div style="padding:14px 16px;">
          <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:14px;">
            <div style="flex:1; min-width:150px;">
              <label style="display:block; font-size:10.5px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.4px; margin-bottom:4px;">Date de l'examen *</label>
              <input type="date" class="echoF" data-k="exam_date" value="${e.exam_date || ''}"
                style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:7px; font-size:13px; box-sizing:border-box;">
            </div>
            <div style="flex:1; min-width:150px;">
              <label style="display:block; font-size:10.5px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.4px; margin-bottom:4px;">Opérateur</label>
              <input type="text" class="echoF" data-k="operateur" value="${esc(e.operateur || '')}"
                style="width:100%; padding:8px; border:1px solid #cbd5e1; border-radius:7px; font-size:13px; box-sizing:border-box;">
            </div>
          </div>

          ${sinus != null ? `
          <div style="margin-bottom:14px; padding:11px 14px; border-radius:9px; background:${alerte ? '#fee2e2' : vigilance ? '#fef3c7' : '#eff6ff'}; border:1px solid ${alerte ? '#fecaca' : vigilance ? '#fde68a' : '#bfdbfe'};">
            <strong style="font-size:13px; color:${alerte ? '#991b1b' : vigilance ? '#92400e' : '#1e40af'};">
              Sinus de Valsalva : ${sinus} mm
            </strong>
            ${alerte ? '<div style="font-size:12px; color:#991b1b; margin-top:2px;">⚠️ Seuil ≥ 45 mm — indication chirurgicale à discuter</div>' : ''}
            ${vigilance ? '<div style="font-size:12px; color:#92400e; margin-top:2px;">⚠ Surveillance rapprochée</div>' : ''}
          </div>` : ''}

          <label style="display:flex; align-items:center; gap:9px; padding:10px 12px; background:#fdf2f8; border:1px solid #fbcfe8; border-radius:8px; margin-bottom:14px; cursor:pointer;">
            <input type="checkbox" id="echoOpere" ${e.aorte_operee ? 'checked' : ''} style="width:17px; height:17px; cursor:pointer; accent-color:#be185d;">
            <span style="font-size:12.5px; color:#9d174d; font-weight:600;">Patient opéré de l'aorte — information affichée en évidence sur sa fiche</span>
          </label>

          <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(250px, 1fr)); gap:16px;">
            ${GROUPES_ECHO.map(g => `
              <div>
                <div style="font-size:11px; font-weight:800; color:${g.couleur}; text-transform:uppercase; letter-spacing:.5px; padding-bottom:5px; border-bottom:2px solid ${g.couleur}33; margin-bottom:5px;">${g.titre}</div>
                ${g.champs.map(c => champ(c[0], c[1], c[2])).join('')}
              </div>`).join('')}
          </div>

          ${e.conclusion ? `
          <div style="margin-top:14px;">
            <label style="display:block; font-size:10.5px; font-weight:700; color:#475569; text-transform:uppercase; letter-spacing:.4px; margin-bottom:4px;">Conclusion</label>
            <textarea class="echoF" data-k="conclusion" rows="3"
              style="width:100%; padding:9px; border:1px solid #cbd5e1; border-radius:7px; font-size:12.5px; font-family:inherit; resize:vertical; box-sizing:border-box;">${esc(e.conclusion)}</textarea>
          </div>` : ''}

          <div style="margin-top:10px; font-size:11px; color:#94a3b8;">
            Les cases grisées sont absentes du document. Vous pouvez les compléter ou corriger toute valeur avant d'enregistrer.
          </div>
        </div>
      </div>`;
  }

  function lireBlocEcho() {
    if (!_echo) return null;
    const out = Object.assign({}, _echo);
    document.querySelectorAll('.echoF').forEach(el => {
      const k = el.dataset.k;
      let v = (el.value || '').trim();
      if (v === '') { out[k] = null; return; }
      if (k === 'exam_date' || k === 'operateur' || k === 'conclusion' || k === 'aorte_site_max') {
        out[k] = v;
      } else {
        const n = Number(v.replace(',', '.'));
        out[k] = Number.isFinite(n) ? n : null;
      }
    });
    const op = document.getElementById('echoOpere');
    out.aorte_operee = op ? op.checked : null;
    out.source_nom_fichier = _docNom;
    return out;
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
              🔒 Identité masquée avant analyse (nom, prénom, IPP, date de naissance) · 🇪🇺 Mistral AI · modèle ${esc(prop.modele || '')}${prop.ocr ? ' · lecture optique de ' + prop.ocr.pages + ' page(s)' : ''} · ${prop.duree_ms ? Math.round(prop.duree_ms / 100) / 10 + ' s' : ''}
            </div>
          </div>

          <div style="flex:1; overflow-y:auto; padding:0 24px;">
            ${rendreBlocEcho(_echo)}
            ${_faits.length ? '<div style="font-size:11px; font-weight:800; color:#475569; text-transform:uppercase; letter-spacing:.5px; margin:4px 0 6px;">Autres données datées relevées</div>' : ''}
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
      const echoAEnregistrer = lireBlocEcho();
      if (!retenus.length && !echoAEnregistrer) { alert('Aucune donnée sélectionnée.'); return; }

      this.disabled = true; this.textContent = 'Enregistrement…';
      try {
        let messages = [];
        if (echoAEnregistrer) {
          await window.MarfanAPI.timeline.echoSave(_patientId, echoAEnregistrer);
          messages.push('1 échocardiographie');
        }
        if (retenus.length) {
          await window.MarfanAPI.timeline.save(_patientId, retenus, null);
          messages.push(retenus.length + ' donnée(s) datées');
        }
        const b = document.getElementById('diRelecture'); if (b) b.remove();
        if (typeof window.toast === 'function') {
          window.toast('✓ <strong>' + messages.join(' et ') + '</strong> intégrée(s) au dossier de ' + _patientId + '.', 'success', 6000);
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

  /**
   * La zone de versement, seule, pour la première rubrique du dossier.
   *
   * Elle est séparée de la chronologie extraite parce qu'elles ne servent pas
   * au même moment : on verse une pièce en passant, on relit les données
   * extraites quand on vérifie. Les mettre dans la même carte obligeait à
   * traverser toute la chronologie pour atteindre le bouton.
   */
  function monterZone(containerId, patientId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    _patientId = patientId;

    el.innerHTML = `
      <article class="card" style="padding:0; margin-bottom:14px; overflow:hidden;">
        <div style="padding:14px 20px; background:linear-gradient(135deg,#1d4ed8,#3b82f6); color:white;">
          <h3 style="margin:0; color:white; font-size:15px;">📎 Verser une pièce au dossier</h3>
          <p style="margin:3px 0 0; font-size:11.5px; opacity:.92;">Un seul endroit pour tout : le type du fichier est reconnu automatiquement.</p>
        </div>
        <div style="padding:16px 20px;">
          <div data-dz style="padding:24px; border:2px dashed #bfdbfe; border-radius:12px; text-align:center; background:#f8fbff; cursor:pointer; transition:background .15s, border-color .15s;">
            <div style="font-size:30px; margin-bottom:6px;">📥</div>
            <div style="font-size:13.5px; font-weight:700; color:#1d4ed8; margin-bottom:3px;">Glissez un fichier ici, ou cliquez pour parcourir</div>
            <div style="font-size:11.5px; color:#64748b; line-height:1.5;">
              Épreuve d'effort (COSMED) · échocardiographie · compte rendu · courrier ·
              onde de pouls · photo · enregistrement audio
            </div>
          </div>
          <div data-di-resultat style="display:none; margin-top:12px;"></div>
          <input type="file" data-dz-input style="display:none"
            accept=".pdf,.txt,.csv,.tsv,.json,.md,.htm,.html,.rtf,.docx,.xlsx,.xls,.xlsm,.png,.jpg,.jpeg,.webp,.tif,.tiff,.heic,.heif,.mp3,.m4a,.wav,.ogg,.opus,.webm,.aac,.flac,application/pdf,text/*,image/*,audio/*">
        </div>
      </article>`;

    const zone = el.querySelector('[data-dz]');
    const input = el.querySelector('[data-dz-input]');
    _zoneId = containerId;

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      if (input.files && input.files[0]) await traiter(input.files[0], patientId);
      input.value = '';
    });
    const surligner = on => {
      zone.style.background = on ? '#eff6ff' : '#f8fbff';
      zone.style.borderColor = on ? '#3b82f6' : '#bfdbfe';
    };
    zone.addEventListener('dragover', e => { e.preventDefault(); surligner(true); });
    zone.addEventListener('dragleave', () => surligner(false));
    zone.addEventListener('drop', async e => {
      e.preventDefault(); surligner(false);
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) await traiter(f, patientId);
    });
  }

  window.DocImport = { mount, monterZone, traiter, lireTexte };
})();
