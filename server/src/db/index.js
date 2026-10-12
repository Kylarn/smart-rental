import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL DEFAULT 'tenant' CHECK (role IN ('admin','landlord','tenant','caretaker')),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  avatar_url TEXT,
  county TEXT,
  id_number TEXT,
  bio TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  landlord_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  county TEXT NOT NULL,
  area TEXT,
  address TEXT,
  property_type TEXT NOT NULL DEFAULT 'Apartment',
  description TEXT,
  amenities TEXT NOT NULL DEFAULT '[]',
  images TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  views INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_number TEXT NOT NULL,
  floor TEXT,
  unit_type TEXT NOT NULL,
  bedrooms INTEGER NOT NULL DEFAULT 0,
  rent INTEGER NOT NULL,
  deposit INTEGER NOT NULL DEFAULT 0,
  size_sqm INTEGER,
  status TEXT NOT NULL DEFAULT 'vacant' CHECK (status IN ('vacant','occupied','reserved','maintenance')),
  amenities TEXT NOT NULL DEFAULT '[]',
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(property_id, unit_number)
);

CREATE TABLE IF NOT EXISTS leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  rent INTEGER NOT NULL,
  deposit INTEGER NOT NULL DEFAULT 0,
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly','quarterly','semi-annually','annually')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','terminated')),
  document_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  lease_id INTEGER REFERENCES leases(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL,
  period TEXT,
  months_covered INTEGER NOT NULL DEFAULT 1,
  method TEXT NOT NULL DEFAULT 'mpesa' CHECK (method IN ('mpesa','bank','cash','card')),
  provider TEXT NOT NULL DEFAULT 'mpesa',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  phone TEXT,
  reference TEXT,
  receipt_number TEXT UNIQUE,
  provider_ref TEXT,
  failure_reason TEXT,
  paid_at TEXT,
  recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','under_review','assigned','in_progress','completed','closed')),
  photos TEXT NOT NULL DEFAULT '[]',
  assigned_to TEXT,
  estimated_cost INTEGER,
  actual_cost INTEGER,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  applicant_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  move_in_date TEXT,
  occupants INTEGER NOT NULL DEFAULT 1,
  message TEXT,
  documents TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','under_review','info_requested','approved','rejected','assigned')),
  reviewer_notes TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  thread_key TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  landlord_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL DEFAULT 'all',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  actor_role TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS property_caretakers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  caretaker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(property_id, caretaker_id)
);

CREATE TABLE IF NOT EXISTS move_outs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  move_out_date TEXT NOT NULL,
  reason TEXT,
  inspection_notes TEXT,
  inspection_findings TEXT,
  damages TEXT NOT NULL DEFAULT '[]',
  damages_cost INTEGER NOT NULL DEFAULT 0,
  outstanding_rent INTEGER NOT NULL DEFAULT 0,
  deposit_held INTEGER NOT NULL DEFAULT 0,
  deposit_refund INTEGER NOT NULL DEFAULT 0,
  refund_status TEXT NOT NULL DEFAULT 'pending' CHECK (refund_status IN ('pending','refunded','partial','forfeited','not_applicable')),
  meter_water TEXT,
  meter_electricity TEXT,
  keys_returned INTEGER NOT NULL DEFAULT 0,
  keys_notes TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated','completed')),
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sms_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'general',
  related_entity TEXT,
  related_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','delivered','failed')),
  provider TEXT,
  provider_message_id TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  simulated INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS account_activations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'activation' CHECK (purpose IN ('activation','reset')),
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  description TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  expense_date TEXT NOT NULL,
  vendor TEXT,
  receipt_url TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS utility_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'Water' CHECK (category IN ('Water','Electricity','Garbage','Internet','Other')),
  period TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid')),
  paid_at TEXT,
  payment_method TEXT,
  payment_reference TEXT,
  paid_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(unit_id, period, category)
);

