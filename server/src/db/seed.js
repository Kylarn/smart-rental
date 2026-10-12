import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data.db');

for (const suffix of ['', '-wal', '-shm']) {
  const f = `${DB_PATH}${suffix}`;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}

const { getDb } = await import('./index.js');
getDb();

const { applyRiestaImport, ADMIN_ACCOUNT } = await import('./riesta.js');

console.log('Seeding Smart Rentals database with Riesta Apartments register data...');
const report = await applyRiestaImport();

console.log('\nSeed complete.');
console.log(`  property_id: ${report.property_id}`);
console.log(`  units: ${report.units.created} created, ${report.units.existing} existing (total ${report.units.total})`);
console.log(`  rental_register rows: ${report.rental_register.created} created (total ${report.rental_register.total})`);
console.log(`  deposits: ${report.deposits.created} created`);
console.log(`  rent_register_entries: ${report.rent_register_entries.created} created (total ${report.rent_register_entries.total})`);
if (report.skipped.length) {
  console.log('  skipped:');
  report.skipped.forEach((s) => console.log(`    - ${s}`));
}

console.log('\nAccounts:');
console.log(`  Admin email: ${ADMIN_ACCOUNT.email}`);
if (report.admin.created && report.admin.generated) {
  console.log(`  Admin password (generated - store it securely now): ${report.admin.password}`);
} else if (report.admin.created) {
  console.log(`  Admin password: ${report.admin.password}`);
} else {
  console.log('  Admin already existed - password unchanged.');
}
console.log('  Landlord: placeholder owner is suspended (no login) until real owner details are provided.');

console.log('\nUncertainties to resolve with the landlord:');
report.uncertainties.forEach((u) => console.log(`  - ${u}`));
process.exit(0);
