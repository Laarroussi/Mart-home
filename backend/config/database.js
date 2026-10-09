/**
 * Connexion PostgreSQL (pool partagé)
 * Utilise DATABASE_URL ou les variables DB_* individuelles.
 */
const { Pool } = require('pg');
require('dotenv').config();

/**
 * Réglage TLS de la connexion à la base.
 *
 * Tant que la base tourne sur la même machine que l'application, le
 * chiffrement n'apporte rien : rien ne sort du serveur. Le jour où elle sera
 * déportée — hébergeur certifié ou non — les requêtes traverseront internet,
 * et elles transporteront des noms, des IPP et des diagnostics.
 *
 * Le réglage précédent, `rejectUnauthorized: false`, chiffrait sans vérifier
 * l'identité du serveur. C'est une protection en trompe-l'œil : la liaison
 * est illisible pour un observateur passif, mais rien n'empêche quelqu'un de
 * se faire passer pour la base et de recevoir les données en clair. Pour des
 * données de santé, cela ne suffit pas.
 *
 * Trois réglages possibles via l'environnement :
 *   DB_SSL=false            — pas de chiffrement (base locale, situation actuelle)
 *   DB_SSL=true             — chiffré ET certificat vérifié (le bon réglage distant)
 *   DB_SSL=true + DB_SSL_CA — idem, avec l'autorité fournie par l'hébergeur
 *                             (OVHcloud et Scaleway en délivrent une)
 *
 * DB_SSL_NO_VERIFY=true reste possible pour un dépannage ponctuel, mais le
 * serveur l'écrit dans ses journaux : un contournement temporaire ne doit pas
 * devenir un état permanent que personne ne remarque.
 */
function reglageSsl() {
  if (process.env.DB_SSL !== 'true') return false;
  if (process.env.DB_SSL_NO_VERIFY === 'true') {
    console.warn('[DB] ATTENTION : certificat du serveur non vérifié (DB_SSL_NO_VERIFY). ' +
                 'À ne pas laisser en production.');
    return { rejectUnauthorized: false };
  }
  const ca = process.env.DB_SSL_CA;
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

const config = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: reglageSsl()
    }
  : {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT, 10) || 5432,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      ssl: reglageSsl()
    };

const pool = new Pool({
  ...config,
  max: 20,                    // 20 connexions max
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('[DB] Erreur inattendue sur client inactif :', err.message);
});

/**
 * Helper : exécute une requête et retourne directement rows.
 * Logue toutes les erreurs avec la requête concernée.
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production' && duration > 100) {
      console.log('[DB] requête lente', { text: text.substring(0, 80), duration, rows: res.rowCount });
    }
    return res;
  } catch (err) {
    console.error('[DB] erreur SQL', { sql: text.substring(0, 200), params, error: err.message });
    throw err;
  }
}

/**
 * Helper : exécute une transaction.
 */
async function transaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaction };
