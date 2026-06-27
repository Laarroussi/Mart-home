/**
 * db/reset-script.js — Réinitialise complètement la base (⚠ supprime tout)
 * Utilise psql en sous-processus pour compat maximale.
 * Usage : npm run db:reset
 */
require('dotenv').config();
const path = require('path');
const { spawnSync } = require('child_process');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✖ DATABASE_URL introuvable dans .env');
  process.exit(1);
}

console.log('▶ Suppression des tables et vues existantes...');
const result = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', path.join(__dirname, 'reset.sql')], {
  stdio: 'inherit',
  env: process.env
});
if (result.status !== 0) {
  console.error('✖ Reset échoué (code ' + result.status + ')');
  process.exit(result.status || 1);
}
console.log('✓ Base réinitialisée.');
