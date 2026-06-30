/**
 * pdf-extractor.js — Extraction et classification d'un PDF médical
 * ================================================================
 * Expose window.PDFExtractor :
 *   extractTextFromFile(file)  → { pages: [...], fullText, isScanned }
 *   classifyText(text)         → { identity, history, antecedents, ... }
 *   extractAll(file)           → { fullText, pages, isScanned, extracted_data }
 *
 * Dépendances : pdf.js (chargé via CDN dans index.html)
 *
 * Logique prudente :
 *   - Détecte par patterns (regex + mots-clés FR/EN)
 *   - Ne déduit JAMAIS une valeur non présente
 *   - Marque chaque champ avec confidence: 'high' | 'medium' | 'low'
 *   - Conserve toujours l'extrait source pour chaque champ
 * ================================================================ */

(function () {
  'use strict';

  if (typeof pdfjsLib === 'undefined' && typeof window.pdfjsLib === 'undefined') {
    console.warn('[pdf-extractor] pdfjsLib non chargé — l\'extraction PDF nécessite pdf.js');
  }

  // =============================================================
  // === Extraction texte ========================================
  // =============================================================
  async function extractTextFromFile(file) {
    const pdfjsLib = window.pdfjsLib || self.pdfjsLib;
    if (!pdfjsLib) throw new Error('pdf.js non chargé');
    // Worker
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const ab = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: ab }).promise;
    const pages = [];
    let totalLen = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      pages.push({ page: i, text });
      totalLen += text.length;
    }
    const fullText = pages.map(p => p.text).join('\n\n');
    // Heuristique : si le texte est très court alors qu'il y a plusieurs pages, c'est probablement scanné
    const isScanned = totalLen < pdf.numPages * 50;
    return { pages, fullText, isScanned, numPages: pdf.numPages };
  }

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        const base64 = dataUrl.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  // =============================================================
  // === Patterns de classification ==============================
  // =============================================================
  // Sections : on segmente le texte par titres de section reconnus
  const SECTION_HEADERS = [
    { key: 'identity',        patterns: ['identit[ée]', 'patient', 'données administratives', 'état civil'] },
    { key: 'history',         patterns: ['histoire de la maladie', 'maladie actuelle', 'h\\.?d\\.?l\\.?m', 'anamn[èe]se', 'histoire clinique', 'évolution'] },
    { key: 'antecedents',     patterns: ['ant[ée]c[ée]dents?', 'atcd', 'allergie', 'allergies', 'traitements?', 'm[ée]dicaments?'] },
    { key: 'patient_goals',   patterns: ['objectifs? du patient', 'attentes du patient', 'demande du patient'] },
    { key: 'clinician_goals', patterns: ['objectifs? th[ée]rapeutiques?', 'objectifs? m[ée]dicaux', 'objectifs? soignant', 'plan de soin'] },
    { key: 'key_points',      patterns: ['points cl[ée]s?', 'points importants', 'points de vigilance', 'à retenir', 'conclusion'] },
    { key: 'evaluations_summary', patterns: ['examens? clinique', 'r[ée]sultats?', 'biologie', 'imagerie', 'cpet', 'test d\'effort', '[ée]chocardiographie', 'onde de pouls'] },
    { key: 'sessions_summary', patterns: ['s[ée]ances?', 'r[ée][ée]ducation', 'r[ée]adaptation', 'progression'] }
  ];

  // Valeurs structurées — chaque entrée : { field, regex, section, confidence, parser? }
  const VALUE_PATTERNS = [
    // Identité
    { field: 'last_name',    section: 'identity', regex: /(?:nom)\s*(?:de famille)?\s*[:\-]\s*([A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ' -]{1,30})/i, conf: 'high' },
    { field: 'first_name',   section: 'identity', regex: /(?:pr[ée]nom)s?\s*[:\-]\s*([A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ' -]{1,30})/i, conf: 'high' },
    { field: 'birth_date',   section: 'identity', regex: /(?:n[ée](?:e)? le|date de naissance|ddn)\s*[:\-]?\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i, conf: 'high' },
    { field: 'age',          section: 'identity', regex: /(?:[âa]ge)\s*[:\-]?\s*(\d{1,3})\s*an/i, conf: 'high', parser: v => parseInt(v, 10) },
    { field: 'sex',          section: 'identity', regex: /(?:sexe|genre)\s*[:\-]?\s*(homme|femme|masculin|f[ée]minin|h|f|m)\b/i, conf: 'high', parser: v => /^(femme|f[ée]minin|f)$/i.test(v) ? 'F' : (/^(homme|masculin|h|m)$/i.test(v) ? 'M' : v) },
    { field: 'height_cm',    section: 'identity', regex: /(?:taille)\s*[:\-]?\s*(\d{2,3}(?:[.,]\d)?)\s*(?:cm|m\b)/i, conf: 'high', parser: v => { const n = parseFloat(v.replace(',', '.')); return n < 3 ? n * 100 : n; } },
    { field: 'weight_kg',    section: 'identity', regex: /(?:poids)\s*[:\-]?\s*(\d{1,3}(?:[.,]\d{1,2})?)\s*kg/i, conf: 'high', parser: v => parseFloat(v.replace(',', '.')) },
    { field: 'bmi',          section: 'identity', regex: /(?:imc|bmi)\s*[:\-]?\s*(\d{1,2}(?:[.,]\d{1,2})?)/i, conf: 'medium', parser: v => parseFloat(v.replace(',', '.')) },
    { field: 'referring_doctor', section: 'identity', regex: /(?:m[ée]decin r[ée]f[ée]rent|m[ée]decin traitant|prescripteur)\s*[:\-]?\s*((?:Dr|Pr|Docteur)\.?\s+[A-ZÀ-Ÿ][A-ZÀ-Ÿa-zà-ÿ\- ]{1,40})/i, conf: 'medium' },

    // Histoire
    { field: 'main_diagnosis', section: 'history', regex: /(?:diagnostic principal|diagnostic)\s*[:\-]\s*([^\.\n]{3,150})/i, conf: 'medium' },
    { field: 'diagnosis_date', section: 'history', regex: /(?:date de diagnostic|diagnostiqu[ée] le)\s*[:\-]?\s*(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/i, conf: 'medium' },

    // Antécédents — extractions de listes (gros bloc, on garde le texte source)
    { field: 'allergies_text',          section: 'antecedents', regex: /(?:allergies?)\s*[:\-]\s*([^\.\n]{1,200})/i, conf: 'medium' },
    { field: 'current_treatments_text', section: 'antecedents', regex: /(?:traitements?(?:\s+en\s+cours)?|m[ée]dicaments?)\s*[:\-]\s*([^\.\n]{1,300})/i, conf: 'medium' },

    // Clés cliniques (CPET, onde de pouls, etc.)
    { field: 'vo2_max_ml_kg_min', section: 'key_points', regex: /VO2\s*max\s*[:\-=]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:ml\/kg\/min|ml\.kg-1\.min-1)/i, conf: 'high', parser: v => parseFloat(v.replace(',', '.')) },
    { field: 'ftpwv_m_s',         section: 'key_points', regex: /(?:VOP|PWV|ftpwv)\s*[:\-=]?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*m\/s/i, conf: 'high', parser: v => parseFloat(v.replace(',', '.')) },
    { field: 'sbp',               section: 'key_points', regex: /(?:PAS|TA syst|systolique)\s*[:\-=]?\s*(\d{2,3})\s*(?:mmHg)?\s*[\/\-]?\s*(\d{2,3})\s*(?:mmHg)?/i, conf: 'high', parser: v => parseInt(v, 10) },
    { field: 'hr_max',            section: 'key_points', regex: /(?:FC\s*max|FCmax)\s*[:\-=]?\s*(\d{2,3})/i, conf: 'high', parser: v => parseInt(v, 10) }
  ];

  // =============================================================
  // === Découpe par sections ====================================
  // =============================================================
  function segmentBySections(text) {
    const segments = { unsorted: text };
    // Repère les positions des titres
    const positions = [];
    SECTION_HEADERS.forEach(s => {
      s.patterns.forEach(p => {
        const re = new RegExp(`(?:^|\\n|\\.)\\s*(?:[\\d\\.\\)\\-•]?\\s*)?(${p})\\s*[:\\-\\n]`, 'gi');
        let m;
        while ((m = re.exec(text)) !== null) {
          positions.push({ start: m.index + m[0].indexOf(m[1]), key: s.key, marker: m[1] });
        }
      });
    });
    if (!positions.length) return segments;
    positions.sort((a, b) => a.start - b.start);
    // Découpe entre 2 positions consécutives
    for (let i = 0; i < positions.length; i++) {
      const start = positions[i].start;
      const end = i + 1 < positions.length ? positions[i + 1].start : text.length;
      const slice = text.substring(start, end).trim();
      const key = positions[i].key;
      segments[key] = (segments[key] ? segments[key] + '\n' : '') + slice;
    }
    // Texte avant le premier marqueur = identité par défaut (souvent en haut du doc)
    if (positions[0].start > 50) {
      segments.identity = (text.substring(0, positions[0].start).trim() + '\n' + (segments.identity || '')).trim();
    }
    return segments;
  }

  // =============================================================
  // === Extraction de valeurs structurées =======================
  // =============================================================
  function extractStructured(text, segments) {
    const out = {
      identity: {}, history: {}, antecedents: {},
      patient_goals: {}, clinician_goals: {}, key_points: {},
      evaluations_summary: {}, sessions_summary: {}
    };
    const _meta = {};

    // 1) Valeurs cherchées d'abord dans la section dédiée si elle existe, sinon dans tout le texte
    for (const pat of VALUE_PATTERNS) {
      const scope = segments[pat.section] || text;
      const m = scope.match(pat.regex);
      if (m && m[1]) {
        const raw = m[1].trim();
        const value = pat.parser ? pat.parser(raw) : raw;
        if (value != null && !(typeof value === 'number' && isNaN(value))) {
          out[pat.section][pat.field] = value;
          _meta[pat.section + '.' + pat.field] = {
            confidence: pat.conf,
            extract: m[0].substring(0, 200),
            from: pat.section
          };
        }
      }
    }

    // 2) Sections textuelles : on conserve le texte de la section dans un champ '_text'
    Object.keys(segments).forEach(k => {
      if (k === 'unsorted') return;
      const txt = segments[k];
      if (txt && txt.length > 20) {
        out[k]._text = txt.length > 2000 ? txt.substring(0, 2000) + '…' : txt;
        out[k]._text_full_length = txt.length;
        _meta[k + '._text'] = { confidence: 'medium', extract: 'segment complet', from: k };
      }
    });

    // 3) Métadonnées par champ pour l'aperçu
    out._extraction_meta = _meta;
    return out;
  }

  // =============================================================
  // === API publique ============================================
  // =============================================================
  async function extractAll(file) {
    const r = await extractTextFromFile(file);
    if (r.isScanned) {
      // En 12.1 on ne fait pas d'OCR : on retourne un texte vide + drapeau
      return {
        fullText: r.fullText,
        pages: r.pages,
        isScanned: true,
        extracted_data: { _warning: 'PDF probablement scanné — OCR non disponible en Phase 12.1, validation manuelle requise.' }
      };
    }
    const segments = segmentBySections(r.fullText);
    const extracted_data = extractStructured(r.fullText, segments);
    return {
      fullText: r.fullText,
      pages: r.pages,
      isScanned: false,
      extracted_data
    };
  }

  function classifyText(text) {
    const segments = segmentBySections(text);
    return extractStructured(text, segments);
  }

  window.PDFExtractor = {
    extractTextFromFile,
    classifyText,
    extractAll,
    fileToBase64,
    SECTION_HEADERS,
    VALUE_PATTERNS
  };

})();