-- Real-world paper register import. Unverified tenancies are held here instead of
-- in leases so the rent engine never computes arrears or sends rent SMS for them.
CREATE TABLE IF NOT EXISTS rental_register (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  room_label TEXT NOT NULL,
  tenant_name TEXT NOT NULL,
  tenancy_role TEXT NOT NULL DEFAULT 'tenant' CHECK (tenancy_role IN ('tenant','new_tenant','caretaker')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','active','moved_out','caretaker_accommodation')),
  is_caretaker INTEGER NOT NULL DEFAULT 0,
  deposit_amount INTEGER,
  deposit_verified INTEGER NOT NULL DEFAULT 0,
  details_verified INTEGER NOT NULL DEFAULT 0,
  contact_verified INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'riesta_register',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(property_id, room_label)
);

-- Deposits are tracked separately and never counted as rental income.
CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  rental_register_id INTEGER REFERENCES rental_register(id) ON DELETE SET NULL,
  tenant_name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  status TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','partially_refunded','refunded','forfeited','unknown')),
  verified INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'riesta_register',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(property_id, unit_id, tenant_name, amount, source)
);

-- Historical rent taken from the paper register. Period is the register month;
-- raw_date keeps the original handwriting so uncertain dates stay traceable.
CREATE TABLE IF NOT EXISTS rent_register_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  rental_register_id INTEGER REFERENCES rental_register(id) ON DELETE SET NULL,
  tenant_name TEXT NOT NULL,
  period TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'KES',
  raw_date TEXT,
  paid_at TEXT,
  date_verified INTEGER NOT NULL DEFAULT 0,
  amount_verified INTEGER NOT NULL DEFAULT 0,
  method TEXT,
  receipt_number TEXT,
  source TEXT NOT NULL DEFAULT 'riesta_register',
  dedupe_key TEXT NOT NULL UNIQUE,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_units_property ON units(property_id);
