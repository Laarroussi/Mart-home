/**
 * ============================================================
 * Helpers pour la création automatique de comptes
 * ============================================================
 * - generateUsername(firstName, lastName) : prenom.nom normalisé
 * - findUniqueUsername(base, isTakenAsync) : ajoute un suffixe numérique si doublon
 * - formatBirthDateAsPassword(birthDate)  : "JJ/MM/AAAA" pour le mdp initial
 * - validateNewPassword(newPwd, oldPwd?, birthDate?) : règles de robustesse
 * ============================================================
 */
const { query } = require('../config/database');

/**
 * Normalise une chaîne pour usage en username :
 *   - Retire les accents
 *   - Minuscules
 *   - Garde uniquement [a-z0-9-]
 *   - Trim
 */
function normalizeForUsername(str) {
  if (!str) return '';
  return String(str)
    .normalize('NFD')                              // décompose accents
    .replace(/[̀-ͯ]/g, '')               // retire les diacritiques (combining marks)
    .toLowerCase()
    .replace(/['"]/g, '')            // retire apostrophes / guillemets
    .replace(/[^a-z0-9-]+/g, '-')    // remplace tout autre car par -
    .replace(/^-+|-+$/g, '')         // trim tirets
    .replace(/-+/g, '-');            // dédoublonne tirets
}

/**
 * Génère un username à partir d'un prénom et d'un nom :
 *   "Jean", "Dupont"              → "jean.dupont"
 *   "Marie-Claire", "Léa Müller"  → "marie-claire.lea-muller"
 *   "François", "O'Brien"         → "francois.obrien"
 */
function generateUsername(firstName, lastName) {
  const f = normalizeForUsername(firstName);
  const l = normalizeForUsername(lastName);
  if (!f && !l) return '';
  if (!f) return l;
  if (!l) return f;
  return `${f}.${l}`;
}

/**
 * Cherche un username unique en BDD en ajoutant un suffixe numérique si besoin.
 *   - "jean.dupont"   (si libre)
 *   - "jean.dupont2"  (si "jean.dupont" pris)
 *   - "jean.dupont3"  (si les 2 sont pris)
 * Max 999 tentatives pour éviter une boucle infinie.
 */
async function findUniqueUsername(base) {
  if (!base) throw new Error('Base username vide');
  // 1re tentative : la base seule
  let candidate = base;
  const { rows } = await query('SELECT id FROM users WHERE username = $1', [candidate]);
  if (!rows.length) return candidate;
  // 2-999 : ajoute un suffixe
  for (let i = 2; i <= 999; i++) {
    candidate = `${base}${i}`;
    const r = await query('SELECT id FROM users WHERE username = $1', [candidate]);
    if (!r.rows.length) return candidate;
  }
  throw new Error('Impossible de trouver un username libre (999 collisions)');
}

/**
 * Convertit une date de naissance (ISO ou Date) en mot de passe initial JJ/MM/AAAA.
 *   "1980-09-25"     → "25/09/1980"
 *   "1980-09-25T..." → "25/09/1980"
 *   Date object      → "25/09/1980"
 */
function formatBirthDateAsPassword(birthDate) {
  if (!birthDate) return '';
  let d;
  if (birthDate instanceof Date) {
    d = birthDate;
  } else {
    // Accepte "YYYY-MM-DD" ou ISO complet
    const s = String(birthDate).slice(0, 10); // garde YYYY-MM-DD
    d = new Date(s + 'T12:00:00Z');           // midi UTC pour éviter les soucis de fuseau
  }
  if (isNaN(d.getTime())) throw new Error('Date de naissance invalide : ' + birthDate);
  const jj   = String(d.getUTCDate()).padStart(2, '0');
  const mm   = String(d.getUTCMonth() + 1).padStart(2, '0');
  const aaaa = String(d.getUTCFullYear());
  return `${jj}/${mm}/${aaaa}`;
}

/**
 * Valide un nouveau mot de passe :
 *   - longueur min 8
 *   - différent de l'ancien (si fourni)
 *   - différent de la date de naissance au format JJ/MM/AAAA (si fournie)
 *   - contient au moins 1 lettre et 1 chiffre OU au moins 1 caractère spécial
 * Retourne { ok: true } ou { ok: false, error: "..." }
 */
function validateNewPassword(newPwd, opts = {}) {
  if (!newPwd || newPwd.length < 8) {
    return { ok: false, error: 'Le mot de passe doit faire au moins 8 caractères.' };
  }
  if (opts.oldPassword && newPwd === opts.oldPassword) {
    return { ok: false, error: 'Le nouveau mot de passe doit être différent de l\'ancien.' };
  }
  if (opts.birthDate) {
    const dobPwd = formatBirthDateAsPassword(opts.birthDate);
    if (newPwd === dobPwd) {
      return { ok: false, error: 'Le nouveau mot de passe ne peut pas être votre date de naissance.' };
    }
  }
  const hasLetter  = /[a-zA-Z]/.test(newPwd);
  const hasDigit   = /\d/.test(newPwd);
  const hasSpecial = /[^a-zA-Z0-9]/.test(newPwd);
  if (!hasLetter || (!hasDigit && !hasSpecial)) {
    return { ok: false, error: 'Le mot de passe doit contenir au moins 1 lettre et (1 chiffre ou 1 caractère spécial).' };
  }
  return { ok: true };
}

module.exports = {
  normalizeForUsername,
  generateUsername,
  findUniqueUsername,
  formatBirthDateAsPassword,
  validateNewPassword
};
