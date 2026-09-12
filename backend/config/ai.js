/**
 * ============================================================
 * EXTRACTION IA — Marfan APA (Mistral AI)
 * ============================================================
 * Deux capacités :
 *
 *   1. OCR    — lit les documents SCANNÉS (PDF image, photo de
 *               compte-rendu) et en restitue le texte.
 *               Modèle : mistral-ocr-latest · 4 $ / 1000 pages
 *
 *   2. ANALYSE — extrait du texte les faits médicaux datés
 *               (mesures, biologie, traitements, opérations…).
 *               Modèle : mistral-small-latest · 0,15 $ / M tokens
 *
 * Fournisseur européen : le traitement peut rester en UE, ce qui
 * simplifie la conformité RGPD pour des données de santé françaises.
 *
 * La clé vit UNIQUEMENT côté serveur, dans .env (MISTRAL_API_KEY).
 * Elle n'est jamais transmise au navigateur.
 *
 * Aucune dépendance npm : fetch est natif depuis Node 18.
 *
 * Confidentialité : pseudonymiser() masque nom, prénom, IPP, date de
 * naissance, e-mail, téléphone et NIR avant tout envoi.
 * ============================================================
 */

const BASE = (process.env.MISTRAL_BASE_URL || 'https://api.mistral.ai').replace(/\/$/, '');
const MODELE = process.env.MISTRAL_MODEL || 'mistral-small-latest';
const MODELE_OCR = process.env.MISTRAL_OCR_MODEL || 'mistral-ocr-latest';

function cleActive() {
  return !!(process.env.MISTRAL_API_KEY && process.env.MISTRAL_API_KEY.trim());
}
function entetes() {
  return {
    'Authorization': 'Bearer ' + process.env.MISTRAL_API_KEY.trim(),
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}
function exigerCle() {
  if (!cleActive()) {
    const e = new Error("Aucune clé Mistral configurée sur le serveur (MISTRAL_API_KEY absente dans .env)");
    e.code = 'NO_KEY';
    throw e;
  }
}

/** Traduit une réponse HTTP en erreur lisible par l'utilisateur */
async function erreurLisible(rep, quoi) {
  let detail = '';
  try { const j = await rep.json(); detail = (j.error && j.error.message) || j.message || ''; }
  catch (_) {}
  if (rep.status === 401) return new Error("Clé Mistral refusée (401). Vérifiez MISTRAL_API_KEY dans .env.");
  if (rep.status === 402) return new Error("Crédits Mistral épuisés (402). Rechargez votre compte sur console.mistral.ai.");
  if (rep.status === 429) return new Error("Trop de requêtes vers Mistral (429). Réessayez dans un instant.");
  return new Error("Erreur Mistral " + rep.status + " sur " + quoi + (detail ? ' — ' + detail : ''));
}

// ============================================================
// === Pseudonymisation =======================================
// ============================================================
function pseudonymiser(texte, patient) {
  if (!texte) return '';
  let t = String(texte);
  const remplacer = (valeur, marqueur) => {
    if (!valeur) return;
    const v = String(valeur).trim();
    if (v.length < 3) return;                       // évite de massacrer le texte
    const echappe = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(echappe, 'gi'), marqueur);
  };

  const civil = (patient && patient.civil) || {};
  remplacer(civil.lastName,  '[NOM]');
  remplacer(civil.firstName, '[PRENOM]');
  remplacer(civil.ipp,       '[IPP]');
  remplacer(civil.email,     '[EMAIL]');
  remplacer(civil.phone,     '[TEL]');
  remplacer(civil.address,   '[ADRESSE]');

  if (civil.dob) {
    const d = new Date(civil.dob);
    if (!isNaN(d)) {
      const jj = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const aaaa = d.getFullYear();
      [`${jj}/${mm}/${aaaa}`, `${jj}-${mm}-${aaaa}`, `${jj}.${mm}.${aaaa}`,
       `${aaaa}-${mm}-${jj}`, `${jj} ${mm} ${aaaa}`]
        .forEach(f => { t = t.split(f).join('[DATE_NAISSANCE]'); });
    }
  }

  t = t.replace(/\b[12]\s?\d{2}\s?\d{2}\s?\d{2,3}\s?\d{3}\s?\d{3}\s?\d{2}\b/g, '[NIR]');
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[EMAIL]');
  t = t.replace(/\b0[1-9](?:[\s.-]?\d{2}){4}\b/g, '[TEL]');
  return t;
}

