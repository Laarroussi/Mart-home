#!/usr/bin/env node
/**
 * migrer.js — Applique les migrations qui manquent, et seulement celles-là
 * =======================================================================
 *
 * Écrit après avoir perdu deux fois du temps sur la même panne : une
 * migration oubliée, une colonne absente, et une erreur SQL qui ne dit pas
 * laquelle des quarante-cinq n'est pas passée.
 *
 * Le principe tient en une table. `schema_migrations` retient le nom de
 * chaque fichier déjà appliqué ; ce script lit le dossier, compare, et
 * n'exécute que la différence. Lancé deux fois de suite, le second passage
 * n'a plus rien à faire.
 *
 * ── Pourquoi une étape d'amorçage ───────────────────────────────────────
 * Les migrations 001 à 044 ont été appliquées à la main, sans trace. Les
 * rejouer en bloc serait dangereux : la 012 contient
 *
 *     UPDATE patients SET is_demo = TRUE WHERE created_at < NOW()
 *
 * qui marquerait aujourd'hui TOUS les dossiers réels comme dossiers de
 * démonstration, et les ferait disparaître des listes. « Idempotent » ne veut
 * pas dire « sans effet » : cette instruction-là peut être rejouée sans
 * erreur, et c'est précisément le problème.
 *
 * D'où `--depuis NNN` : on déclare que tout ce qui précède est déjà en base
 * (sans l'exécuter), et on n'applique réellement que la suite. C'est une
 * affirmation de l'opérateur, pas une déduction du script — il n'a aucun
 * moyen de vérifier qu'une migration ancienne est passée.
 *
 * ── Usage ───────────────────────────────────────────────────────────────
 *   cd ~/public_html/marfantraining/backend
 *   node db/migrer.js --depuis 043     première fois : amorce puis applique
 *   node db/migrer.js                  ensuite : applique ce qui est nouveau
 *   node db/migrer.js --liste          ne touche à rien, montre l'état
 *
 * Chaque fichier est exécuté d'un bloc. PostgreSQL enveloppe un envoi
 * multi-instructions dans une transaction implicite : si une instruction
 * échoue, le fichier entier est annulé et rien n'est enregistré comme
 * appliqué. On ne se retrouve donc jamais avec une migration à moitié passée
 * mais marquée faite.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

const DOSSIER = path.join(__dirname, 'migrations');

// ------------------------------------------------------------
// Arguments
// ------------------------------------------------------------
const args = process.argv.slice(2);
const liste = args.includes('--liste');
const iDepuis = args.indexOf('--depuis');
const depuis = iDepuis >= 0 ? String(args[iDepuis + 1] || '').trim() : null;

if (iDepuis >= 0 && !/^\d{3}$/.test(depuis || '')) {
  console.error('--depuis attend un numéro à trois chiffres, par exemple : --depuis 043');
  process.exit(2);
}

/** Numéro de tête du fichier : « 043_etudes_synopsis.sql » → « 043 ». */
function numero(fichier) {
  const m = /^(\d{3})/.exec(fichier);
  return m ? m[1] : null;
}

async function principal() {
  const fichiers = fs.readdirSync(DOSSIER)
    .filter((f) => f.endsWith('.sql'))
    .sort();                        // les noms sont numérotés : l'ordre alphabétique est l'ordre chronologique

  if (!fichiers.length) {
    console.log('Aucun fichier de migration trouvé dans ' + DOSSIER);
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      nom         TEXT PRIMARY KEY,
      applique_le TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      amorce      BOOLEAN NOT NULL DEFAULT FALSE
    )`);

  const deja = new Set(
    (await pool.query('SELECT nom FROM schema_migrations')).rows.map((r) => r.nom)
  );

  // ---------- amorçage ----------
  if (depuis) {
    const anterieures = fichiers.filter((f) => {
      const n = numero(f);
      return n && n < depuis && !deja.has(f);
    });
    for (const f of anterieures) {
      await pool.query(
        'INSERT INTO schema_migrations (nom, amorce) VALUES ($1, TRUE) ON CONFLICT (nom) DO NOTHING',
        [f]
      );
      deja.add(f);
    }
    if (anterieures.length) {
      console.log('Amorçage : ' + anterieures.length + ' migration(s) antérieures à ' + depuis +
                  ' déclarées déjà appliquées, sans être exécutées.');
    }
  }

  const aFaire = fichiers.filter((f) => !deja.has(f));

  // ---------- état seul ----------
  if (liste) {
    console.log('\nÉtat des migrations\n' + '-'.repeat(52));
    for (const f of fichiers) {
      console.log((deja.has(f) ? '  appliquée  ' : '  À FAIRE    ') + f);
    }
    console.log('-'.repeat(52));
    console.log(aFaire.length ? aFaire.length + ' migration(s) à appliquer.' : 'Rien à faire.');
    return;
  }

  if (!aFaire.length) {
    console.log('Base à jour : ' + fichiers.length + ' migration(s), rien de nouveau.');
    return;
  }

  console.log(aFaire.length + ' migration(s) à appliquer.\n');

  for (const f of aFaire) {
    const sql = fs.readFileSync(path.join(DOSSIER, f), 'utf8');
    process.stdout.write('  ' + f + ' … ');
    try {
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (nom) VALUES ($1)', [f]);
      console.log('appliquée');
    } catch (e) {
      console.log('ÉCHEC');
      console.error('\n' + f + ' n\'est pas passée, et n\'a PAS été enregistrée :');
      console.error('  ' + (e && e.message));
      if (e && e.hint) console.error('  indice : ' + e.hint);
      console.error('\nLa transaction de ce fichier a été annulée ; la base est dans l\'état ' +
                    'où elle était avant lui. Les migrations suivantes ne sont pas tentées.');
      process.exitCode = 1;
      return;
    }
  }

  console.log('\nTerminé.');
}

principal()
  .catch((e) => {
    console.error('Migration interrompue : ' + (e && e.message));
    process.exitCode = 1;
  })
  .then(() => pool.end());
