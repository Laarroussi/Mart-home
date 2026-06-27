/**
 * db/init.js — Applique schema.sql via psql (sous-processus)
 * Charge .env automatiquement, puis appelle psql natif qui gère
 * correctement les CREATE FUNCTION / TRIGGER avec délimiteurs $$.
 *
 * Usage : npm run db:init
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✖ DATABASE_URL introuvable dans .env');
    console.error('  Vérifiez que backend/.env existe et contient DATABASE_URL=postgres://...');
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, 'schema.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error('✖ Fichier introuvable :', sqlPath);
    process.exit(1);
  }

  // Masque le mot de passe pour les logs
  const safeUrl = url.replace(/:([^:@/]+)@/, ':***@');
  console.log('▶ Connexion à :', safeUrl);
  console.log('▶ Exécution de schema.sql via psql...');

  // psql gère nativement les fonctions/triggers avec $$
  // -v ON_ERROR_STOP=1 arrête à la première erreur (mieux pour CI)
  const result = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', sqlPath], {
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    console.error('✖ Impossible de lancer psql :', result.error.message);
    console.error('  → Vérifier que psql est installé sur le serveur (commande : which psql)');
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error('\n✖ psql a échoué (code ' + result.status + ')');
    process.exit(result.status || 1);
  }

  // Vérification post-exécution : liste les tables créées via pg
  console.log('\n▶ Vérification des tables créées...');
  const client = new Client({ connectionString: url, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
    );
    console.log('✓ Tables créées (' + rows.length + ') :');
    rows.forEach(r => console.log('  • ' + r.table_name));
  } catch (err) {
    console.error('⚠ Vérification impossible :', err.message);
  } finally {
    await client.end();
  }
}

main();
