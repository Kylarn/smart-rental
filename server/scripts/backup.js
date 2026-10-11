import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

const TABLES = ['users', 'properties', 'units', 'leases', 'payments', 'maintenance_requests', 'move_outs', 'property_caretakers', 'announcements', 'notifications', 'audit_logs'];

export function backupDatabase({ dbPath, backupDir } = {}) {
  const source = dbPath || process.env.DB_PATH || path.join(projectRoot, 'data.db');
  const targetRoot = backupDir || process.env.BACKUP_DIR || path.join(projectRoot, 'backups');

  if (!fs.existsSync(source)) {
    throw new Error(`Database not found at ${source}`);
  }

  try {
    const sourceDb = new DatabaseSync(source);
    sourceDb.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    sourceDb.close();
  } catch {
    /* live server may hold the write lock; copying db + wal + shm is still consistent */
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destDir = path.join(targetRoot, stamp);
  fs.mkdirSync(destDir, { recursive: true });

  const copied = [];
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${source}${suffix}`;
    if (!fs.existsSync(from)) continue;
    const to = path.join(destDir, `data.db${suffix}`);
    fs.copyFileSync(from, to);
    copied.push({ file: path.basename(to), bytes: fs.statSync(to).size });
  }

  const copyPath = path.join(destDir, 'data.db');
  const db = new DatabaseSync(copyPath);
  const integrity = db.prepare('PRAGMA integrity_check').get();
  const integrityOk = Object.values(integrity)[0] === 'ok';
  const available = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  const counts = {};
  for (const t of TABLES) {
    if (available.includes(t)) counts[t] = Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c);
  }
  db.close();

  if (!integrityOk) throw new Error(`Backup integrity check failed for ${copyPath}`);

  return { source, destination: destDir, copied, integrity: 'ok', counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = backupDatabase();
    console.log(`Backup created: ${result.destination}`);
    result.copied.forEach((c) => console.log(`  ${c.file} (${c.bytes} bytes)`));
    console.log(`  integrity_check: ${result.integrity}`);
    console.log(`  rows: ${Object.entries(result.counts).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  } catch (err) {
    console.error(`Backup failed: ${err.message}`);
    process.exit(1);
  }
}