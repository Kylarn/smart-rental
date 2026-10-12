import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { all, get, insert } from './index.js';
import { config } from '../config.js';

export const RIESTA_PROPERTY = {
  name: 'Riesta Apartments',
  county: 'Unconfirmed',
  area: null,
  address: null,
  property_type: 'Apartment',
  description:
    'Imported from the Riesta Apartments paper register. Owner, location, rent and contact details are pending verification. Rooms 14-85 have unknown occupancy.',
  status: 'archived',
};

// Default development/staging admin login. NEVER used for a fresh production seed:
// resolveSeedAdminPassword() refuses a predictable password in production.
export const ADMIN_ACCOUNT = { email: 'admin@smartrentals.co.ke', password: 'Admin@123' };
export const PLACEHOLDER_LANDLORD = {
  email: 'owner.pending@riesta.local',
  full_name: 'Riesta Apartments (owner pending)',
};

// Production must never get a guessable admin password. Prefer an explicit argument,
// then SEED_ADMIN_PASSWORD, else generate a random one in production. Dev/staging keep
// the documented demo password so local logins and the smoke/backup tests keep working.
export function resolveSeedAdminPassword(explicit) {
  if (explicit) return explicit;
  if (process.env.SEED_ADMIN_PASSWORD) return process.env.SEED_ADMIN_PASSWORD;
  if (config.env === 'production') return randomUUID();
  return ADMIN_ACCOUNT.password;
}

export const TOTAL_ROOMS = 85;

// rooms 1-13 are known from the paper register. Rooms 14-85 exist but occupancy is unknown.
export const REGISTER_TENANTS = [
  { room: '1', name: 'Sebastian Mshai', role: 'caretaker', deposit: null, note: 'Caretaker accommodation - not a rent-paying tenancy' },
  { room: '2', name: 'Lucy Wanjiru', role: 'new_tenant', deposit: 4500, note: 'New tenant' },
  { room: '3', name: 'Peter Kamau Muhanda', role: 'tenant', deposit: 4000 },
  { room: '4', name: 'Phoebe Makangio', role: 'tenant', deposit: 4500 },
  { room: '5', name: 'Sharon Baryngo', role: 'tenant', deposit: 4500 },
  { room: '6', name: 'Valentine Samuel', role: 'new_tenant', deposit: 4500, note: 'New tenant' },
  { room: '7', name: 'Meali Ali Juma', role: 'tenant', deposit: 4000 },
  { room: '8', name: 'Hamisi Ali (Fatma)', role: 'tenant', deposit: 4500 },
  { room: '9', name: 'Agness Kalunde Nthenya', role: 'tenant', deposit: 4500 },
  { room: '10', name: 'Rehema Adam Wangijo', role: 'tenant', deposit: 4000 },
  { room: '11', name: 'Seneth Nyanduko', role: 'tenant', deposit: 4500 },
  { room: '12', name: 'Sylvia Mkanjika', role: 'tenant', deposit: 4500, note: 'Previous name crossed out in register' },
  { room: '13', name: 'Patience Dzane', role: 'tenant', deposit: 4000 },
];

