/**
 * /api/backup — Sauvegarde et restauration complète de la plateforme
 *
 * Accès : principal_admin UNIQUEMENT.
 *
 * Endpoints :
 *   - GET  /api/backup/status            → date et taille de la dernière sauvegarde générée
 *   - POST /api/backup/export            → génère et télécharge un fichier .backup.zip
 *   - POST /api/backup/inspect           → upload un .backup.zip ; renvoie le manifest + résumé
 *                                          SANS rien restaurer (pour confirmation visuelle)
 *   - POST /api/backup/restore           → restaure le contenu d'un .backup.zip (transaction)
 *                                          Body multipart : file (.backup.zip) + confirm=true
 *                                          + optionnel : forcePasswordChange (booléen) qui passe
 *                                          must_change_password à TRUE pour tous les comptes
 *
 * Sécurité :
 *   - Vérification stricte du rôle (defense in depth)
 *   - Pas de stockage côté serveur du fichier exporté (streaming direct)
 *   - Pas de lien public : seul un appel authentifié peut télécharger
 *   - Hash SHA-256 inclus dans le manifest pour contrôle d'intégrité
 *   - Les mots de passe sont déjà hashés en BDD → exportés en hash, jamais en clair
 *   - Toute action est journalisée dans notification_log
 */
const express = require('express');
const multer  = require('multer');
const crypto  = require('crypto');
const JSZip   = require('jszip');
const { query, pool } = require('../config/database');
const { requireAuth, requireRole, ROLE } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } }); // 100 MB max

const BACKUP_VERSION = '1.0.0';
const SCHEMA_VERSION = '004';  // dernière migration appliquée

// ============================================================
// Liste des tables à inclure dans la sauvegarde, dans l'ordre
// de restauration (parent → enfant pour respecter les FK)
// ============================================================
const BACKUP_TABLES = [
  { name: 'users',                file: 'users.json',                   order: 1, special: 'self_ref' },
  { name: 'patients',             file: 'patients.json',                order: 2 },
  { name: 'education_capsules',   file: 'education_capsules.json',      order: 3 },
  { name: 'videos',               file: 'videos.json',                  order: 4 },
  { name: 'evaluations',          file: 'evaluations.json',             order: 5 },
  { name: 'notifications',        file: 'notifications.json',           order: 6 },
  { name: 'education_records',    file: 'education_records.json',       order: 7 },
  { name: 'patient_videos',       file: 'patient_videos.json',          order: 8 },
  { name: 'visio_sessions',       file: 'visio_sessions.json',          order: 9 },
  { name: 'visio_participants',   file: 'visio_participants.json',      order: 10 },
  { name: 'notification_log',     file: 'audit_logs.json',              order: 11 }
];

// ============================================================
// Helper : dump une table en tableau de lignes
// ============================================================
async function dumpTable(name) {
  try {
    const { rows } = await query(`SELECT * FROM ${name} ORDER BY ${name === 'notification_log' || name === 'visio_participants' || name === 'patient_videos' || name === 'evaluations' || name === 'education_records' ? '1' : 'created_at NULLS LAST, 1'}`);
    return rows;
  } catch (e) {
    // Si la table n'existe pas (vieille install), on retourne []
    if (/relation .* does not exist/i.test(e.message)) return [];
    throw e;
  }
}

