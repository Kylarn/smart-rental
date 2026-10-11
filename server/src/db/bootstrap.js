import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data.db');

if (process.argv.includes('--fresh') || !fs.existsSync(DB_PATH)) {
  const suffixes = ['', '-wal', '-shm'];
  for (const s of suffixes) {
    const f = `${DB_PATH}${s}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}