CREATE INDEX IF NOT EXISTS idx_leases_unit ON leases(unit_id);
CREATE INDEX IF NOT EXISTS idx_leases_tenant ON leases(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_property ON maintenance_requests(property_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id);
CREATE INDEX IF NOT EXISTS idx_applications_property ON applications(property_id);
CREATE INDEX IF NOT EXISTS idx_property_caretakers_property ON property_caretakers(property_id);
CREATE INDEX IF NOT EXISTS idx_property_caretakers_caretaker ON property_caretakers(caretaker_id);
CREATE INDEX IF NOT EXISTS idx_move_outs_lease ON move_outs(lease_id);
CREATE INDEX IF NOT EXISTS idx_move_outs_property ON move_outs(property_id);
CREATE INDEX IF NOT EXISTS idx_expenses_property ON expenses(property_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_utility_bills_property ON utility_bills(property_id);
CREATE INDEX IF NOT EXISTS idx_utility_bills_unit ON utility_bills(unit_id);
CREATE INDEX IF NOT EXISTS idx_utility_bills_tenant ON utility_bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_utility_bills_status ON utility_bills(status);
CREATE INDEX IF NOT EXISTS idx_sms_user ON sms_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_property ON sms_messages(property_id);
CREATE INDEX IF NOT EXISTS idx_sms_status ON sms_messages(status);
CREATE INDEX IF NOT EXISTS idx_sms_dedupe ON sms_messages(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_activation_user ON account_activations(user_id);
CREATE INDEX IF NOT EXISTS idx_activation_token ON account_activations(token_hash);
CREATE INDEX IF NOT EXISTS idx_rental_register_property ON rental_register(property_id);
CREATE INDEX IF NOT EXISTS idx_rental_register_unit ON rental_register(unit_id);
CREATE INDEX IF NOT EXISTS idx_deposits_property ON deposits(property_id);
CREATE INDEX IF NOT EXISTS idx_deposits_unit ON deposits(unit_id);
CREATE INDEX IF NOT EXISTS idx_rent_register_property ON rent_register_entries(property_id);
CREATE INDEX IF NOT EXISTS idx_rent_register_unit ON rent_register_entries(unit_id);
CREATE INDEX IF NOT EXISTS idx_rent_register_period ON rent_register_entries(period);
`;

let db = null;

function tableSql(database, name) {
  const row = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  return row?.sql || '';
}

function columnNames(database, name) {
  return database.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
}

const USERS_REBUILD = `
CREATE TABLE users__new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL DEFAULT 'tenant' CHECK (role IN ('admin','landlord','tenant','caretaker')),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  avatar_url TEXT,
  county TEXT,
  id_number TEXT,
  bio TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
INSERT INTO users__new (id, role, full_name, email, phone, password_hash, status, avatar_url, county, id_number, bio, created_at, updated_at)
SELECT id, role, full_name, email, phone, password_hash, status, avatar_url, county, id_number, bio, created_at, updated_at FROM users;
DROP TABLE users;
ALTER TABLE users__new RENAME TO users;
`;

function ensureMigrations(database) {
  const usersSql = tableSql(database, 'users');
  if (usersSql && !usersSql.includes("'caretaker'")) {
    database.exec('PRAGMA foreign_keys = OFF');
    database.exec('BEGIN');
    try {
      database.exec(USERS_REBUILD);
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw err;
    } finally {
      database.exec('PRAGMA foreign_keys = ON');
    }
  }

  const auditCols = columnNames(database, 'audit_logs');
  if (!auditCols.includes('property_id')) database.exec('ALTER TABLE audit_logs ADD COLUMN property_id INTEGER');
  if (!auditCols.includes('actor_role')) database.exec('ALTER TABLE audit_logs ADD COLUMN actor_role TEXT');
  database.exec('CREATE INDEX IF NOT EXISTS idx_audit_property ON audit_logs(property_id)');

  const userCols = columnNames(database, 'users');
  if (!userCols.includes('sms_opt_out')) {
    database.exec('ALTER TABLE users ADD COLUMN sms_opt_out INTEGER NOT NULL DEFAULT 0');
  }

  const unitCols = columnNames(database, 'units');
  if (!unitCols.includes('occupancy_known')) {
    database.exec('ALTER TABLE units ADD COLUMN occupancy_known INTEGER NOT NULL DEFAULT 1');
  }
  if (!unitCols.includes('details_verified')) {
    database.exec('ALTER TABLE units ADD COLUMN details_verified INTEGER NOT NULL DEFAULT 1');
  }
  try {
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_leases_active_unit ON leases(unit_id) WHERE status = 'active'");
  } catch {
    // Legacy databases may already contain duplicate active leases on the same unit.
    // The application-level check (activeLeaseOfUnit) remains the primary guard.
  }

  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_payments_lease_period_status ON payments(lease_id, period, status)');
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_payments_property_created_status ON payments(property_id, created_at DESC) WHERE status = 'completed'");
  } catch {}
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_leases_property_status ON leases(property_id, status)');
  } catch {}
  try {
    database.exec("CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created ON notifications(user_id, is_read, created_at DESC)");
  } catch {}
  try {
    database.exec('CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC)');
  } catch {}
}

export function openDb(dbPath) {
  const database = new DatabaseSync(dbPath);
  database.exec('PRAGMA journal_mode = WAL;');
  database.exec(SCHEMA);
  ensureMigrations(database);
  return database;
}

export function ensureMigrationsApplied(dbPath) {
  const database = openDb(dbPath);
  database.close();
}

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = openDb(config.dbPath);
  return db;
}

export function all(sql, params = []) {
  return getDb().prepare(sql).all(...params).map((r) => ({ ...r }));
}

export function get(sql, params = []) {
  const row = getDb().prepare(sql).get(...params);
  return row ? { ...row } : null;
}

export function run(sql, params = []) {
  return getDb().prepare(sql).run(...params);
}

export function insert(sql, params = []) {
  const res = getDb().prepare(sql).run(...params);
  return Number(res.lastInsertRowid);
}

export function tx(fn) {
  const database = getDb();
  database.exec('BEGIN');
  try {
    const result = fn();
    database.exec('COMMIT');
    return result;
  } catch (err) {
    database.exec('ROLLBACK');
    throw err;
  }
}