// ============================================================
// GET /api/backup/status — Infos sur les sauvegardes
// (pas de stockage persistant côté serveur → on retourne juste l'état actuel)
// ============================================================
router.get('/status', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), async (req, res, next) => {
  try {
    const counts = {};
    for (const t of BACKUP_TABLES) {
      try {
        const r = await query(`SELECT COUNT(*)::int AS n FROM ${t.name}`);
        counts[t.name] = r.rows[0].n;
      } catch (_) { counts[t.name] = 0; }
    }
    // Date de la dernière action 'backup-export' dans le journal
    let lastBackup = null;
    try {
      const r = await query(
        `SELECT created_at, user_id FROM notification_log
          WHERE action = 'backup-export' ORDER BY created_at DESC LIMIT 1`
      );
      if (r.rows.length) lastBackup = r.rows[0];
    } catch (_) {}
    res.json({
      backupVersion: BACKUP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      counts,
      lastBackup
    });
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/backup/export — Génère et télécharge un .backup.zip
// ============================================================
router.post('/export', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), async (req, res, next) => {
  try {
    const zip = new JSZip();
    const counts = {};
    const tableData = {};

    // 1. Dump de toutes les tables
    for (const t of BACKUP_TABLES) {
      const rows = await dumpTable(t.name);
      tableData[t.name] = rows;
      counts[t.name] = rows.length;
      zip.file(t.file, JSON.stringify(rows, null, 2));
    }

    // 2. Calcul du hash d'intégrité du contenu (avant d'ajouter le manifest)
    const concatenated = BACKUP_TABLES.map(t => JSON.stringify(tableData[t.name])).join('|');
    const sha256 = crypto.createHash('sha256').update(concatenated).digest('hex');

    // 3. Manifest
    const now = new Date();
    const manifest = {
      backupVersion: BACKUP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      generatedAt: now.toISOString(),
      generatedBy: { id: req.user.id, role: req.user.role, name: req.user.name },
      counts,
      integrity: { algo: 'sha256', value: sha256 },
      tables: BACKUP_TABLES.map(t => ({ name: t.name, file: t.file, order: t.order, count: counts[t.name] }))
    };
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));

    // 4. README court à destination de l'humain qui ouvre le ZIP
    zip.file('README.txt',
      'Sauvegarde Marfan APA\n' +
      '====================\n\n' +
      'Générée le : ' + now.toLocaleString('fr-FR') + '\n' +
      'Par         : ' + req.user.name + ' (' + req.user.email + ')\n' +
      'Version     : ' + BACKUP_VERSION + ' / schéma ' + SCHEMA_VERSION + '\n\n' +
      'Ce fichier contient TOUTES les données de la plateforme :\n' +
      '  - Comptes utilisateurs (mots de passe HASHÉS)\n' +
      '  - Patients et leurs évaluations longitudinales\n' +
      '  - Capsules éducation thérapeutique et résultats\n' +
      '  - Vidéos d\'entraînement et attributions patients\n' +
      '  - Séances Visio et participants\n' +
      '  - Notifications et journal de traçabilité\n\n' +
      'Conservez-le en lieu sûr et chiffré. La restauration via\n' +
      '/api/backup/restore écrasera toutes les données actuelles.\n'
    );

    // 5. Journalisation
    try {
      await query(
        'INSERT INTO notification_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
        [req.user.id, 'backup-export',
         JSON.stringify({ counts, sha256, sizeApprox: 'computed_on_send' }), req.ip]
      );
    } catch (e) { console.warn('Log backup-export échoué :', e.message); }

    // 6. Génération du buffer ZIP et envoi
    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const filename = 'marfan_apa_backup_' +
      now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      '.backup.zip';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('X-Backup-Sha256', sha256);
    res.send(buffer);
  } catch (err) { next(err); }
});

// ============================================================
// POST /api/backup/inspect — Lit un .backup.zip et retourne le manifest + counts
// Body multipart : file (le .backup.zip)
// Aucun écrit en BDD.
// ============================================================
router.post('/inspect', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Fichier .backup.zip requis' });
    const zip = await JSZip.loadAsync(req.file.buffer);
    const manifestEntry = zip.file('manifest.json');
    if (!manifestEntry) return res.status(400).json({ error: 'manifest.json absent → fichier invalide ou corrompu' });

    const manifest = JSON.parse(await manifestEntry.async('string'));

    // Recalcule le hash et compare
    const tableData = {};
    const presentTables = [];
    const missingTables = [];
    for (const t of (manifest.tables || BACKUP_TABLES)) {
      const entry = zip.file(t.file);
      if (entry) {
        try {
          tableData[t.name] = JSON.parse(await entry.async('string'));
          presentTables.push({ name: t.name, count: tableData[t.name].length });
        } catch (_) { missingTables.push(t.name); }
      } else {
        missingTables.push(t.name);
      }
    }
    let integrityOk = null;
    if (manifest.integrity && manifest.integrity.algo === 'sha256') {
      const concatenated = (manifest.tables || BACKUP_TABLES)
        .map(t => JSON.stringify(tableData[t.name] || []))
        .join('|');
      const sha256 = crypto.createHash('sha256').update(concatenated).digest('hex');
      integrityOk = (sha256 === manifest.integrity.value);
    }

    res.json({
      manifest,
      summary: {
        presentTables,
        missingTables,
        integrityOk,
        totalRows: presentTables.reduce((s, t) => s + t.count, 0)
      }
    });
  } catch (err) {
    res.status(400).json({ error: 'Lecture du ZIP échouée : ' + err.message });
  }
});

