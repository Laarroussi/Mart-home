/**
 * run.js — Exécute un fichier SQL sur la base, depuis le Terminal cPanel
 * =======================================================================
 *
 * Ce script vivait dans /tmp, que le serveur vide régulièrement. On le
 * recréait alors à la main, en recopiant un bloc de vingt lignes — avec le
 * risque qu'une version diffère de la précédente, et qu'un comportement
 * change sans qu'on sache pourquoi. Il est donc versionné avec le reste.
 *
 * Usage, depuis ~/public_html/marfantraining/backend, environnement activé :
 *
 *   node db/maintenance/run.js db/migrations/036_echo_champs_compte_rendu.sql
 *
 * Il affiche les messages RAISE NOTICE du serveur au fil de l'eau, puis
 * chaque tableau de résultat. Une erreur SQL est affichée en clair et ne
 * laisse pas la connexion ouverte.
 */
const fs = require('fs');
const path = require('path');

const fichier = process.argv[2];
if (!fichier) {
  console.error('Usage : node db/maintenance/run.js <fichier.sql>');
  process.exit(1);
}

const chemin = path.resolve(process.cwd(), fichier);
if (!fs.existsSync(chemin)) {
  console.error('Fichier introuvable : ' + chemin);
  console.error('Lancez la commande depuis ~/public_html/marfantraining/backend');
  process.exit(1);
}

// Le pool de l'application : mêmes identifiants, mêmes réglages TLS. Se
// connecter autrement reviendrait à tester une base qui n'est pas celle que
// l'application utilise.
const { pool } = require(path.resolve(__dirname, '../../config/database'));

(async () => {
  const client = await pool.connect();
  // Les RAISE NOTICE sont l'essentiel du retour des scripts de maintenance :
  // sans cet écouteur, un script annonçant « 12 lignes supprimées » ne dirait
  // rien du tout.
  client.on('notice', n => console.log('  ' + n.message));

  try {
    const sql = fs.readFileSync(chemin, 'utf8');
    console.log('— ' + path.basename(chemin) + ' —\n');
    const res = await client.query(sql);
    (Array.isArray(res) ? res : [res]).forEach(r => {
      if (r && r.rows && r.rows.length) console.table(r.rows);
    });
    console.log('\nOK');
  } catch (e) {
    console.error('\nERREUR SQL : ' + e.message);
    if (e.hint) console.error('Indication : ' + e.hint);
    if (e.position) console.error('Position dans le fichier : ' + e.position);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
