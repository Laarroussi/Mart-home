/**
 * Middlewares d'authentification & permissions
 * - requireAuth : exige un token JWT valide → req.user populated
 * - requireRole : exige que req.user.role appartienne à la liste
 */
const jwt = require('jsonwebtoken');
const { query } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[AUTH] JWT_SECRET manquant ou trop court (<32 caractères). Définissez-le dans .env');
  process.exit(1);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
  );
}

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token manquant' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Vérifie que l'utilisateur existe toujours et est actif
    const { rows } = await query('SELECT id, role, name, email, active, patient_id FROM users WHERE id = $1', [payload.id]);
    if (!rows.length || !rows[0].active) return res.status(401).json({ error: 'Compte inactif ou supprimé' });
    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Rôle requis : ${roles.join(' ou ')}. Vous êtes ${req.user.role}.` });
    }
    next();
  };
}

// Helpers de rôles
const isInvestigator = (role) => ['admin', 'principal', 'investigator'].includes(role);
const canManageUsers = (role) => ['admin', 'principal'].includes(role);

module.exports = { signToken, requireAuth, requireRole, isInvestigator, canManageUsers };