// Historical rent register (period = register month, YYYY-MM). raw_date is kept
// exactly as written; every entry is imported unverified (date_verified=0).
export const RENT_REGISTER = [
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-01', amount: 1300 },
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-01', amount: 2700 },
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-02', amount: 4000 },
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-03', amount: 2500 },
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-03', amount: 1000 },
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-04', amount: 4000 },
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-05', amount: 2000 },
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-06', amount: 2000 },
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-07', amount: 2000 },
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-08', amount: 2500 },
  { room: '3', name: 'Peter Kamau Muhanda', period: '2026-09', amount: 4500 },

  { room: '7', name: 'Meali Ali Juma', period: '2026-01', amount: 4000, rawDate: '5/1/26' },
  { room: '7', name: 'Meali Ali Juma', period: '2026-02', amount: 4000, rawDate: '8/2' },
  { room: '7', name: 'Meali Ali Juma', period: '2026-03', amount: 4000, rawDate: '4/3' },
  { room: '7', name: 'Meali Ali Juma', period: '2026-04', amount: 4000, rawDate: '7/4/26' },
  { room: '7', name: 'Meali Ali Juma', period: '2026-05', amount: 2000, rawDate: '10/5/26' },
  { room: '7', name: 'Meali Ali Juma', period: '2026-06', amount: 2000, rawDate: '10/6/26' },
  { room: '7', name: 'Meali Ali Juma', period: '2026-07', amount: 2000, rawDate: '8/8/26', note: 'Date looks mismatched with register month - verify' },
  { room: '7', name: 'Meali Ali Juma', period: '2026-08', amount: 2000, rawDate: '10/7/26', note: 'Date looks mismatched with register month - verify' },
  { room: '7', name: 'Meali Ali Juma', period: '2026-09', amount: 4500, rawDate: '5/9/26' },

  { room: '10', name: 'Rehema Adam Wangijo', period: '2026-01', amount: 4000, rawDate: '26/1' },
  { room: '10', name: 'Rehema Adam Wangijo', period: '2026-02', amount: 4000, rawDate: '13/2' },
  { room: '10', name: 'Rehema Adam Wangijo', period: '2026-03', amount: 4000, rawDate: '10/3' },
  { room: '10', name: 'Rehema Adam Wangijo', period: '2026-04', amount: 4000, rawDate: '6/4/26' },
  { room: '10', name: 'Rehema Adam Wangijo', period: '2026-05', amount: 500, note: 'Split payment - verify' },
  { room: '10', name: 'Rehema Adam Wangijo', period: '2026-05', amount: 1500, note: 'Split payment - verify' },
  { room: '10', name: 'Rehema Adam Wangijo', period: '2026-06', amount: 2000, rawDate: '13/6/26' },
  { room: '10', name: 'Rehema Adam Wangijo', period: '2026-07', amount: 2000, rawDate: '10/7/26' },
  { room: '10', name: 'Rehema Adam Wangijo', period: '2026-08', amount: 2000, rawDate: '27/8/26' },
  { room: '10', name: 'Rehema Adam Wangijo', period: '2026-09', amount: 4500, rawDate: '4/9/26' },

  { room: '13', name: 'Patience Dzane', period: '2026-01', amount: 4000, note: 'Date unclear in register' },
  { room: '13', name: 'Patience Dzane', period: '2026-02', amount: 4000, note: 'Date unclear in register' },
  { room: '13', name: 'Patience Dzane', period: '2026-03', amount: 4000, note: 'Date unclear in register' },
  { room: '13', name: 'Patience Dzane', period: '2026-04', amount: 4000, note: 'Date unclear in register' },
  { room: '13', name: 'Patience Dzane', period: '2026-09', amount: 4500, rawDate: '26/8/26', note: 'Date looks mismatched with register month - verify' },
];

// Ambiguities that must be resolved by the landlord before data is treated as verified.
export const UNCERTAINTIES = [
  "Property county/location unknown - set to 'Unconfirmed'.",
  'Owner/landlord details unknown - a suspended placeholder account holds the property.',
  'Monthly rent for every room is unknown - units imported with rent = 0 (details_verified = 0).',
  'No tenant phone numbers or emails are known - run "npm run activate:tenants" to create active logins (room-based placeholder emails and one-time passwords) so tenants can sign in and supply their own details.',
  'Room 1 (Sebastian Mshai) is caretaker accommodation, not a rent-paying tenancy.',
  'Rent register dates are unverified; raw_date keeps the original handwriting.',
  'Rooms 14-85 occupancy is unknown; not assumed vacant or occupied.',
  'Rooms 5, 6, 8, 9, 11, 12 have no rent entries in the register (blank is not proof of non-payment).',
];

