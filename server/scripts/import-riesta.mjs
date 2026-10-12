import { getDb } from '../src/db/index.js';
import { applyRiestaImport, ADMIN_ACCOUNT } from '../src/db/riesta.js';

getDb();

console.log('Importing Riesta Apartments register data (idempotent, non-destructive)...\n');
const report = await applyRiestaImport();

console.log('Import complete.');
console.log(`  property_id: ${report.property_id}`);
console.log(`  units: ${report.units.created} created, ${report.units.existing} already present (total ${report.units.total})`);
console.log(`  rental_register rows: ${report.rental_register.created} created (total ${report.rental_register.total})`);
console.log(`  deposits: ${report.deposits.created} created`);
console.log(`  rent_register_entries: ${report.rent_register_entries.created} created (total ${report.rent_register_entries.total})`);
if (report.skipped.length) {
  console.log('  skipped:');
  report.skipped.forEach((s) => console.log(`    - ${s}`));
}
console.log(`\n  admin account: ${ADMIN_ACCOUNT.email}`);
if (report.admin.created && report.admin.generated) {
  console.log(`  admin password (generated - store it securely now): ${report.admin.password}`);
} else if (!report.admin.created) {
  console.log('  admin already existed - password unchanged');
}
console.log('\nUncertainties still requiring landlord confirmation:');
report.uncertainties.forEach((u) => console.log(`  - ${u}`));
