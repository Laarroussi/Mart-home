/**
 * db/reset-script.js — Réinitialise complètement la base (⚠ supprime tout)
 * Usage : npm run db:reset
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('✖ DATABASE_URL introuvable dans .env');
    process.exit(1);
  }

  const sql = fs.readFileSync(path.join(__dirname, 'reset.sql'), 'utf8');
  const client = new Client({ connectionString: url, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false });

  try {
    await client.connect();
    console.log('▶ Suppression des tables et vues existantes...');
    await client.query(sql);
    console.log('✓ Base réinitialisée. Pensez à relancer : npm run db:init && npm run db:seed');
  } catch (err) {
    console.error('✖ Échec :', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