// ============================================================
// POST /api/backup/restore — Restaure le contenu d'un .backup.zip
// Body multipart : file (.backup.zip) + confirm=true + forcePasswordChange (optionnel)
// ============================================================
router.post('/restore', requireAuth, requireRole(ROLE.PRINCIPAL_ADMIN), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Fichier .backup.zip requis' });
    if (req.body.confirm !== 'true' && req.body.confirm !== true) {
      return res.status(400).json({ error: 'Confirmation explicite requise (confirm=true)' });
    }

    const zip = await JSZip.loadAsync(req.file.buffer);
    const manifestEntry = zip.file('manifest.json');
    if (!manifestEntry) return res.status(400).json({ error: 'manifest.json absent' });
    const manifest = JSON.parse(await manifestEntry.async('string'));

    // Compat de version
    if (manifest.backupVersion !== BACKUP_VERSION) {
      console.warn(`[backup-restore] Version différente : fichier=${manifest.backupVersion}, serveur=${BACKUP_VERSION}`);
    }

    // Charge tout le contenu en mémoire
    const data = {};
    for (const t of BACKUP_TABLES) {
      const entry = zip.file(t.file);
      data[t.name] = entry ? JSON.parse(await entry.async('string')) : [];
    }

    const forcePasswordChange = req.body.forcePasswordChange === 'true' || req.body.forcePasswordChange === true;
    const client = await pool.connect();
    const stats = {};

    try {
      await client.query('BEGIN');
      // Désactive temporairement les contraintes par TRUNCATE CASCADE
      // Ordre inverse pour TRUNCATE (enfant → parent)
      const reversed = [...BACKUP_TABLES].sort((a, b) => b.order - a.order);
      for (const t of reversed) {
        await client.query(`TRUNCATE TABLE ${t.name} RESTART IDENTITY CASCADE`);
      }

      // Insertion : ordre parent → enfant
      for (const t of BACKUP_TABLES) {
        const rows = data[t.name] || [];
        stats[t.name] = rows.length;
        if (!rows.length) continue;

        if (t.special === 'self_ref') {
          // users a une FK auto-référente created_by → on insère sans, puis on UPDATE
          for (const row of rows) {
            const tmp = Object.assign({}, row);
            const createdBy = tmp.created_by;
            tmp.created_by = null;
            await insertRow(client, t.name, tmp);
            if (createdBy) await client.query(
              `UPDATE users SET created_by = $1 WHERE id = $2`, [createdBy, tmp.id]
            );
          }
        } else {
          for (const row of rows) await insertRow(client, t.name, row);
        }
      }

      // Optionnel : force tous les utilisateurs à changer leur mot de passe
      if (forcePasswordChange) {
        await client.query('UPDATE users SET must_change_password = TRUE');
      }

      // Journalisation (avant commit)
      await client.query(
        'INSERT INTO notification_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
        [req.user.id, 'backup-restore',
         JSON.stringify({ stats, forcePasswordChange, fromManifest: { generatedAt: manifest.generatedAt, by: manifest.generatedBy } }),
         req.ip]
      );

      await client.query('COMMIT');
      res.json({
        success: true,
        restored: stats,
        forcePasswordChange,
        message: 'Restauration terminée avec succès.'
      });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('[backup-restore] ROLLBACK :', e.message);
      res.status(500).json({ error: 'Restauration échouée : ' + e.message + ' (rollback effectué, données intactes)' });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(400).json({ error: 'Lecture du ZIP échouée : ' + err.message });
  }
});

// ============================================================
// Helper : insère une ligne en générant dynamiquement la requête
// ============================================================
async function insertRow(client, table, row) {
  const keys = Object.keys(row).filter(k => row[k] !== undefined);
  if (!keys.length) return;
  const placeholders = keys.map((_, i) => '$' + (i + 1));
  const values = keys.map(k => {
    const v = row[k];
    // Convertir les arrays JS vers le format PG natif si nécessaire
    return v;
  });
  const sql = `INSERT INTO ${table} (${keys.map(k => '"' + k + '"').join(', ')})
               VALUES (${placeholders.join(', ')})
               ON CONFLICT DO NOTHING`;
  await client.query(sql, values);
}

module.exports = router;
