import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { getDb, get, run } from '../src/db/index.js';
import { PLACEHOLDER_LANDLORD } from '../src/db/riesta.js';

getDb();

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const email = String(arg('email', PLACEHOLDER_LANDLORD.email)).trim().toLowerCase();
const name = arg('name', null);
const phone = arg('phone', null);
let password = arg('password', null);

const user = get('SELECT id, role, full_name, email, status FROM users WHERE email = ?', [email]);
if (!user) {
  console.error(`No account found for ${email}. Run "npm run import:riesta" first.`);
  process.exit(1);
}
if (user.role !== 'landlord') {
  console.error(`Account ${email} is a ${user.role}, not a landlord. Refusing to activate.`);
  process.exit(1);
}

let generated = false;
if (!password) {
  password = `rt-owner-${crypto.randomBytes(5).toString('hex')}`;
  generated = true;
}
const hash = bcrypt.hashSync(String(password), 10);

const sets = ["password_hash = ?", "status = 'active'", "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"];
const params = [hash];
if (name) {
  sets.push('full_name = ?');
  params.push(String(name).trim());
}
if (phone) {
  sets.push('phone = ?');
  params.push(String(phone).trim());
}
params.push(user.id);
run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);

const properties = get(
  'SELECT COUNT(*) AS c FROM properties WHERE landlord_id = ?',
  [user.id]
).c;
const tenants = get(
  `SELECT COUNT(DISTINCT l.tenant_id) AS c FROM leases l
   JOIN properties p ON p.id = l.property_id
   WHERE p.landlord_id = ? AND l.status = 'active'`,
  [user.id]
).c;

console.log('Placeholder owner activated as a login-capable landlord.\n');
console.log(`  email:     ${email}`);
console.log(`  password:  ${password}${generated ? '  (generated - store it securely)' : ''}`);
console.log(`  status:    active`);
console.log(`  name:      ${name || user.full_name}`);
console.log(`  properties: ${properties}   active leased tenants: ${tenants}`);
console.log('\nSign in and open Properties / Tenants / Leases to manage the Riesta register.');
process.exit(0);
