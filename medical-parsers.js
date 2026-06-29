/**
 * ============================================================
 * Parseurs d'examens médicaux — CPET (XLSX COSMED) + Onde de pouls (CSV)
 * ============================================================
 * Expose window.MedicalParsers.{
 *   detectType(filename, content),
 *   parsePulseWaveCSV(text),
 *   parseCPETXlsx(arrayBuffer, SheetJS) → utilise window.XLSX
 * }
 *
 * Tous les parseurs retournent { summary, full, errors[] }
 *   summary  : objet de synthèse (clés normalisées : vo2_max, vop, etc.)
 *   full     : données complètes (cycles CPET, signaux temporels)
 *   errors[] : avertissements éventuels
 * ============================================================
 */
(function () {
  'use strict';

  // ============================================================
  // Détection automatique du type de fichier
  // ============================================================
  function detectType(filename, content) {
    const fn = (filename || '').toLowerCase();
    if (fn.endsWith('.xlsx') || fn.endsWith('.xls')) {
      // CPET COSMED ou autre format XLSX
      return 'cpet';
    }
    if (fn.endsWith('.csv') || fn.endsWith('.txt')) {
      // Détection par signature dans le contenu
      if (content && typeof content === 'string') {
        const head = content.substring(0, 500);
        if (/^#Patient\s/.test(head) || /^#FTPWV\s/.test(head) || /^#SBP\s/m.test(head)) {
          return 'pulse_wave';
        }
        // Tentative : si contient "VO2" ou "VE/VCO2" → CPET CSV
        if (/VO2|VCO2|VE.VCO2|VEVO2/i.test(head)) return 'cpet';
      }
      return 'pulse_wave'; // défaut probable
    }
    return 'other';
  }

  // ============================================================
  // PULSE WAVE — CSV avec header #KEY VALUE + 2 colonnes de signaux
  // ============================================================
  function parsePulseWaveCSV(text) {
    const errors = [];
    const lines = (text || '').split(/\r?\n/);
    const header = {};
    let firstDataLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        // #KEY VALUE
        const m = line.match(/^#(\S+)\s+(.+)$/);
        if (m) header[m[1]] = isNaN(Number(m[2])) ? m[2].trim() : Number(m[2]);
      } else {
        firstDataLine = i;
        break;
      }
    }

    // Parse données : 2 colonnes séparées par ; ou ,
    const signals = { finger: [], toe: [] };
    const sep = lines[firstDataLine] && lines[firstDataLine].includes(';') ? ';' : ',';
    for (let i = firstDataLine; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(sep);
      if (parts.length >= 2) {
        const f = parseFloat(parts[0]);
        const t = parseFloat(parts[1]);
        if (!isNaN(f)) signals.finger.push(f);
        if (!isNaN(t)) signals.toe.push(t);
      }
    }

    if (!Object.keys(header).length) errors.push('Aucun en-tête #KEY VALUE détecté');
    if (!signals.finger.length) errors.push('Aucun signal exploitable');

    // === SYNTHÈSE ===
    // Extraction des variables clés (mapping ENDO-PAT / pOpmètre type)
    const summary = {
      // Identité (info brute, généralement le patient est sélectionné séparément)
      patient_label: header.Patient || null,
      age: num(header.Age),
      height_cm: num(header.Height),
      laterality: header.Laterality || null,
      exam_date_raw: header.Date || null,   // format DDMMYYYY ou YYYYMMDD selon device
      exam_time_raw: header.Time || null,
      // Hémodynamique
      sbp: num(header.SBP),                  // Pression systolique brachiale (mmHg)
      dbp: num(header.DBP),                  // Pression diastolique brachiale
      heart_rate: num(header.Heart_Rate),    // FC (bpm)
      // Indices d'onde de pouls / rigidité
      ftpwv: num(header.FTPWV),              // Pulse Wave Velocity (m/s) — équivalent VOP
      ftptt: num(header.FTPTT),              // Pulse Transit Time (ms)
      ftpwv_cv: num(header.FTPWV_CV),        // Coefficient de variation FTPWV
      ftptt_cv: num(header.FTPTT_CV),        // CV FTPTT
      si: num(header.SI),                    // Stiffness Index
      // Pression centrale / périphérique
      csp: num(header.CSP),                  // Central Systolic Pressure
      cdp: num(header.CDP),                  // Central Diastolic Pressure
      psp: num(header.PSP),                  // Peripheral Systolic Pressure
      pdp: num(header.PDP),                  // Peripheral Diastolic Pressure
      central_pulse_pressure: num(header.CSP) != null && num(header.CDP) != null
        ? Math.round((num(header.CSP) - num(header.CDP)) * 10)/10 : null,
      peripheral_pulse_pressure: num(header.PSP) != null && num(header.PDP) != null
        ? Math.round((num(header.PSP) - num(header.PDP)) * 10)/10 : null,
      // Signaux et qualité
      finger_signal_amp: num(header.Finger_Signal_Amp),
      toe_signal_amp: num(header.Toe_Signal_Amp),
      valid_pulses_pairs_nbr: num(header.Valid_Pulses_Pairs_Nbr),
      faomi: num(header.FAOMI),
      taomi: num(header.TAOMI),
      sample_rate_hz: num(header.SR),
      device: header.Device || null,
      // Auto-conclusion courte
      conclusion: autoConclusionPulseWave(num(header.FTPWV), num(header.SI))
    };

    // Garde tous les KV header bruts dans full pour ne rien perdre
    const full = {
      header_raw: header,
      signals_count: signals.finger.length,
      signals_preview: {
        finger: signals.finger.slice(0, 5000),  // limite pour éviter payload >10MB
        toe: signals.toe.slice(0, 5000)
      },
      sample_rate_hz: summary.sample_rate_hz || 1000,
      duration_s: signals.finger.length / (summary.sample_rate_hz || 1000)
    };

    return { summary, full, errors };
  }

  function autoConclusionPulseWave(pwv, si) {
    if (pwv == null) return 'Données insuffisantes';
    let txt = '';
    if (pwv < 7)        txt = 'VOP normale (< 7 m/s) — rigidité artérielle dans la norme.';
    else if (pwv < 10)  txt = 'VOP modérément élevée (7-10 m/s) — rigidité artérielle légèrement augmentée.';
    else                txt = '⚠ VOP au-dessus du seuil pathologique ESC 2018 (≥ 10 m/s) — rigidité artérielle augmentée, marqueur de risque cardiovasculaire.';
    if (si != null) txt += ' Stiffness Index = ' + si + '.';
    return txt;
  }

  // ============================================================
  // CPET — XLSX COSMED (2 onglets : Données + Résultats)
  // Nécessite SheetJS chargé (window.XLSX)
  // ============================================================
  function parseCPETXlsx(arrayBuffer) {
    const errors = [];
    if (typeof XLSX === 'undefined') {
      errors.push('SheetJS (XLSX) non chargé — impossible de parser le fichier.');
      return { summary: {}, full: {}, errors };
    }
    let wb;
    try { wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true }); }
    catch (e) { errors.push('Lecture XLSX échouée : ' + e.message); return { summary: {}, full: {}, errors }; }

    // Onglet "Données" : métadonnées patient + cycles
    const sheetData = wb.Sheets['Données'] || wb.Sheets['Donnees'] || wb.Sheets[wb.SheetNames[0]];
    // Onglet "Résultats" : valeurs calculées Repos/Échauffement/SV1/SV2/Max
    const sheetResults = wb.Sheets['Résultats'] || wb.Sheets['Resultats'] || wb.Sheets[wb.SheetNames[1]];

    // === Extraction métadonnées patient (10 premières lignes, cols A-H) ===
    const meta = {};
    const cellMap = {
      'A1': 'patient_id', 'B1': 'patient_id_val',
      'A2': 'last_name_label', 'B2': 'last_name',
      'A3': 'first_name_label', 'B3': 'first_name',
      'A4': 'sex_label', 'B4': 'sex',
      'A5': 'age_label', 'B5': 'age',
      'A6': 'height_label', 'B6': 'height_cm',
      'A7': 'weight_label', 'B7': 'weight_kg',
      'A8': 'birth_label', 'B8': 'birth_date',
      'D1': 'test_date_label', 'E1': 'test_date',
      'D2': 'test_time_label', 'E2': 'test_time',
      'D3': 'test_duration_label', 'E3': 'test_duration',
      'D4': 'subject_type_label', 'E4': 'subject_type',
      'D5': 'test_type_label', 'E5': 'test_type',
      'D6': 'ergometer_label', 'E6': 'ergometer',
      'D7': 'protocol_label', 'E7': 'protocol',
      'D8': 'max_effort_label', 'E8': 'max_effort_confirmed'
    };
    if (sheetData) {
      Object.entries(cellMap).forEach(([addr, key]) => {
        const cell = sheetData[addr];
        if (cell && cell.v !== undefined && !key.endsWith('_label')) {
          meta[key] = cell.v;
        }
      });
    }

    // === Extraction des cycles (à partir de la ligne ~15 ou 16, colonne J et suivantes) ===
    // Le header des cycles est à la ligne 14 ou 15, données à partir de 16
    const cycles = [];
    if (sheetData) {
      const range = XLSX.utils.decode_range(sheetData['!ref'] || 'A1:A1');
      // Cherche la ligne d'en-tête des cycles (contient "t" ou "VO2")
      let headerRow = -1;
      let cycleColStart = -1;
      for (let r = 0; r < Math.min(20, range.e.r + 1); r++) {
        for (let c = 9; c <= Math.min(20, range.e.c); c++) {  // commence colonne J
          const cell = sheetData[XLSX.utils.encode_cell({r, c})];
          if (cell && typeof cell.v === 'string' && /^(VO2|t|Time)$/i.test(cell.v.trim())) {
            headerRow = r; cycleColStart = c; break;
          }
        }
        if (headerRow >= 0) break;
      }
      // Si pas trouvé, on prend colonne J comme convention COSMED
      if (headerRow < 0) { headerRow = 13; cycleColStart = 9; }

      // Lit les en-têtes
      const cycleHeaders = [];
      for (let c = cycleColStart; c <= range.e.c; c++) {
        const cell = sheetData[XLSX.utils.encode_cell({r: headerRow, c})];
        cycleHeaders.push(cell && cell.v != null ? String(cell.v).trim() : 'col' + c);
      }
      // Lit les unités à la ligne suivante
      const cycleUnits = [];
      for (let c = cycleColStart; c <= range.e.c; c++) {
        const cell = sheetData[XLSX.utils.encode_cell({r: headerRow + 1, c})];
        cycleUnits.push(cell && cell.v != null ? String(cell.v).trim() : '');
      }
      // Lit les valeurs à partir de la ligne suivante (souvent +2)
      for (let r = headerRow + 2; r <= range.e.r; r++) {
        const row = {};
        let hasData = false;
        for (let c = cycleColStart; c <= range.e.c; c++) {
          const cell = sheetData[XLSX.utils.encode_cell({r, c})];
          const key = cycleHeaders[c - cycleColStart];
          if (cell && cell.v != null) {
            let v = cell.v;
            // Convertit les datetime.time en secondes
            if (typeof v === 'object' && v instanceof Date) {
              v = v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds();
            }
            row[key] = v;
            hasData = true;
          }
        }
        if (hasData) cycles.push(row);
      }
    }

    // === Extraction des résultats clés (onglet Résultats) ===
    const results = {};
    if (sheetResults) {
      // Cherche les colonnes Repos/Échauffement/SV1/SV2/Max
      // Format typique : ligne 5 = en-têtes, ligne 6+ = data avec colonne A = param name
      const range = XLSX.utils.decode_range(sheetResults['!ref'] || 'A1:A1');
      // Trouve la ligne d'en-tête
      let headerRow = -1;
      const colMap = {};
      for (let r = 0; r < Math.min(15, range.e.r + 1); r++) {
        for (let c = 0; c <= Math.min(15, range.e.c); c++) {
          const cell = sheetResults[XLSX.utils.encode_cell({r, c})];
          if (cell && typeof cell.v === 'string') {
            const v = cell.v.trim();
            if (/^(SV1|VT1|AT)$/i.test(v))      { colMap.sv1 = c; headerRow = r; }
            if (/^(SV2|VT2|RC)$/i.test(v))      { colMap.sv2 = c; headerRow = r; }
            if (/^Max$/i.test(v))                { colMap.max = c; headerRow = r; }
            if (/^Repos$/i.test(v))              { colMap.repos = c; headerRow = r; }
            if (/^Échauffement|Echauffement$/i.test(v)) { colMap.warmup = c; headerRow = r; }
          }
        }
        if (Object.keys(colMap).length >= 3) break;
      }
      // Lit les params (colonne A) et leurs valeurs aux colonnes trouvées
      if (headerRow >= 0) {
        for (let r = headerRow + 1; r <= range.e.r; r++) {
          const paramCell = sheetResults[XLSX.utils.encode_cell({r, c: 0})];
          if (!paramCell || paramCell.v == null) continue;
          const param = String(paramCell.v).trim();
          if (!param) continue;
          const unitCell = sheetResults[XLSX.utils.encode_cell({r, c: 1})];
          const unit = unitCell && unitCell.v != null ? String(unitCell.v).trim() : '';
          const row = { unit };
          Object.entries(colMap).forEach(([key, col]) => {
            const cell = sheetResults[XLSX.utils.encode_cell({r, c: col})];
            row[key] = cell && cell.v != null ? cell.v : null;
          });
          results[param] = row;
        }
      }
    }

    // === SYNTHÈSE auto-extraite ===
    const summary = {
      // Patient (info brute, le patient est sélectionné séparément)
      patient_label: (meta.last_name || '') + ' ' + (meta.first_name || ''),
      sex: meta.sex || null,
      age: num(meta.age),
      height_cm: num(meta.height_cm),
      weight_kg: num(meta.weight_kg),
      birth_date: meta.birth_date || null,
      // Métadonnées test
      exam_date: meta.test_date || null,
      test_duration: meta.test_duration || null,
      ergometer: meta.ergometer || null,
      protocol: meta.protocol || null,
      max_effort_confirmed: meta.max_effort_confirmed || null,
      test_type: meta.test_type || null,
      // === Valeurs maximales (depuis Résultats ou calcul sur cycles) ===
      vo2_max_ml_min:    extractResult(results, 'VO2', 'max') || cycleMax(cycles, 'VO2'),
      vo2_max_ml_kg_min: (extractResult(results, 'VO2/Kg', 'max') || cycleMax(cycles, 'VO2/Kg')),
      vco2_max:          extractResult(results, 'VCO2', 'max') || cycleMax(cycles, 'VCO2'),
      ve_max:            extractResult(results, 'VE', 'max')   || cycleMax(cycles, 'VE'),
      rer_max:           extractResult(results, 'RQ', 'max') || extractResult(results, 'RER', 'max') || cycleMax(cycles, 'RQ'),
      hr_max:            extractResult(results, 'HR', 'max')   || cycleMax(cycles, 'HR'),
      power_max:         extractResult(results, 'Power', 'max') || cycleMax(cycles, 'Power'),
      // === Seuils ventilatoires ===
      sv1_t:             extractResult(results, 't', 'sv1'),
      sv1_vo2:           extractResult(results, 'VO2', 'sv1'),
      sv1_hr:            extractResult(results, 'HR', 'sv1'),
      sv1_power:         extractResult(results, 'Power', 'sv1'),
      sv2_t:             extractResult(results, 't', 'sv2'),
      sv2_vo2:           extractResult(results, 'VO2', 'sv2'),
      sv2_hr:            extractResult(results, 'HR', 'sv2'),
      sv2_power:         extractResult(results, 'Power', 'sv2'),
      // === Conclusion automatique ===
      conclusion: null  // calculée après
    };
    summary.conclusion = autoConclusionCPET(summary);
    summary.vo2_max_ml_min = num(summary.vo2_max_ml_min);
    summary.hr_max = num(summary.hr_max);
    summary.power_max = num(summary.power_max);

    const full = {
      patient_meta: meta,
      results_raw: results,
      cycles: cycles,
      cycles_count: cycles.length,
      sheet_names: wb.SheetNames
    };
    return { summary, full, errors };
  }

  function extractResult(results, paramRegex, colKey) {
    if (!results) return null;
    const re = new RegExp(paramRegex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    for (const param of Object.keys(results)) {
      if (re.test(param.trim())) {
        const v = results[param][colKey];
        return v == null ? null : v;
      }
    }
    return null;
  }
  function cycleMax(cycles, key) {
    if (!cycles || !cycles.length) return null;
    const vals = cycles.map(c => num(c[key])).filter(v => v != null);
    return vals.length ? Math.max(...vals) : null;
  }
  function autoConclusionCPET(s) {
    if (!s.vo2_max_ml_min && !s.vo2_max_ml_kg_min) return 'Données insuffisantes pour conclure.';
    let txt = 'Test d\'effort cardio-pulmonaire — ';
    if (s.vo2_max_ml_kg_min) txt += 'VO₂ max ' + Math.round(s.vo2_max_ml_kg_min*10)/10 + ' ml/kg/min';
    if (s.hr_max) txt += ' · FC max ' + Math.round(s.hr_max) + ' bpm';
    if (s.power_max) txt += ' · Puissance max ' + Math.round(s.power_max) + ' W';
    if (s.rer_max) txt += ' · RER max ' + (Math.round(s.rer_max*100)/100);
    return txt;
  }

  function num(v) {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? null : n;
  }

  // Conversion File → arrayBuffer (utile pour XLSX)
  function fileToArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  // Conversion File → texte (pour CSV)
  function fileToText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }
  // Conversion File → base64 (pour sauvegarde du fichier original)
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const r = reader.result;
        const idx = r.indexOf(',');
        resolve(idx >= 0 ? r.substring(idx + 1) : r);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  window.MedicalParsers = {
    detectType, parsePulseWaveCSV, parseCPETXlsx,
    fileToArrayBuffer, fileToText, fileToBase64
  };
})();
