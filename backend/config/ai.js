/**
 * ============================================================
 * EXTRACTION IA — Marfan APA
 * ============================================================
 * Lit un texte de document médical et en extrait des faits datés
 * (mesures, biologie, traitements, opérations, examens, diagnostics).
 *
 * Fournisseur : OpenAI. La clé vit UNIQUEMENT côté serveur, dans .env
 * (OPENAI_API_KEY). Elle n'est jamais transmise au navigateur.
 *
 * Aucune dépendance npm : on utilise fetch, natif à partir de Node 18.
 *
 * Confidentialité : le texte reçu ici est déjà pseudonymisé côté serveur
 * par pseudonymiser() avant tout envoi. Nom, prénom, IPP, date de naissance,
 * e-mail, téléphone et NIR sont remplacés par des marqueurs.
 * ============================================================
 */

const MODELE = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const URL_API = 'https://api.openai.com/v1/chat/completions';

function cleActive() {
  return !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
}

/**
 * Retire du texte les éléments directement identifiants.
 * On travaille sur le texte brut du document : l'objectif est que le
 * prestataire d'IA ne reçoive que du contenu clinique.
 */
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

  // Date de naissance, sous ses formats courants
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

  // Numéro de sécurité sociale français (15 chiffres, espaces tolérés)
  t = t.replace(/\b[12]\s?\d{2}\s?\d{2}\s?\d{2,3}\s?\d{3}\s?\d{3}\s?\d{2}\b/g, '[NIR]');
  // Adresses e-mail et téléphones résiduels
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[EMAIL]');
  t = t.replace(/\b0[1-9](?:[\s.-]?\d{2}){4}\b/g, '[TEL]');

  return t;
}

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

/**
 * Analyse un texte et renvoie { faits: [...], modele, duree_ms }
 */
async function analyserTexte(texte) {
  if (!cleActive()) {
    const e = new Error("Aucune clé OpenAI configurée sur le serveur (OPENAI_API_KEY absente dans .env)");
    e.code = 'NO_KEY';
    throw e;
  }
  const debut = Date.now();
  // Les comptes-rendus peuvent être longs : on borne pour maîtriser le coût
  const extrait = String(texte || '').slice(0, 60000);

  let rep;
  try {
    rep = await fetch(URL_API, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY.trim(),
        'Content-Type': 'application/json'
      },
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
    throw new Error("Service d'IA injoignable : " + e.message);
  }

  if (!rep.ok) {
    let detail = '';
    try { const j = await rep.json(); detail = (j.error && j.error.message) || ''; } catch (_) {}
    if (rep.status === 401) throw new Error("Clé OpenAI refusée (401). Vérifiez OPENAI_API_KEY dans .env.");
    if (rep.status === 429) throw new Error("Quota OpenAI atteint ou trop de requêtes (429). " + detail);
    throw new Error("Erreur OpenAI " + rep.status + (detail ? ' — ' + detail : ''));
  }

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
  const k = process.env.OPENAI_API_KEY || '';
  return {
    cle_configuree: cleActive(),
    cle_apercu: k ? (k.slice(0, 7) + '…' + k.slice(-4)) : null,
    modele: MODELE,
    pseudonymisation: 'active'
  };
}

module.exports = { analyserTexte, pseudonymiser, statutIA, cleActive };
