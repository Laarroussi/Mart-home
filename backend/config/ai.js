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

module.exports = { analyserTexte, ocrDocument, pseudonymiser, statutIA, cleActive };