// ============================================================
// === OCR : lecture des documents scannés ====================
// ============================================================
/**
 * @param {string} base64 - contenu du fichier encodé en base64 (sans préfixe data:)
 * @param {string} mime   - ex. 'application/pdf', 'image/jpeg'
 * @returns {Promise<{texte:string, pages:number, modele:string, duree_ms:number}>}
 */
async function ocrDocument(base64, mime) {
  exigerCle();
  const debut = Date.now();
  const estImage = String(mime || '').startsWith('image/');
  const dataUrl = 'data:' + (mime || 'application/pdf') + ';base64,' + base64;

  const document = estImage
    ? { type: 'image_url', image_url: dataUrl }
    : { type: 'document_url', document_url: dataUrl };

  let rep;
  try {
    rep = await fetch(BASE + '/v1/ocr', {
      method: 'POST',
      headers: entetes(),
      body: JSON.stringify({ model: MODELE_OCR, document, include_image_base64: false })
    });
  } catch (e) {
    throw new Error("Service Mistral injoignable (OCR) : " + e.message);
  }
  if (!rep.ok) throw await erreurLisible(rep, 'OCR');

  const data = await rep.json();
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const texte = pages.map(p => p.markdown || p.text || '').join('\n\n').trim();

  return { texte, pages: pages.length, modele: MODELE_OCR, duree_ms: Date.now() - debut };
}

// ============================================================
// === Analyse : extraction des faits médicaux ================
// ============================================================
const CONSIGNE = `Tu es un assistant d'extraction de données médicales pour une étude clinique sur le syndrome de Marfan.

On te donne le texte d'un document médical (compte-rendu hospitalier, biologie, imagerie, courrier). Tu dois en extraire TOUS les faits médicaux DATÉS et les renvoyer en JSON strict.

Règles impératives :
- N'invente RIEN. Si une information n'est pas dans le texte, ne la produis pas.
- Chaque fait doit citer la phrase d'origine dans "source_extrait".
- Les dates au format AAAA-MM-JJ. Si seul le mois est connu : AAAA-MM-01 avec date_precision "mois". Si seule l'année : AAAA-01-01 avec "annee". Si aucune date : event_date null et date_precision "inconnue".
- Sépare les valeurs numériques de leur unité.
- Une mesure répétée à des dates différentes = plusieurs faits distincts.
- Les marqueurs [NOM], [PRENOM], [IPP], [DATE_NAISSANCE] sont des anonymisations : ignore-les.

Catégories autorisées : mesure, biologie, traitement, operation, examen, diagnostic, autre.

Exemples de "label" attendus : "Diamètre sinus de Valsalva", "Diamètre aorte ascendante", "FEVG", "VO2max", "Pression artérielle systolique", "Créatinine", "Bêta-bloquant", "Remplacement valve aortique", "Échocardiographie transthoracique".

Réponds UNIQUEMENT avec un objet JSON de cette forme :
{"faits":[{"event_date":"2021-05-05","date_precision":"jour","category":"mesure","label":"Diamètre sinus de Valsalva","value_num":34,"value_text":null,"unit":"mm","detail":"mesuré en ETT","source_extrait":"Sinus de Valsalva mesuré à 34 mm","confiance":0.95}]}`;