function upsertUser({ role, full_name, email, phone = null, password_hash, status = 'active', bio = null }) {
  const existing = get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return { id: existing.id, created: false };
  const id = insert(
    `INSERT INTO users (role, full_name, email, phone, password_hash, status, bio) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [role, full_name, email, phone, password_hash, status, bio]
  );
  return { id, created: true };
}

export async function applyRiestaImport({ adminPassword } = {}) {
  const report = { created: {}, existing: {}, skipped: [], uncertainties: [...UNCERTAINTIES] };

  const explicit = adminPassword || process.env.SEED_ADMIN_PASSWORD;
  const resolvedAdminPassword = resolveSeedAdminPassword(adminPassword);
  const adminHash = await bcrypt.hash(resolvedAdminPassword, 10);
  const admin = upsertUser({
    role: 'admin',
    full_name: 'Smart Rentals Admin',
    email: ADMIN_ACCOUNT.email,
    phone: null,
    password_hash: adminHash,
    bio: 'Platform administrator',
  });
  report[admin.created ? 'created' : 'existing'].admin = admin.id;
  report.admin = {
    id: admin.id,
    created: admin.created,
    generated: admin.created && !explicit,
    password: admin.created ? resolvedAdminPassword : null,
  };

  // Placeholder owner: random unusable password + suspended so it can never log in.
  const placeholderHash = await bcrypt.hash(randomUUID(), 10);
  const owner = upsertUser({
    role: 'landlord',
    full_name: PLACEHOLDER_LANDLORD.full_name,
    email: PLACEHOLDER_LANDLORD.email,
    password_hash: placeholderHash,
    status: 'suspended',
    bio: 'Placeholder owner account for Riesta Apartments. Replace with real owner before going live.',
  });
  report[owner.created ? 'created' : 'existing'].landlord = owner.id;

  let property = get('SELECT id FROM properties WHERE name = ? AND landlord_id = ?', [RIESTA_PROPERTY.name, owner.id]);
  if (!property) {
    const id = insert(
      `INSERT INTO properties (landlord_id, name, county, area, address, property_type, description, amenities, images, status, views)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, 0)`,
      [owner.id, RIESTA_PROPERTY.name, RIESTA_PROPERTY.county, RIESTA_PROPERTY.area, RIESTA_PROPERTY.address, RIESTA_PROPERTY.property_type, RIESTA_PROPERTY.description, RIESTA_PROPERTY.status]
    );
    property = { id };
    report.created.property = id;
  } else {
    report.existing.property = property.id;
  }
  const propertyId = property.id;

  const registerByRoom = new Map(REGISTER_TENANTS.map((t) => [t.room, t]));
  let unitsCreated = 0;
  let unitsExisting = 0;
  for (let n = 1; n <= TOTAL_ROOMS; n += 1) {
    const room = String(n);
    const known = registerByRoom.has(room);
    const entry = registerByRoom.get(room);
    const status = known ? 'occupied' : 'vacant';
    const deposit = entry && entry.deposit != null ? entry.deposit : 0;
    const before = get('SELECT id FROM units WHERE property_id = ? AND unit_number = ?', [propertyId, room]);
    if (before) {
      unitsExisting += 1;
      continue;
    }
    insert(
      `INSERT INTO units (property_id, unit_number, floor, unit_type, bedrooms, rent, deposit, status, amenities, occupancy_known, details_verified)
       VALUES (?, ?, '', 'Room', 0, 0, ?, ?, '[]', ?, 0)`,
      [propertyId, room, deposit, status, known ? 1 : 0]
    );
    unitsCreated += 1;
  }
  report.units = { created: unitsCreated, existing: unitsExisting, total: TOTAL_ROOMS };

  const unitIdByRoom = new Map();
  for (const u of all('SELECT id, unit_number FROM units WHERE property_id = ?', [propertyId])) {
    unitIdByRoom.set(u.unit_number, u.id);
  }

  let registerCreated = 0;
  const registerIdByRoom = new Map();
  for (const t of REGISTER_TENANTS) {
    const unitId = unitIdByRoom.get(t.room) || null;
    const existing = get('SELECT id FROM rental_register WHERE property_id = ? AND room_label = ?', [propertyId, t.room]);
    if (existing) {
      registerIdByRoom.set(t.room, existing.id);
      continue;
    }
    const id = insert(
      `INSERT INTO rental_register (property_id, unit_id, room_label, tenant_name, tenancy_role, status, is_caretaker, deposit_amount, source, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'riesta_register', ?)`,
      [
        propertyId,
        unitId,
        t.room,
        t.name,
        t.role,
        t.role === 'caretaker' ? 'caretaker_accommodation' : 'pending',
        t.role === 'caretaker' ? 1 : 0,
        t.deposit,
        t.note || null,
      ]
    );
    registerIdByRoom.set(t.room, id);
    registerCreated += 1;
  }
  report.rental_register = { created: registerCreated, total: REGISTER_TENANTS.length };

  let depositsCreated = 0;
  for (const t of REGISTER_TENANTS) {
    if (t.deposit == null) {
      report.skipped.push(`Room ${t.room} (${t.name}): deposit unknown - not recorded`);
      continue;
    }
    const unitId = unitIdByRoom.get(t.room) || null;
    const before = get(
      'SELECT id FROM deposits WHERE property_id = ? AND unit_id IS ? AND tenant_name = ? AND amount = ? AND source = ?',
      [propertyId, unitId, t.name, t.deposit, 'riesta_register']
    );
    if (before) continue;
    insert(
      `INSERT INTO deposits (property_id, unit_id, rental_register_id, tenant_name, amount, currency, status, source, notes)
       VALUES (?, ?, ?, ?, ?, 'KES', 'held', 'riesta_register', ?)`,
      [propertyId, unitId, registerIdByRoom.get(t.room) || null, t.name, t.deposit, t.note || null]
    );
    depositsCreated += 1;
  }
  report.deposits = { created: depositsCreated };

  const occ = new Map();
  let rentCreated = 0;
  for (const e of RENT_REGISTER) {
    const keyPart = `${e.room}:${e.period}:${e.amount}`;
    const n = (occ.get(keyPart) || 0) + 1;
    occ.set(keyPart, n);
    const dedupeKey = `riesta:${keyPart}:${n}`;
    const before = get('SELECT id FROM rent_register_entries WHERE dedupe_key = ?', [dedupeKey]);
    if (before) continue;
    insert(
      `INSERT INTO rent_register_entries (property_id, unit_id, rental_register_id, tenant_name, period, amount, currency, raw_date, date_verified, amount_verified, source, dedupe_key, notes)
       VALUES (?, ?, ?, ?, ?, ?, 'KES', ?, 0, 0, 'riesta_register', ?, ?)`,
      [
        propertyId,
        unitIdByRoom.get(e.room) || null,
        registerIdByRoom.get(e.room) || null,
        e.name,
        e.period,
        e.amount,
        e.rawDate || null,
        dedupeKey,
        e.note || null,
      ]
    );
    rentCreated += 1;
  }
  report.rent_register_entries = { created: rentCreated, total: RENT_REGISTER.length };

  for (const k of ['platform_name', 'currency', 'registration_enabled', 'rent_reminder_days', 'lease_expiry_days']) {
    if (!get('SELECT key FROM settings WHERE key = ?', [k])) {
      const defaults = {
        platform_name: 'Smart Rentals',
        currency: 'KES',
        registration_enabled: 'true',
        rent_reminder_days: '3',
        lease_expiry_days: '30',
      };
      insert('INSERT INTO settings (key, value) VALUES (?, ?)', [k, defaults[k]]);
    }
  }

  report.property_id = propertyId;
  return report;
}
