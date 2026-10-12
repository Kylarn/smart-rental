import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getDb, get, insert, run, tx } from '../src/db/index.js';
import { notify } from '../src/services/notify.js';
import { REGISTER_TENANTS, RIESTA_PROPERTY } from '../src/db/riesta.js';

getDb();

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const startDate = arg('start', '2026-01-01');
const endDate = arg('end', '2026-12-31');
const domain = arg('domain', 'riesta.local');
const flatRent = arg('rent', null);

const okDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
if (!okDate(startDate) || !okDate(endDate) || endDate <= startDate) {
  console.error('Invalid --start/--end dates (expected YYYY-MM-DD with end after start).');
  process.exit(1);
}

const property = get('SELECT id, name FROM properties WHERE name = ?', [RIESTA_PROPERTY.name]);
if (!property) {
  console.error(`Property "${RIESTA_PROPERTY.name}" was not found. Run "npm run seed" or "npm run import:riesta" first.`);
  process.exit(1);
}

const tenants = REGISTER_TENANTS.filter((t) => t.role !== 'caretaker');
console.log(`Activating ${tenants.length} register tenants at ${property.name} (rooms 2-13)...\n`);

const rows = [];
const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

for (const t of tenants) {
  const email = `room${t.room}@${domain}`;
  const unit = get('SELECT * FROM units WHERE property_id = ? AND unit_number = ?', [property.id, t.room]);
  const register = get('SELECT * FROM rental_register WHERE property_id = ? AND room_label = ?', [property.id, t.room]);

  if (!unit) {
    rows.push({ room: t.room, name: t.name, email, status: 'skipped', detail: 'unit not found' });
    continue;
  }

  const existingUser = get('SELECT id, role, status FROM users WHERE email = ?', [email]);
  if (existingUser && existingUser.role !== 'tenant') {
    rows.push({ room: t.room, name: t.name, email, status: 'skipped', detail: 'email belongs to a non-tenant account' });
    continue;
  }

  let password = null;
  let userCreated = false;
  let leaseId = null;

  const userId = tx(() => {
    let id = existingUser?.id;
    if (id) {
      if (existingUser.status !== 'active') {
        run(`UPDATE users SET status = 'active', updated_at = ${now} WHERE id = ?`, [id]);
      }
    } else {
      password = `rt-${crypto.randomBytes(5).toString('hex')}`;
      const hash = bcrypt.hashSync(password, 10);
      id = insert(
        `INSERT INTO users (role, full_name, email, phone, password_hash, status, bio)
         VALUES ('tenant', ?, ?, NULL, ?, 'active', ?)`,
        [
          t.name,
          email,
          hash,
          'Imported from the Riesta paper register. Contact details pending - update them from your profile.',
        ]
      );
      userCreated = true;
    }

    const activeLease = get("SELECT id FROM leases WHERE unit_id = ? AND status = 'active'", [unit.id]);
    if (activeLease) {
      leaseId = activeLease.id;
    } else {
      const rent = flatRent != null ? Number(flatRent) : Number(unit.rent || 0);
      leaseId = insert(
        `INSERT INTO leases (property_id, unit_id, tenant_id, start_date, end_date, rent, deposit, frequency, status, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'monthly', 'active', ?)`,
        [
          property.id,
          unit.id,
          id,
          startDate,
          endDate,
          rent,
          Number(t.deposit ?? unit.deposit ?? 0),
          'Imported from the Riesta paper register. Monthly rent pending verification; tenant to complete contact details.',
        ]
      );
    }

    if (unit.status !== 'occupied') {
      run(`UPDATE units SET status = 'occupied', updated_at = ${now} WHERE id = ?`, [unit.id]);
    }
    if (register && register.status !== 'active') {
      run(`UPDATE rental_register SET status = 'active', updated_at = ${now} WHERE id = ?`, [register.id]);
    }

    notify(id, {
      type: 'info',
      title: 'Welcome to Smart Rentals',
      body: `Your tenant account for Room ${t.room} at ${property.name} is active. Please sign in and complete your details (phone, county, ID number).`,
      link: '/app/profile',
      dedupeKey: `riesta-activation-${id}`,
    });

    return id;
  });

  rows.push({
    room: t.room,
    name: t.name,
    email,
    password,
    userId,
    leaseId,
    userCreated,
    status: 'active',
  });
}

console.log('room  tenant                    email                       login status');
console.log('----  ------------------------  --------------------------  ------------');
for (const r of rows) {
  const email = (r.email || '').padEnd(26);
  console.log(`${String(r.room).padEnd(4)}  ${r.name.padEnd(24)}  ${email}  ${r.status}`);
}

const created = rows.filter((r) => r.userCreated);
if (created.length) {
  console.log('\nNew logins (share with the tenant, one-time shown password - they should change it):');
  console.log('room  email                       password');
  console.log('----  --------------------------  ----------------');
  for (const r of created) {
    console.log(`${String(r.room).padEnd(4)}  ${(r.email || '').padEnd(26)}  ${r.password}`);
  }
} else {
  console.log('\nNo new accounts created (all register tenants already have logins).');
}

const skipped = rows.filter((r) => r.status === 'skipped');
if (skipped.length) {
  console.log('\nSkipped:');
  skipped.forEach((r) => console.log(`  - Room ${r.room} (${r.name}): ${r.detail}`));
}

console.log(`\nDone. ${rows.length - skipped.length} tenant account(s) active; lease start ${startDate}, end ${endDate}.`);
console.log('Rent is left as recorded (0 until the landlord sets it). Tenants can complete their own contact details.');
process.exit(0);