async function analyserTexte(texte) {
  exigerCle();
  const debut = Date.now();
  const extrait = String(texte || '').slice(0, 60000);

  let rep;
  try {
    rep = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: entetes(),
      body: JSON.stringify({
        model: MODELE,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: CONSIGNE },
          { role: 'user', content: 'Document à analyser :\n\n' + extrait }
        ]
      })
    });
  } catch (e) {
    throw new Error("Service Mistral injoignable : " + e.message);
  }
  if (!rep.ok) throw await erreurLisible(rep, "l'analyse");

  const data = await rep.json();
  const brut = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '{}';
  let parsed;
  try { parsed = JSON.parse(brut); }
  catch (_) { throw new Error("Réponse de l'IA illisible (JSON invalide)"); }

  const faits = Array.isArray(parsed.faits) ? parsed.faits : [];
  const CATS = ['mesure','biologie','traitement','operation','examen','diagnostic','autre'];

  const propres = faits
    .filter(f => f && f.label)
    .map(f => ({
      event_date:     /^\d{4}-\d{2}-\d{2}$/.test(f.event_date || '') ? f.event_date : null,
      date_precision: ['jour','mois','annee','inconnue'].includes(f.date_precision) ? f.date_precision : 'inconnue',
      category:       CATS.includes(f.category) ? f.category : 'autre',
      label:          String(f.label).slice(0, 200),
      value_num:      (f.value_num != null && Number.isFinite(Number(f.value_num))) ? Number(f.value_num) : null,
      value_text:     f.value_text != null ? String(f.value_text).slice(0, 500) : null,
      unit:           f.unit != null ? String(f.unit).slice(0, 30) : null,
      detail:         f.detail != null ? String(f.detail).slice(0, 800) : null,
      source_extrait: f.source_extrait != null ? String(f.source_extrait).slice(0, 800) : null,
      confiance:      (f.confiance != null && Number.isFinite(Number(f.confiance)))
                        ? Math.max(0, Math.min(1, Number(f.confiance))) : null
    }));

  return { faits: propres, modele: MODELE, duree_ms: Date.now() - debut };
}

// ============================================================
// === Extraction de l'identité (création de fiche patient) ===
// ============================================================
// ⚠ Cette extraction suppose que le texte N'A PAS été pseudonymisé :
// elle n'est utilisée que lorsqu'un soignant verse un document POUR
// CRÉER une fiche, afin de lui éviter une double saisie. Pour un
// patient déjà enregistré, le masquage reste appliqué.
const CONSIGNE_IDENTITE = `Tu extrais l'en-tête administratif d'un document médical français (compte-rendu hospitalier, courrier, examen).

Règles impératives :
- N'invente RIEN. Tout champ absent du document vaut null.
- nom : le NOM DE FAMILLE seul, en majuscules.
- prenom : le prénom seul, première lettre majuscule.
- Ne confonds pas le patient avec le médecin ou l'opérateur : le médecin est souvent précédé de "Dr", "Pr", "Responsable du rapport", "Médecin traitant".
- ipp : identifiant permanent du patient (souvent "IPP", "NIP", "N° dossier", "Identifiant").
- date_naissance et date_document au format AAAA-MM-JJ. Les dates françaises s'écrivent JJ/MM/AAAA.
- sexe : "Homme", "Femme" ou "Autre", tel qu'indiqué.
- taille_cm en centimètres, poids_kg en kilogrammes, surface_corporelle_m2 en m².
- centre : l'établissement (ex. "AP-HP — Hôpital Bichat").
- service : le service ou l'unité si mentionné.
- medecin : le médecin responsable, sans le titre.

Réponds UNIQUEMENT avec ce JSON :
{"nom":null,"prenom":null,"ipp":null,"date_naissance":null,"sexe":null,"age":null,
"taille_cm":null,"poids_kg":null,"surface_corporelle_m2":null,
"centre":null,"service":null,"medecin":null,"date_document":null,"confiance":0.9}`;

