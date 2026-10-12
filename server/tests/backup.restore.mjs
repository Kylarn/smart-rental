import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase } from '../scripts/backup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-rentals-backup-'));
const sourceDb = path.join(tmp, 'source', 'data.db');
const backupDir = path.join(tmp, 'backups');
const restoreDb = path.join(tmp, 'restored', 'data.db');
const uploadsDir = path.join(tmp, 'uploads');
const port = 4599 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;

const TABLES = ['users', 'properties', 'units', 'leases', 'payments', 'maintenance_requests', 'move_outs', 'property_caretakers', 'announcements', 'notifications', 'audit_logs'];

const baseEnv = {
  ...process.env,
  NODE_ENV: 'staging',
  JWT_SECRET: `backup-test-${'y'.repeat(40)}`,
  COOKIE_SECURE: '0',
  CLIENT_ORIGIN: base,
  UPLOADS_DIR: uploadsDir,
};

let passed = 0;
let failed = 0;
function step(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  \u2717 ${name}\n      ${err.message}`);
  }
}

async function waitHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

console.log('Smart Rentals backup/restore verification\n');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(path.dirname(sourceDb), { recursive: true });

const seeded = spawnSync(process.execPath, [path.join(root, 'server', 'src', 'db', 'seed.js')], {
  env: { ...baseEnv, DB_PATH: sourceDb },
  cwd: root,
  stdio: 'ignore',
});
if (seeded.status !== 0) {
  console.error('seed failed; aborting');
  process.exit(1);
}

const preCounts = {};
const preDb = new DatabaseSync(sourceDb);
for (const t of TABLES) preCounts[t] = Number(preDb.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c);
preDb.close();

const result = backupDatabase({ dbPath: sourceDb, backupDir });

step('backup is created and passes integrity_check', () => {
  assert.equal(result.integrity, 'ok');
  assert.ok(fs.existsSync(path.join(result.destination, 'data.db')));
});

step('backup row counts match the source', () => {
  for (const t of TABLES) assert.equal(result.counts[t], preCounts[t], `${t} rows`);
});

// --- Simulated restore into a fresh location (never over the original) ---
step('restore produces a consistent database with identical counts', () => {
  fs.mkdirSync(path.dirname(restoreDb), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const from = path.join(result.destination, `data.db${suffix}`);
    if (fs.existsSync(from)) fs.copyFileSync(from, `${restoreDb}${suffix}`);
  }
  const db = new DatabaseSync(restoreDb);
  assert.equal(Object.values(db.prepare('PRAGMA integrity_check').get())[0], 'ok');
  for (const t of TABLES) {
    assert.equal(Number(db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c), preCounts[t], `${t} rows after restore`);
  }
  db.close();
});

// --- Boot the app against the restored database and log in ---
let server = spawn(process.execPath, [path.join(root, 'server', 'src', 'index.js')], {
  env: { ...baseEnv, DB_PATH: restoreDb, PORT: String(port) },
  cwd: root,
  stdio: ['ignore', 'ignore', 'pipe'],
});
server.stderr.on('data', (d) => process.stderr.write(`      [restored:err] ${d}`));

try {
  const healthy = await waitHealth();
  step('restored database boots and answers /api/health', () => {
    assert.equal(healthy, true, 'server did not become healthy');
  });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@smartrentals.co.ke', password: 'Admin@123' }),
  });
  step('a seeded account can authenticate against the restored database', () => {
    assert.equal(login.status, 200, `login returned ${login.status}`);
  });
} finally {
  await new Promise((resolve) => {
    server.once('exit', resolve);
    server.kill();
    setTimeout(resolve, 4000);
  });
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows may hold SQLite handles briefly */
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
