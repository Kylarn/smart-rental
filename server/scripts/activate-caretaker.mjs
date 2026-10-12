import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getDb, get, insert, run } from '../src/db/index.js';
import { notify } from '../src/services/notify.js';
import { REGISTER_TENANTS, RIESTA_PROPERTY } from '../src/db/riesta.js';

getDb();

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const caretakerEntry = REGISTER_TENANTS.find((t) => t.role === 'caretaker');
const email = String(arg('email', 'caretaker@riesta.local')).trim().toLowerCase();
const name = String(arg('name', caretakerEntry?.name || 'Riesta Caretaker')).trim();
const phone = arg('phone', null);
let password = arg('password', null);

const property = get('SELECT id, name, landlord_id FROM properties WHERE name = ?', [RIESTA_PROPERTY.name]);
if (!property) {
  console.error(`Property "${RIESTA_PROPERTY.name}" was not found. Run "npm run import:riesta" first.`);
  process.exit(1);
}

const existing = get('SELECT id, role, full_name, status FROM users WHERE email = ?', [email]);
if (existing && existing.role !== 'caretaker') {
  console.error(`Account ${email} exists as a ${existing.role}, not a caretaker. Refusing to reuse it.`);
  process.exit(1);
}

let generated = false;
let caretakerId;
if (!existing) {
  if (!password) {
    password = `rt-ct-${crypto.randomBytes(5).toString('hex')}`;
    generated = true;
  }
  const hash = bcrypt.hashSync(String(password), 10);
  caretakerId = insert(
    `INSERT INTO users (role, full_name, email, phone, password_hash, status, bio)
     VALUES ('caretaker', ?, ?, ?, ?, 'active', ?)`,
    [name, email, phone, hash, `Caretaker for ${property.name}.`]
  );
} else {
  caretakerId = existing.id;
  const sets = ["status = 'active'", "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"];
  const params = [];
  if (password) {
    sets.unshift('password_hash = ?');
    params.push(bcrypt.hashSync(String(password), 10));
  }
  if (phone) {
    sets.push('phone = ?');
    params.push(phone);
  }
  params.push(caretakerId);
  run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
}

const assigned = get('SELECT id FROM property_caretakers WHERE property_id = ? AND caretaker_id = ?', [
  property.id,
  caretakerId,
]);
if (!assigned) {
  insert(
    'INSERT INTO property_caretakers (property_id, caretaker_id, assigned_by) VALUES (?, ?, ?)',
    [property.id, caretakerId, property.landlord_id]
  );
}

notify(caretakerId, {
  type: 'info',
  title: 'You have been assigned to a property',
  body: `You are now the caretaker for ${property.name}. Open the portal to manage its units, tenants and rent.`,
  link: '/app',
  dedupeKey: `caretaker-assigned-${property.id}-${caretakerId}`,
});

const tenants = get(
  `SELECT COUNT(DISTINCT l.tenant_id) AS c FROM leases l WHERE l.property_id = ? AND l.status = 'active'`,
  [property.id]
).c;

console.log('Caretaker account ready and assigned.\n');
console.log(`  name:       ${name}`);
console.log(`  email:      ${email}`);
console.log(`  password:   ${existing ? (password ? password : '(unchanged)') : password}${generated ? '  (generated - store it securely)' : ''}`);
console.log(`  status:     active`);
console.log(`  property:   ${property.name} (id ${property.id})`);
console.log(`  active leased tenants visible: ${tenants}`);
process.exit(0);