async function analyserIdentite(texte) {
  exigerCle();
  const debut = Date.now();
  // L'en-tête se trouve toujours en début de document : on limite l'envoi
  const extrait = String(texte || '').slice(0, 6000);

  let rep;
  try {
    rep = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: entetes(),
      body: JSON.stringify({
        model: MODELE,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: CONSIGNE_IDENTITE },
          { role: 'user', content: "En-tête du document :\n\n" + extrait }
        ]
      })
    });
  } catch (e) {
    throw new Error("Service Mistral injoignable : " + e.message);
  }
  if (!rep.ok) throw await erreurLisible(rep, "la lecture de l'identité");

  const data = await rep.json();
  const brut = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '{}';
  let p;
  try { p = JSON.parse(brut); }
  catch (_) { throw new Error("Réponse de l'IA illisible (JSON invalide)"); }

  const txt = v => (v == null || v === '') ? null : String(v).trim().slice(0, 200);
  const num = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  const dat = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v : null;

  const nom = txt(p.nom);
  const prenom = txt(p.prenom);

  return {
    identite: {
      nom:    nom ? nom.toUpperCase() : null,
      prenom: prenom ? prenom.toLowerCase().replace(/(^|[\s'-])([a-zà-öø-ÿ])/g,
                        (m, s, c) => s + c.toUpperCase()) : null,
      ipp:    txt(p.ipp),
      date_naissance: dat(p.date_naissance),
      sexe:   ['Homme','Femme','Autre'].includes(txt(p.sexe)) ? txt(p.sexe) : null,
      age:    num(p.age),
      taille_cm: num(p.taille_cm),
      poids_kg:  num(p.poids_kg),
      surface_corporelle_m2: num(p.surface_corporelle_m2),
      centre:  txt(p.centre),
      service: txt(p.service),
      medecin: txt(p.medecin),
      date_document: dat(p.date_document),
      confiance: num(p.confiance)
    },
    modele: MODELE,
    duree_ms: Date.now() - debut
  };
}

// ============================================================
// === Extraction spécialisée : compte-rendu d'échocardiographie
// ============================================================
const CONSIGNE_ECHO = `Tu extrais les données d'un compte-rendu d'ÉCHOCARDIOGRAPHIE TRANSTHORACIQUE (ETT) français.

Règles impératives :
- N'invente RIEN. Toute valeur absente du texte doit valoir null.
- Convertis les virgules décimales en points (35,5 -> 35.5).
- Respecte les unités indiquées dans les noms de champs. Si le document donne une valeur dans une autre unité, convertis-la (1 cm = 10 mm).
- aorte_max_mm : le plus grand des diamètres aortiques relevés. aorte_site_max : le niveau correspondant.
- Les marqueurs [NOM], [PRENOM], [IPP], [DATE_NAISSANCE] sont des anonymisations : ignore-les.
- exam_date au format AAAA-MM-JJ (attention : les dates françaises s'écrivent JJ/MM/AAAA).

Correspondances fréquentes dans ces comptes-rendus :
  "sinus de Valsalva" -> sinus_valsalva_mm
  "jonction sino-tubulaire" -> jonction_sinotub_mm
  "aorte thoracique ascendante" / "aorte ascendante" -> aorte_ascendante_mm
  "crosse aortique" -> crosse_aortique_mm
  "aorte thoracique descendante" -> aorte_descendante_mm
  "aorte abdominale" -> aorte_abdominale_mm
  "anneau aortique" -> anneau_aortique_mm
  DIVGd, DIVGs, SIVGd, PPVGd -> en cm
  "FR (Teicholz)" -> fr_teicholz_pct ; "FE (Teicholz)" -> fe_teicholz_pct ; "FEVG BP" -> fevg_bp_pct
  "MVG (ASE)" -> mvg_g ; "MVG ind" -> mvg_ind_g_m2 ; "h/R" -> h_sur_r
  "VTD/VTS A4C, A2C, BP" -> en mL ; "ind" -> version indexée en mL/m²
  "VE BP" -> ve_bp_ml ; "VTS OG BP" -> vts_og_bp_ml
  "Vit pic E VM" -> vit_pic_e_vm_cm_s ; "Vit pic A VM" -> vit_pic_a_vm_cm_s ; "TD VM" -> td_vm_s
  "Vmax VA" -> vmax_va_cm_s ; "ITV VA" -> itv_va_cm ; "Grad max VA" -> grad_max_va_mmhg
  "Vmax IT" -> vmax_it_cm_s ; "Grad max IT" -> grad_max_it_mmhg
  "SC" -> surface_corporelle_m2
  "Responsable du rapport" -> operateur

Réponds UNIQUEMENT avec un objet JSON contenant ces clés (null si absent) :
{"est_echocardiographie":true,"exam_date":null,"centre":null,"operateur":null,
"taille_cm":null,"poids_kg":null,"surface_corporelle_m2":null,
"anneau_aortique_mm":null,"sinus_valsalva_mm":null,"jonction_sinotub_mm":null,
"aorte_ascendante_mm":null,"crosse_aortique_mm":null,"aorte_descendante_mm":null,
"aorte_abdominale_mm":null,"aorte_max_mm":null,"aorte_site_max":null,
"divgd_cm":null,"divgs_cm":null,"sivgd_cm":null,"ppvgd_cm":null,
"fr_teicholz_pct":null,"fe_teicholz_pct":null,"fevg_bp_pct":null,
"mvg_g":null,"mvg_ind_g_m2":null,"h_sur_r":null,
"vtd_a4c_ml":null,"vts_a4c_ml":null,"vtd_a2c_ml":null,"vts_a2c_ml":null,
"vtd_bp_ml":null,"vts_bp_ml":null,"vtd_bp_ind_ml_m2":null,"vts_bp_ind_ml_m2":null,
"ve_bp_ml":null,"ve_bp_ind_ml_m2":null,
"vts_og_bp_ml":null,"vts_og_bp_ind_ml_m2":null,
"vit_pic_e_vm_cm_s":null,"vit_pic_a_vm_cm_s":null,"td_vm_s":null,
"vmax_va_cm_s":null,"itv_va_cm":null,"grad_max_va_mmhg":null,
"vmax_it_cm_s":null,"grad_max_it_mmhg":null,
"vg_texte":null,"vd_texte":null,"oreillettes_texte":null,
"valve_mitrale_texte":null,"valve_tricuspide_texte":null,"valve_aortique_texte":null,
"gros_vaisseaux_texte":null,"conclusion":null,
"aorte_operee":null,"aorte_operee_date":null,"aorte_operee_type":null,
"confiance":0.9}

Si le document n'est PAS une échocardiographie, réponds {"est_echocardiographie":false}.`;

const CHAMPS_NUM_ECHO = [
  'taille_cm','poids_kg','surface_corporelle_m2',
  'anneau_aortique_mm','sinus_valsalva_mm','jonction_sinotub_mm','aorte_ascendante_mm',
  'crosse_aortique_mm','aorte_descendante_mm','aorte_abdominale_mm','aorte_max_mm',
  'divgd_cm','divgs_cm','sivgd_cm','ppvgd_cm','fr_teicholz_pct','fe_teicholz_pct','fevg_bp_pct',
  'mvg_g','mvg_ind_g_m2','h_sur_r','vtd_a4c_ml','vts_a4c_ml','vtd_a2c_ml','vts_a2c_ml',
  'vtd_bp_ml','vts_bp_ml','vtd_bp_ind_ml_m2','vts_bp_ind_ml_m2','ve_bp_ml','ve_bp_ind_ml_m2',
  'vts_og_bp_ml','vts_og_bp_ind_ml_m2','vit_pic_e_vm_cm_s','vit_pic_a_vm_cm_s','td_vm_s',
  'vmax_va_cm_s','itv_va_cm','grad_max_va_mmhg','vmax_it_cm_s','grad_max_it_mmhg','confiance'
];
const CHAMPS_TXT_ECHO = [
  'centre','operateur','aorte_site_max','vg_texte','vd_texte','oreillettes_texte',
  'valve_mitrale_texte','valve_tricuspide_texte','valve_aortique_texte',
  'gros_vaisseaux_texte','conclusion','aorte_operee_type'
];

async function analyserEcho(texte) {
  exigerCle();
  const debut = Date.now();
  const extrait = String(texte || '').slice(0, 60000);

  let rep;
  try {
    rep = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: entetes(),
      body: JSON.stringify({
        model: MODELE,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: CONSIGNE_ECHO },
          { role: 'user', content: 'Compte-rendu à analyser :\n\n' + extrait }
        ]
      })
    });
  } catch (e) {
    throw new Error("Service Mistral injoignable : " + e.message);
  }
  if (!rep.ok) throw await erreurLisible(rep, "l'analyse ETT");

  const data = await rep.json();
  const brut = data && data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '{}';
  let p;
  try { p = JSON.parse(brut); }
  catch (_) { throw new Error("Réponse de l'IA illisible (JSON invalide)"); }

  if (!p || p.est_echocardiographie === false) {
    return { est_echo: false, echo: null, modele: MODELE, duree_ms: Date.now() - debut };
  }

  const echo = {};
  const nombre = v => (v == null || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);
  CHAMPS_NUM_ECHO.forEach(k => { echo[k] = nombre(p[k]); });
  CHAMPS_TXT_ECHO.forEach(k => { echo[k] = (p[k] == null || p[k] === '') ? null : String(p[k]).slice(0, 3000); });
  echo.exam_date = /^\d{4}-\d{2}-\d{2}$/.test(p.exam_date || '') ? p.exam_date : null;
  echo.aorte_operee = (p.aorte_operee === true || p.aorte_operee === false) ? p.aorte_operee : null;
  echo.aorte_operee_date = /^\d{4}-\d{2}-\d{2}$/.test(p.aorte_operee_date || '') ? p.aorte_operee_date : null;

  // Diamètre maximal : recalculé si l'IA ne l'a pas fourni
  if (echo.aorte_max_mm == null) {
    const niveaux = [
      ['Anneau aortique', echo.anneau_aortique_mm],
      ['Sinus de Valsalva', echo.sinus_valsalva_mm],
      ['Jonction sino-tubulaire', echo.jonction_sinotub_mm],
      ['Aorte ascendante', echo.aorte_ascendante_mm],
      ['Crosse aortique', echo.crosse_aortique_mm],
      ['Aorte descendante', echo.aorte_descendante_mm],
      ['Aorte abdominale', echo.aorte_abdominale_mm]
    ].filter(x => x[1] != null);
    if (niveaux.length) {
      const max = niveaux.reduce((a, b) => (b[1] > a[1] ? b : a));
      echo.aorte_max_mm = max[1];
      if (!echo.aorte_site_max) echo.aorte_site_max = max[0];
    }
  }

  return { est_echo: true, echo, modele: MODELE, duree_ms: Date.now() - debut };
}

/** Diagnostic de configuration, sans jamais exposer la clé */
function statutIA() {
  const k = process.env.MISTRAL_API_KEY || '';
  return {
    fournisseur: 'Mistral AI (Europe)',
    cle_configuree: cleActive(),
    cle_apercu: k ? (k.slice(0, 5) + '…' + k.slice(-4)) : null,
    modele_analyse: MODELE,
    modele_ocr: MODELE_OCR,
    endpoint: BASE,
    pseudonymisation: 'active'
  };
}

module.exports = {
  analyserTexte, analyserEcho, analyserIdentite, ocrDocument,
  pseudonymiser, statutIA, cleActive,
  CHAMPS_NUM_ECHO, CHAMPS_TXT_ECHO
};
