/**
 * ============================================================
 * SERVEUR EXPRESS — Marfan APA
 * Express + PostgreSQL + JWT
 * Cible : O2switch (cPanel Setup Node.js App)
 * ============================================================
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;

// ============================================================
// SÉCURITÉ & MIDDLEWARES GLOBAUX
// ============================================================
app.set('trust proxy', 1); // O2switch est derrière un reverse proxy

app.use(helmet({
  contentSecurityPolicy: false,             // Désactivé car frontend a beaucoup d'inline
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(compression());

const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);                  // requêtes server-to-server
    if (!corsOrigins.length || corsOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: origine non autorisée : ' + origin));
  },
  credentials: true
}));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

// Rate limit global (anti-DoS basique)
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 200,
  message: { error: 'Trop de requêtes, ressayez plus tard.' }
});
app.use('/api/', limiter);

// Création du dossier uploads si nécessaire
const uploadDir = path.resolve(__dirname, process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// ============================================================
// HEALTHCHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ============================================================
// ROUTES — montées dans un ordre logique
// ============================================================
app.use('/api/auth',           require('./routes/auth'));
app.use('/api/users',          require('./routes/users'));
app.use('/api/patients',       require('./routes/patients'));
app.use('/api/evaluations',    require('./routes/evaluations'));
app.use('/api/notifications',  require('./routes/notifications'));
app.use('/api/education',      require('./routes/education'));
app.use('/api/analyses',       require('./routes/analyses'));
app.use('/api/visio',          require('./routes/visio'));
app.use('/api/cohort',         require('./routes/cohort'));

// ============================================================
// SERVIR LE FRONTEND STATIQUE
// (en prod sur O2switch, l'HTML peut être servi par Apache directement
//  ou ici en fallback)
// ============================================================
const publicDir = path.resolve(__dirname, '../public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Route API inconnue' });
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// ============================================================
// GESTION D'ERREURS
// ============================================================
app.use((err, req, res, next) => {
  console.error('[ERR]', err.message, err.stack);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.message || 'Erreur interne',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

// ============================================================
// DÉMARRAGE
// ============================================================
app.listen(PORT, () => {
  console.log(`✓ Marfan APA API démarrée sur le port ${PORT}`);
  console.log(`  Env : ${process.env.NODE_ENV || 'development'}`);
  console.log(`  DB  : ${process.env.DATABASE_URL ? 'DATABASE_URL' : process.env.DB_HOST + ':' + process.env.DB_PORT + '/' + process.env.DB_NAME}`);
  console.log(`  CORS: ${corsOrigins.length ? corsOrigins.join(', ') : '*'}`);
});

// Sécurité : arrêter proprement sur SIGTERM
['SIGINT', 'SIGTERM'].forEach(sig => {
  process.on(sig, () => {
    console.log(`Arrêt sur ${sig}...`);
    process.exit(0);
  });
});
