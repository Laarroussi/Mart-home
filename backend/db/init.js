/**
 * db/init.js — Applique schema.sql en chargeant proprement .env
 * Remplace `psql $DATABASE_URL -f db/schema.sql` qui dépendait du shell.
 *
 * Usage : npm run db:init
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
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
  const sql = fs.readFileSync(sqlPath, 'utf8');

  // Masque le mot de passe pour les logs
  const safeUrl = url.replace(/:([^:@/]+)@/, ':***@');
  console.log('▶ Connexion à :', safeUrl);

  const client = new Client({
    connectionString: url,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('✓ Connecté à PostgreSQL');
    console.log('▶ Exécution de schema.sql (' + Math.round(sql.length / 1024) + ' Ko)...');
    await client.query(sql);
    console.log('✓ Schéma appliqué avec succès.');

    // Liste les tables créées pour vérification
    const { rows } = await client.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    console.log('\nTables créées (' + rows.length + ') :');
    rows.forEach(r => console.log('  • ' + r.table_name));
  } catch (err) {
    console.error('\n✖ Échec :', err.message);
    if (err.code === '28P01') console.error('  → Mot de passe incorrect dans DATABASE_URL');
    if (err.code === '3D000') console.error('  → Base de données inexistante (vérifier le nom préfixé : jost2290_xxx)');
    if (err.code === 'ECONNREFUSED') console.error('  → PostgreSQL ne répond pas sur localhost:5432');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
