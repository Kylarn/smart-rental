import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-rentals-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.db');
process.env.JWT_SECRET = 'test-secret-not-for-production';
process.env.NODE_ENV = 'test';
process.env.UPLOADS_DIR = path.join(tmpDir, 'uploads');

const { createApp } = await import('../src/app.js');
const { openDb, get: dbGet } = await import('../src/db/index.js');
const { validateEnvConfig } = await import('../src/utils/configGuard.js');
const app = createApp();
const server = app.listen(0);
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  \u2717 ${name}\n      ${err.message}`);
  }
}

function session() {
  let cookie = '';
  return {
    cookie: () => cookie,
    capture: (res) => {
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
    },
    headers: (extra = {}) => ({ 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}), ...extra }),
    async request(method, url, body) {
      const res = await fetch(`${base}${url}`, {
        method,
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      this.capture(res);
      return res;
    },
  };
}

async function register(s, overrides = {}) {
  return s.request('POST', '/api/auth/register', {
    full_name: 'Test User',
    email: `user${Math.random().toString(36).slice(2, 8)}@test.ke`,
    phone: '0712345678',
    password: 'Secret123',
    ...overrides,
  });
}

console.log('Smart Rentals API tests\n');

await test('GET /api/health returns ok', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

await test('protected route rejects unauthenticated request (401)', async () => {
  const res = await fetch(`${base}/api/payments`);
  assert.equal(res.status, 401);
});

await test('register + session cookie works', async () => {
  const s = session();
  const res = await register(s, { role: 'landlord', full_name: 'Landlord One', email: 'landlord1@test.ke' });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.user.role, 'landlord');
  const me = await s.request('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, 'landlord1@test.ke');
});

await test('mpesa callback is public (not 401) and acknowledges unknown callbacks', async () => {
  const res = await fetch(`${base}/api/payments/mpesa/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.notEqual(res.status, 401);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ResultCode, 0);
  assert.equal(body.ResultDesc, 'Ignored');
});

await test('landlord can create a property', async () => {
  const s = session();
  await register(s, { role: 'landlord', full_name: 'Landlord Two', email: 'landlord2@test.ke' });
  const res = await s.request('POST', '/api/properties', {
    name: 'Test Heights',
    county: 'Nairobi',
    property_type: 'Apartment',
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.property.id);
  assert.equal(body.property.name, 'Test Heights');
});

await test('landlord can add a unit, tenant and record a payment', async () => {
  const s = session();
  await register(s, { role: 'landlord', full_name: 'Landlord Three', email: 'landlord3@test.ke' });
  const property = await (await s.request('POST', '/api/properties', {
    name: 'Flow Apartments',
    county: 'Mombasa',
    property_type: 'Apartment',
  })).json();
  const unitRes = await s.request('POST', '/api/units', {
    property_id: property.property.id,
    unit_number: 'A1',
    unit_type: '1 Bedroom',
    rent: 20000,
  });
  assert.equal(unitRes.status, 201);
  const tenantRes = await s.request('POST', '/api/tenants', {
    full_name: 'New Tenant',
    email: 'tenant.flow@test.ke',
    phone: '0722000111',
    unit_id: (await unitRes.json()).unit.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
  });
  assert.equal(tenantRes.status, 201);
  const tenantId = (await tenantRes.json()).tenant_id;
  const payRes = await s.request('POST', '/api/payments/record', {
    tenant_id: tenantId,
    amount: 20000,
    method: 'cash',
  });
  assert.equal(payRes.status, 201);
  assert.ok((await payRes.json()).receipt);
});

await test('tenant cannot read another tenant (IDOR fixed)', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'IDOR Landlord', email: 'idor.landlord@test.ke' });
  const property = await (await landlord.request('POST', '/api/properties', {
    name: 'IDOR Court',
    county: 'Nairobi',
    property_type: 'Apartment',
  })).json();
  const unit = await (await landlord.request('POST', '/api/units', {
    property_id: property.property.id,
    unit_number: 'B1',
    unit_type: '1 Bedroom',
    rent: 15000,
  })).json();
  const tenant = await (await landlord.request('POST', '/api/tenants', {
    full_name: 'Victim Tenant',
    email: 'victim@test.ke',
    phone: '0733000111',
    unit_id: unit.unit.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
    password: 'Victim123',
  })).json();

  const attacker = session();
  await register(attacker, { role: 'tenant', full_name: 'Attacker', email: 'attacker@test.ke' });
  const res = await attacker.request('GET', `/api/tenants/${tenant.tenant_id}`);
  assert.equal(res.status, 404);
});

await test('landlord cannot edit a tenant they do not own', async () => {
  const owner = session();
  await register(owner, { role: 'landlord', full_name: 'Owner', email: 'owner@test.ke' });
  const property = await (await owner.request('POST', '/api/properties', {
    name: 'Owner Place',
    county: 'Nairobi',
    property_type: 'Apartment',
  })).json();
  const unit = await (await owner.request('POST', '/api/units', {
    property_id: property.property.id,
    unit_number: 'C1',
    unit_type: 'Studio',
    rent: 12000,
  })).json();
  const tenant = await (await owner.request('POST', '/api/tenants', {
    full_name: 'Owned Tenant',
    email: 'owned@test.ke',
    phone: '0744000111',
    unit_id: unit.unit.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
  })).json();

  const rival = session();
  await register(rival, { role: 'landlord', full_name: 'Rival', email: 'rival@test.ke' });
  const res = await rival.request('PUT', `/api/tenants/${tenant.tenant_id}`, { full_name: 'Hacked Name' });
  assert.equal(res.status, 404);
});

await test('duplicate email registration is rejected (409)', async () => {
  const s = session();
  await register(s, { email: 'dup@test.ke', role: 'tenant' });
  const s2 = session();
  const res = await register(s2, { email: 'dup@test.ke', role: 'tenant' });
  assert.equal(res.status, 409);
});

await test('caretaker is created via assignment and can only access assigned property', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Ctx Landlord', email: 'ctx.landlord@test.ke' });
  const propA = await (await landlord.request('POST', '/api/properties', { name: 'Prop A', county: 'Nairobi', property_type: 'Apartment' })).json();
  const propB = await (await landlord.request('POST', '/api/properties', { name: 'Prop B', county: 'Nairobi', property_type: 'Apartment' })).json();
  const assign = await landlord.request('POST', `/api/properties/${propA.property.id}/caretakers`, {
    full_name: 'Site Caretaker',
    email: 'site.caretaker@test.ke',
    phone: '0711222333',
    password: 'Caretaker@123',
  });
  assert.equal(assign.status, 201);
  assert.equal((await assign.json()).caretaker.role, 'caretaker');

  const c = session();
  const login = await c.request('POST', '/api/auth/login', { email: 'site.caretaker@test.ke', password: 'Caretaker@123' });
  assert.equal(login.status, 200);
  const aRes = await c.request('GET', `/api/properties/${propA.property.id}`);
  assert.equal(aRes.status, 200);
  const bRes = await c.request('GET', `/api/properties/${propB.property.id}`);
  assert.equal(bRes.status, 403);
  const list = await c.request('GET', '/api/properties');
  const listed = (await list.json()).properties.map((p) => p.id);
  assert.ok(listed.includes(propA.property.id));
  assert.ok(!listed.includes(propB.property.id));
});

await test('tenant cannot assign caretakers (403)', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Tenant Assign L', email: 'ta.landlord@test.ke' });
  const prop = await (await landlord.request('POST', '/api/properties', { name: 'Assign Court', county: 'Nairobi', property_type: 'Apartment' })).json();
  const t = session();
  await register(t, { role: 'tenant', full_name: 'Assign Tenant', email: 'ta.tenant@test.ke' });
  const res = await t.request('POST', `/api/properties/${prop.property.id}/caretakers`, {
    full_name: 'X',
    email: 'x@test.ke',
    phone: '0711111222',
  });
  assert.equal(res.status, 403);
});

await test('caretaker can manage tenants, maintenance and payments within scope', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Ops Landlord', email: 'ops.landlord@test.ke' });
  const prop = await (await landlord.request('POST', '/api/properties', { name: 'Ops Court', county: 'Nairobi', property_type: 'Apartment' })).json();
  await landlord.request('POST', `/api/properties/${prop.property.id}/caretakers`, {
    full_name: 'Ops Caretaker',
    email: 'ops.caretaker@test.ke',
    phone: '0711222333',
    password: 'Caretaker@123',
  });
  const c = session();
  await c.request('POST', '/api/auth/login', { email: 'ops.caretaker@test.ke', password: 'Caretaker@123' });

  const unit = await (await landlord.request('POST', '/api/units', { property_id: prop.property.id, unit_number: 'F1', unit_type: 'Bedsitter', rent: 12000 })).json();
  const tenant = await (await c.request('POST', '/api/tenants', {
    full_name: 'Ops Tenant',
    email: 'ops.tenant@test.ke',
    phone: '0722111333',
    unit_id: unit.unit.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
  })).json();
  assert.ok(tenant.tenant_id);
  const maint = await c.request('POST', '/api/maintenance', {
    title: 'Broken tap',
    description: 'The kitchen tap is leaking and drips all night long.',
    property_id: prop.property.id,
    unit_id: unit.unit.id,
  });
  assert.equal(maint.status, 201);
  const pay = await c.request('POST', '/api/payments/record', { tenant_id: tenant.tenant_id, amount: 12000, method: 'cash' });
  assert.equal(pay.status, 201);
});

await test('move-out completes: unit vacant, lease terminated, tenant history preserved', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'MoveOut Landlord', email: 'mo.landlord@test.ke' });
  const prop = await (await landlord.request('POST', '/api/properties', { name: 'MoveOut Court', county: 'Nairobi', property_type: 'Apartment' })).json();
  const unit = await (await landlord.request('POST', '/api/units', { property_id: prop.property.id, unit_number: 'D1', unit_type: '1 Bedroom', rent: 20000 })).json();
  const tenant = await (await landlord.request('POST', '/api/tenants', {
    full_name: 'Leaving Tenant',
    email: 'leaving@test.ke',
    phone: '0755000111',
    unit_id: unit.unit.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
  })).json();

  const initiate = await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out`, {
    move_out_date: '2026-10-01',
    reason: 'Relocation for work',
    damages: [{ description: 'Broken door handle', cost: 2000 }],
    keys_returned: true,
  });
  assert.equal(initiate.status, 201);
  const initiated = (await initiate.json()).move_out;
  assert.equal(initiated.status, 'initiated');
  assert.equal(initiated.damages_cost, 2000);

  const leaseAfterInit = await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json();
  assert.equal(leaseAfterInit.lease.status, 'active');

  const complete = await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out/complete`, {
    deposit_refund: 1000,
    keys_returned: true,
  });
  assert.equal(complete.status, 200);
  const done = (await complete.json()).move_out;
  assert.equal(done.status, 'completed');
  assert.ok(done.outstanding_rent >= 0, 'outstanding rent is server-computed');

  const leaseAfter = await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json();
  assert.equal(leaseAfter.lease.status, 'terminated');
  assert.equal(leaseAfter.lease.end_date, '2026-10-01');

  const unitsAfter = await (await landlord.request('GET', '/api/units')).json();
  const u = unitsAfter.units.find((x) => x.id === unit.unit.id);
  assert.equal(u.status, 'vacant');

  const tenantDetail = await (await landlord.request('GET', `/api/tenants/${tenant.tenant_id}`)).json();
  assert.ok(tenantDetail.tenant, 'tenant account preserved after move-out');
});

await test('landlord activity report filters by property and shows actor', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Act Landlord', email: 'act.landlord@test.ke' });
  const prop = await (await landlord.request('POST', '/api/properties', { name: 'Act Court', county: 'Nairobi', property_type: 'Apartment' })).json();
  await landlord.request('POST', '/api/units', { property_id: prop.property.id, unit_number: 'E1', unit_type: 'Studio', rent: 10000 });
  const res = await landlord.request('GET', `/api/reports/activity?property_id=${prop.property.id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.activity) && body.activity.length >= 1);
  const row = body.activity.find((a) => a.action === 'unit.created');
  assert.ok(row);
  assert.equal(row.property_id, prop.property.id);
  assert.equal(row.user_name, 'Act Landlord');
  assert.equal(row.actor_role, 'landlord');
});

await test('caretaker reports are scoped to assigned properties only', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Rep Landlord', email: 'rep.landlord@test.ke' });
  const prop = await (await landlord.request('POST', '/api/properties', { name: 'Rep Court', county: 'Nairobi', property_type: 'Apartment' })).json();
  await landlord.request('POST', `/api/properties/${prop.property.id}/caretakers`, {
    full_name: 'Rep Caretaker',
    email: 'rep.caretaker@test.ke',
    phone: '0711222333',
    password: 'Caretaker@123',
  });
  const c = session();
  await c.request('POST', '/api/auth/login', { email: 'rep.caretaker@test.ke', password: 'Caretaker@123' });
  const overview = await c.request('GET', '/api/reports/overview');
  assert.equal(overview.status, 200);
  const outside = await c.request('GET', `/api/reports/activity?property_id=999999`);
  assert.equal(outside.status, 400);
});

await test('caretaker posts a property-wide announcement; only active tenants of that property are notified once', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Ann Landlord', email: 'ann.landlord@test.ke' });
  const propA = (await (await landlord.request('POST', '/api/properties', { name: 'Ann A', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const propB = (await (await landlord.request('POST', '/api/properties', { name: 'Ann B', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const assign = await landlord.request('POST', `/api/properties/${propA.id}/caretakers`, {
    full_name: 'Ann Caretaker',
    email: 'ann.caretaker@test.ke',
    phone: '0711222333',
    password: 'Caretaker@123',
  });
  assert.equal(assign.status, 201);

  const mkTenant = async (name, email, phone, propId, unitNo, password) => {
    const unit = (await (await landlord.request('POST', '/api/units', { property_id: propId, unit_number: unitNo, unit_type: '1 Bedroom', rent: 18000, deposit: 18000 })).json()).unit;
    const tenant = await (await landlord.request('POST', '/api/tenants', {
      full_name: name,
      email,
      phone,
      unit_id: unit.id,
      start_date: '2026-01-01',
      end_date: '2027-01-01',
      password,
    })).json();
    return tenant;
  };

  const ta = await mkTenant('Ann Ten A', 'ann.ta@test.ke', '0701000111', propA.id, 'AA1', 'Tenant@123');
  const multi = await mkTenant('Multi Props', 'ann.multi@test.ke', '0702000222', propB.id, 'BB1', 'Tenant@123');
  const unitA2 = (await (await landlord.request('POST', '/api/units', { property_id: propA.id, unit_number: 'AA2', unit_type: 'Studio', rent: 12000 })).json()).unit;
  const lease2 = await landlord.request('POST', '/api/leases', {
    tenant_id: multi.tenant_id,
    unit_id: unitA2.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
    rent: 12000,
  });
  assert.equal(lease2.status, 201);

  const c = session();
  const clogin = await c.request('POST', '/api/auth/login', { email: 'ann.caretaker@test.ke', password: 'Caretaker@123' });
  assert.equal(clogin.status, 200);
  const post = await c.request('POST', '/api/announcements', {
    property_id: propA.id,
    title: 'Water shut-off',
    body: 'Water will be off on Saturday from 9am to 12pm for tank cleaning.',
  });
  assert.equal(post.status, 201);
  const posted = await post.json();
  assert.ok(posted.notified >= 2, 'both active tenants of the property are counted');

  const tenantLogin = async (email) => {
    const s = session();
    const res = await s.request('POST', '/api/auth/login', { email, password: 'Tenant@123' });
    assert.equal(res.status, 200);
    return s;
  };
  const aSession = await tenantLogin('ann.ta@test.ke');
  const mSession = await tenantLogin('ann.multi@test.ke');

  const taAnn = await (await aSession.request('GET', '/api/announcements')).json();
  assert.ok(taAnn.announcements.some((a) => a.title === 'Water shut-off'));
  const multiAnn = await (await mSession.request('GET', '/api/announcements')).json();
  assert.ok(multiAnn.announcements.some((a) => a.title === 'Water shut-off'), 'tenant with two active leases sees announcements across properties');

  for (const s of [aSession, mSession]) {
    const ns = await (await s.request('GET', '/api/notifications?limit=100')).json();
    assert.equal(ns.notifications.filter((x) => x.type === 'announcement').length, 1, 'exactly one notification per tenant (dedupe)');
  }

  const landlordSees = await (await landlord.request('GET', '/api/announcements')).json();
  assert.ok(landlordSees.announcements.some((a) => a.title === 'Water shut-off'));

  const cross = await c.request('POST', '/api/announcements', {
    property_id: propB.id,
    title: 'Sneaky broadcast',
    body: 'Trying to broadcast to tenants of a property outside the caretaker scope.',
  });
  assert.equal(cross.status, 403);

  const tPost = await aSession.request('POST', '/api/announcements', {
    property_id: propA.id,
    title: 'Tenant broadcast',
    body: 'Tenants must not be able to create announcements.',
  });
  assert.equal(tPost.status, 403);

  const act = await (await landlord.request('GET', '/api/reports/activity?action=announcement')).json();
  const created = act.activity.find((r) => r.action === 'announcement.created');
  assert.ok(created, 'announcement creation is recorded in the audit log');
  assert.equal(created.property_id, propA.id);
});

await test('announcement sent to selected tenants notifies only those tenants', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Sel Landlord', email: 'sel.landlord@test.ke' });
  const prop = (await (await landlord.request('POST', '/api/properties', { name: 'Sel Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  await landlord.request('POST', `/api/properties/${prop.id}/caretakers`, {
    full_name: 'Sel Caretaker',
    email: 'sel.caretaker@test.ke',
    phone: '0711222333',
    password: 'Caretaker@123',
  });
  const mk = async (name, email, phone, unitNo) => {
    const unit = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: unitNo, unit_type: '1 Bedroom', rent: 15000 })).json()).unit;
    const t = await (await landlord.request('POST', '/api/tenants', {
      full_name: name,
      email,
      phone,
      unit_id: unit.id,
      start_date: '2026-01-01',
      end_date: '2027-01-01',
      password: 'Tenant@123',
    })).json();
    return t;
  };
  const t1 = await mk('Sel One', 'sel.t1@test.ke', '0703111333', 'S1');
  const t2 = await mk('Sel Two', 'sel.t2@test.ke', '0703222444', 'S2');
  const t3 = await mk('Sel Three', 'sel.t3@test.ke', '0703333555', 'S3');

  const c = session();
  await c.request('POST', '/api/auth/login', { email: 'sel.caretaker@test.ke', password: 'Caretaker@123' });
  const res = await c.request('POST', '/api/announcements', {
    property_id: prop.id,
    title: 'New security guard',
    body: 'A new night security guard has been hired effective immediately.',
    tenant_ids: [t1.tenant_id],
  });
  assert.equal(res.status, 201);
  assert.equal((await res.json()).notified, 1);

  const countAnn = async (email) => {
    const s = session();
    await s.request('POST', '/api/auth/login', { email, password: 'Tenant@123' });
    const ns = await (await s.request('GET', '/api/notifications?limit=100')).json();
    return ns.notifications.filter((x) => x.type === 'announcement').length;
  };
  const ids = [['sel.t1@test.ke', 1], ['sel.t2@test.ke', 0], ['sel.t3@test.ke', 0], ['sel.t1@test.ke', 1]];
  for (const [email, want] of ids) assert.equal(await countAnn(email), want, `${email} notification count`);
});

await test('reports/caretakers does not leak another landlord\'s caretakers or property names', async () => {
  const l1 = session();
  await register(l1, { role: 'landlord', full_name: 'Ctk Landlord One', email: 'ctk.landlord1@test.ke' });
  const p1 = (await (await l1.request('POST', '/api/properties', { name: 'Ctk Secret Place', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  await l1.request('POST', `/api/properties/${p1.id}/caretakers`, {
    full_name: 'Ctk One',
    email: 'ctk.one@test.ke',
    phone: '0711222333',
    password: 'Caretaker@123',
  });

  const l2 = session();
  await register(l2, { role: 'landlord', full_name: 'Ctk Landlord Two', email: 'ctk.landlord2@test.ke' });
  const p2 = (await (await l2.request('POST', '/api/properties', { name: 'Ctk My Place', county: 'Nairobi', property_type: 'Apartment' })).json()).property;

  const res = await l2.request('GET', '/api/reports/caretakers');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(!body.caretakers.some((c) => c.email === 'ctk.one@test.ke'), 'landlord must not see caretakers assigned to another landlord');
  assert.ok(!body.caretakers.some((c) => (c.properties || []).some((a) => a.property_id === p1.id)), 'no assignments leak from another property');

  const mine = await l1.request('GET', '/api/reports/caretakers');
  const mineBody = await mine.json();
  const me = mineBody.caretakers.find((c) => c.email === 'ctk.one@test.ke');
  assert.ok(me && me.properties.some((a) => a.property_id === p1.id), 'assigning landlord sees their caretaker and assignment');
});

await test('reports/overview and tenants lists never mix landlords', async () => {
  const l1 = session();
  await register(l1, { role: 'landlord', full_name: 'Mix Landlord One', email: 'mix.landlord1@test.ke' });
  const p1 = (await (await l1.request('POST', '/api/properties', { name: 'Mix One', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const u1 = (await (await l1.request('POST', '/api/units', { property_id: p1.id, unit_number: 'M1', unit_type: 'Bedsitter', rent: 9000 })).json()).unit;
  await l1.request('POST', '/api/tenants', {
    full_name: 'Mix Tenant One',
    email: 'mix.t1@test.ke',
    phone: '0704111222',
    unit_id: u1.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
  });

  const l2 = session();
  await register(l2, { role: 'landlord', full_name: 'Mix Landlord Two', email: 'mix.landlord2@test.ke' });
  const p2 = (await (await l2.request('POST', '/api/properties', { name: 'Mix Two', county: 'Nairobi', property_type: 'Apartment' })).json()).property;

  const overview = await (await l2.request('GET', '/api/reports/overview')).json();
  assert.equal(overview.stats.properties, 1, 'overview counts only the landlord\'s own properties');
  assert.ok(!overview.incomeByProperty.some((r) => r.property_id === p1.id), 'income is only for own properties');
  const tenants = await (await l2.request('GET', '/api/tenants')).json();
  assert.ok(!tenants.tenants.some((t) => t.email === 'mix.t1@test.ke'), 'landlord only sees their own tenants');
});

await test('caretaker can only see and decide applications for assigned properties', async () => {
  const { insert: dbInsert } = await import('../src/db/index.js');

  const l1 = session();
  await register(l1, { role: 'landlord', full_name: 'App Landlord One', email: 'app.landlord1@test.ke' });
  const p1 = (await (await l1.request('POST', '/api/properties', { name: 'App One', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const assign = await l1.request('POST', `/api/properties/${p1.id}/caretakers`, {
    full_name: 'App Caretaker',
    email: 'app.caretaker@test.ke',
    phone: '0711222333',
    password: 'Caretaker@123',
  });
  assert.equal(assign.status, 201);

  const l2 = session();
  await register(l2, { role: 'landlord', full_name: 'App Landlord Two', email: 'app.landlord2@test.ke' });
  const p2 = (await (await l2.request('POST', '/api/properties', { name: 'App Two', county: 'Nairobi', property_type: 'Apartment' })).json()).property;

  const applicant = session();
  const reg = await register(applicant, { full_name: 'Applicant A', email: 'app.a@test.ke' });
  const applicantId = (await reg.json()).user.id;
  const appInScope = dbInsert(
    `INSERT INTO applications (property_id, applicant_id, full_name, email, phone, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [p1.id, applicantId, 'Applicant A', 'app.a@test.ke', '0711111222']
  );
  dbInsert(
    `INSERT INTO applications (property_id, applicant_id, full_name, email, phone, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
    [p2.id, applicantId, 'Applicant B', 'app.b@test.ke', '0711111333']
  );

  const c = session();
  await c.request('POST', '/api/auth/login', { email: 'app.caretaker@test.ke', password: 'Caretaker@123' });
  const list = await (await c.request('GET', '/api/applications')).json();
  assert.ok(list.applications.some((a) => a.id === appInScope));
  assert.ok(!list.applications.some((a) => a.email === 'app.b@test.ke' || a.property_id === p2.id), 'caretaker sees no applications from other properties');

  const outsideId = dbGet('SELECT id FROM applications WHERE email = ?', ['app.b@test.ke']).id;
  const outside = await c.request('PATCH', `/api/applications/${outsideId}`, { status: 'under_review' });
  assert.ok([403, 404].includes(outside.status), `blocked with ${outside.status}`);
  const inside = await c.request('PATCH', `/api/applications/${appInScope}`, { status: 'rejected', reviewer_notes: 'Scope exhausted' });
  assert.equal(inside.status, 200);
});

await test('maintenance cannot attach a tenant or unit from a different property', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Maint Landlord', email: 'maint.landlord@test.ke' });
  const p1 = (await (await landlord.request('POST', '/api/properties', { name: 'Maint One', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const p2 = (await (await landlord.request('POST', '/api/properties', { name: 'Maint Two', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const u1 = (await (await landlord.request('POST', '/api/units', { property_id: p1.id, unit_number: 'MT1', unit_type: 'Bedsitter', rent: 10000 })).json()).unit;
  const u2 = (await (await landlord.request('POST', '/api/units', { property_id: p2.id, unit_number: 'MT2', unit_type: 'Bedsitter', rent: 11000 })).json()).unit;
  const t1 = (await (await landlord.request('POST', '/api/tenants', {
    full_name: 'Maint Tenant One',
    email: 'maint.t1@test.ke',
    phone: '0705111111',
    unit_id: u1.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
  })).json());
  const t2 = (await (await landlord.request('POST', '/api/tenants', {
    full_name: 'Maint Tenant Two',
    email: 'maint.t2@test.ke',
    phone: '0705222222',
    unit_id: u2.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
  })).json());

  const wrongTenant = await landlord.request('POST', '/api/maintenance', {
    title: 'Leak in unit',
    description: 'The tenant on another property filed this under the wrong property.',
    property_id: p1.id,
    tenant_id: t2.tenant_id,
  });
  assert.equal(wrongTenant.status, 400);
  const wrongUnit = await landlord.request('POST', '/api/maintenance', {
    title: 'Leak in unit',
    description: 'A unit belonging to another property must be rejected.',
    property_id: p1.id,
    unit_id: u2.id,
  });
  assert.equal(wrongUnit.status, 400);
  const ok = await landlord.request('POST', '/api/maintenance', {
    title: 'Leak in unit',
    description: 'Bathroom tap leaks and the floor is getting wet.',
    property_id: p1.id,
    unit_id: u1.id,
    tenant_id: t1.tenant_id,
  });
  assert.equal(ok.status, 201);
});

await test('move-out completion keeps settlement values (deposit refund, meters, keys, notes)', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Settle Landlord', email: 'settle.landlord@test.ke' });
  const prop = (await (await landlord.request('POST', '/api/properties', { name: 'Settle Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const unit = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: 'SL1', unit_type: '1 Bedroom', rent: 20000, deposit: 20000 })).json()).unit;
  const tenant = (await (await landlord.request('POST', '/api/tenants', {
    full_name: 'Settle Tenant',
    email: 'settle.t@test.ke',
    phone: '0706111111',
    unit_id: unit.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
  })).json());

  const initiate = await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out`, {
    move_out_date: '2026-10-01',
    reason: 'End of contract',
    keys_returned: false,
  });
  assert.equal(initiate.status, 201);

  const complete = await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out/complete`, {
    deposit_refund: 3000,
    refund_status: 'refunded',
    meter_water: '4567',
    meter_electricity: '1234',
    keys_returned: true,
    keys_notes: 'Handed to the caretaker',
    notes: 'Account settled in full',
    inspection_notes: 'Walls repainted by the tenant',
    inspection_findings: '[{"finding":"paint faded","resolution":"repainted"}]',
  });
  assert.equal(complete.status, 200);
  const done = (await complete.json()).move_out;
  assert.equal(done.status, 'completed');
  assert.equal(done.deposit_refund, 3000);
  assert.equal(done.refund_status, 'refunded');
  assert.equal(done.meter_water, '4567');
  assert.equal(done.meter_electricity, '1234');
  assert.equal(done.keys_returned, 1);
  assert.equal(done.keys_notes, 'Handed to the caretaker');
  assert.equal(done.notes, 'Account settled in full');
  assert.ok(done.inspection_notes && done.inspection_notes.length > 0);
  assert.ok(done.reason === 'End of contract', 'reason kept from initiation');

  const noPayment = dbGet('SELECT COUNT(*) AS c FROM payments WHERE tenant_id = ?', [tenant.tenant_id]);
  assert.equal(noPayment.c, 0, 'no automatic deposit refund payment is created');
});

await test('move-out cannot complete until keys are returned; unit is not released', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Keys Landlord', email: 'keys.landlord@test.ke' });
  const prop = (await (await landlord.request('POST', '/api/properties', { name: 'Keys Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const unit = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: 'KY1', unit_type: 'Studio', rent: 12000 })).json()).unit;
  const tenant = (await (await landlord.request('POST', '/api/tenants', {
    full_name: 'Keys Tenant',
    email: 'keys.t@test.ke',
    phone: '0707222222',
    unit_id: unit.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
  })).json());

  await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out`, { move_out_date: '2026-10-01', reason: 'Moving', keys_returned: false });
  const blocked = await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out/complete`, { keys_returned: false });
  assert.equal(blocked.status, 400);

  const leaseNow = (await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json()).lease;
  assert.equal(leaseNow.status, 'active', 'lease still active when keys not returned');
  const unitsNow = (await (await landlord.request('GET', '/api/units')).json()).units;
  assert.equal(unitsNow.find((u) => u.id === unit.id).status, 'occupied', 'unit not released before keys are returned');
});

await test('duplicate move-out completion is blocked', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Dup Landlord', email: 'dup.landlord@test.ke' });
  const prop = (await (await landlord.request('POST', '/api/properties', { name: 'Dup Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const unit = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: 'DU1', unit_type: 'Studio', rent: 12000 })).json()).unit;
  const tenant = (await (await landlord.request('POST', '/api/tenants', {
    full_name: 'Dup Tenant',
    email: 'dup.t@test.ke',
    phone: '0708333333',
    unit_id: unit.id,
    start_date: '2026-01-01',
    end_date: '2027-01-01',
  })).json());

  await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out`, { move_out_date: '2026-10-01', keys_returned: false });
  const first = await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out/complete`, { keys_returned: true });
  assert.equal(first.status, 200);
  const second = await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out/complete`, { keys_returned: true });
  assert.equal(second.status, 400);

  const after = (await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json()).lease;
  assert.equal(after.status, 'terminated');
  const moCount = dbGet('SELECT COUNT(*) AS c FROM move_outs WHERE lease_id = ?', [tenant.lease_id]);
  assert.equal(moCount.c, 1, 'exactly one move-out record remains');
});

await test('migration lifts an old-schema DB to the caretaker schema without data loss', async () => {
  const oldPath = path.join(tmpDir, 'old-schema.db');
  if (fs.existsSync(oldPath)) fs.rmSync(oldPath, { force: true });
  const old = new DatabaseSync(oldPath);
  old.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL DEFAULT 'tenant' CHECK (role IN ('admin','landlord','tenant')),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
      avatar_url TEXT, county TEXT, id_number TEXT, bio TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE properties (id INTEGER PRIMARY KEY AUTOINCREMENT, landlord_id INTEGER NOT NULL, name TEXT NOT NULL, county TEXT NOT NULL, area TEXT, address TEXT, property_type TEXT NOT NULL DEFAULT 'Apartment', description TEXT, amenities TEXT NOT NULL DEFAULT '[]', images TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active', views INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE units (id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL, unit_number TEXT NOT NULL, floor TEXT, unit_type TEXT NOT NULL, bedrooms INTEGER NOT NULL DEFAULT 0, rent INTEGER NOT NULL, deposit INTEGER NOT NULL DEFAULT 0, size_sqm INTEGER, status TEXT NOT NULL DEFAULT 'vacant', amenities TEXT NOT NULL DEFAULT '[]', description TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(property_id, unit_number));
    CREATE TABLE leases (id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL, unit_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, rent INTEGER NOT NULL, deposit INTEGER NOT NULL DEFAULT 0, frequency TEXT NOT NULL DEFAULT 'monthly', status TEXT NOT NULL DEFAULT 'active', document_url TEXT, notes TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE payments (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER NOT NULL, property_id INTEGER, unit_id INTEGER, lease_id INTEGER, amount INTEGER NOT NULL, period TEXT, months_covered INTEGER NOT NULL DEFAULT 1, method TEXT NOT NULL DEFAULT 'mpesa', provider TEXT NOT NULL DEFAULT 'mpesa', status TEXT NOT NULL DEFAULT 'pending', phone TEXT, reference TEXT, receipt_number TEXT UNIQUE, provider_ref TEXT, failure_reason TEXT, paid_at TEXT, recorded_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE maintenance_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL, unit_id INTEGER, tenant_id INTEGER, title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General', priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'submitted', photos TEXT NOT NULL DEFAULT '[]', assigned_to TEXT, estimated_cost INTEGER, actual_cost INTEGER, resolution_notes TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE applications (id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER NOT NULL, unit_id INTEGER, applicant_id INTEGER, full_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT NOT NULL, move_in_date TEXT, occupants INTEGER NOT NULL DEFAULT 1, message TEXT, documents TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', reviewer_notes TEXT, reviewed_by INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, body TEXT, link TEXT, dedupe_key TEXT, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, sender_id INTEGER NOT NULL, recipient_id INTEGER NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, thread_key TEXT, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE announcements (id INTEGER PRIMARY KEY AUTOINCREMENT, property_id INTEGER, landlord_id INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, audience TEXT NOT NULL DEFAULT 'all', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE audit_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, action TEXT NOT NULL, entity TEXT, entity_id TEXT, details TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  old.prepare("INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('admin', 'Old Admin', 'old.admin@test.ke', '0711111000', '$2a$10$preserved-hash-value', 'active')").run();
  old.prepare("INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('landlord', 'Old Landlord', 'old.landlord@test.ke', '0711111001', '$2a$10$second-hash-value', 'active')").run();
  old.prepare("INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('tenant', 'Old Tenant', 'old.tenant@test.ke', '0711111002', '$2a$10$third-hash-value', 'active')").run();
  old.prepare('INSERT INTO properties (landlord_id, name, county) VALUES (2, \'Legacy Estate\', \'Nairobi\')').run();
  old.prepare("INSERT INTO units (property_id, unit_number, unit_type, rent, deposit, status) VALUES (1, 'LG1', '1 Bedroom', 15000, 15000, 'occupied')").run();
  old.prepare("INSERT INTO leases (property_id, unit_id, tenant_id, start_date, end_date, rent, deposit, status) VALUES (1, 1, 3, '2025-01-01', '2026-01-01', 15000, 15000, 'active')").run();
  old.prepare("INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, method, status, receipt_number) VALUES (3, 1, 1, 1, 15000, 'mpesa', 'completed', 'MIG-RECEIPT-1')").run();
  old.prepare("INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES (2, 'property.created', 'property', '1', NULL)").run();
  old.close();

  const migrated = openDb(oldPath);
  migrated.prepare("INSERT INTO users (role, full_name, email, phone, password_hash) VALUES ('caretaker', 'New Caretaker', 'old.ctk@test.ke', '0711111003', 'hash4')").run();
  const users = migrated.prepare('SELECT * FROM users ORDER BY id').all();
  assert.equal(users.length, 4, 'original + migrated caretaker user');
  assert.equal(users[0].password_hash, '$2a$10$preserved-hash-value', 'password hash preserved');
  assert.equal(users[1].email, 'old.landlord@test.ke');
  const newUser = migrated.prepare("INSERT INTO users (role, full_name, email, phone, password_hash) VALUES ('tenant', 'Post Migrate', 'post.migrate@test.ke', '0711111004', 'hash5')").run();
  assert.ok(newUser, 'new registrations work after migration (created_at default restored)');
  const expectedUsers = Number(migrated.prepare('SELECT COUNT(*) AS c FROM users').get().c);
  const tables = migrated.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  assert.ok(tables.includes('property_caretakers'));
  assert.ok(tables.includes('move_outs'));
  const auditCols = migrated.prepare('PRAGMA table_info(audit_logs)').all().map((c) => c.name);
  assert.ok(auditCols.includes('property_id') && auditCols.includes('actor_role'), 'audit_logs gained scope columns');
  assert.equal(Number(migrated.prepare('SELECT COUNT(*) AS c FROM payments').get().c), 1);
  assert.equal(Number(migrated.prepare('SELECT COUNT(*) AS c FROM leases').get().c), 1);
  assert.equal(Number(migrated.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c), 1);
  migrated.close();

  const again = openDb(oldPath);
  assert.equal(Number(again.prepare('SELECT COUNT(*) AS c FROM users').get().c), expectedUsers, 're-opening is idempotent');
  assert.equal(Number(again.prepare('SELECT COUNT(*) AS c FROM payments').get().c), 1);
  again.close();
});

await test('migration applies cleanly to a copy of the existing dev database', async () => {
  const realDb = path.join(__dirname, '..', '..', 'data.db');
  if (!fs.existsSync(realDb)) {
    console.log('    (no dev data.db found, skipping)');
    return;
  }
  const copyPath = path.join(tmpDir, 'dev-copy.db');
  fs.copyFileSync(realDb, copyPath);
  for (const ext of ['-wal', '-shm']) {
    const src = `${realDb}${ext}`;
    if (fs.existsSync(src)) fs.copyFileSync(src, `${copyPath}${ext}`);
  }

  const raw = new DatabaseSync(copyPath);
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  const before = {};
  for (const t of ['users', 'properties', 'units', 'leases', 'payments', 'maintenance_requests', 'move_outs', 'property_caretakers', 'announcements', 'audit_logs']) {
    if (tables.includes(t)) before[t] = Number(raw.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c);
  }
  const sampleHash = raw.prepare('SELECT password_hash FROM users ORDER BY id LIMIT 1').get()?.password_hash ?? null;
  raw.close();

  assert.ok(before.users >= 1, 'dev database contains real user records');

  const migrated = openDb(copyPath);
  for (const t of Object.keys(before)) {
    const now = Number(migrated.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c);
    assert.ok(now >= before[t], `${t} row count not reduced by migration (${before[t]} -> ${now})`);
  }
  if (sampleHash) {
    assert.equal(migrated.prepare('SELECT password_hash FROM users ORDER BY id LIMIT 1').get().password_hash, sampleHash, 'password hashes preserved');
  }
  const caretakerOk = migrated.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'caretaker'").get().c;
  assert.ok(Number(caretakerOk) >= 0);
  migrated.close();

  const reopened = openDb(copyPath);
  assert.ok(Number(reopened.prepare('SELECT COUNT(*) AS c FROM users').get().c) >= before.users);
  reopened.close();
});

await test('production config guard rejects unsafe settings', async () => {
  const saved = process.env.COOKIE_SECURE;
  const mpesaKeys = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_ENV', 'MPESA_CALLBACK_URL'];
  const savedMpesa = Object.fromEntries(mpesaKeys.map((k) => [k, process.env[k]]));
  const resetMpesa = () => {
    for (const [k, v] of Object.entries(savedMpesa)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  try {
    delete process.env.COOKIE_SECURE;
    for (const k of mpesaKeys) delete process.env[k];
    const bad = validateEnvConfig('production', { jwtSecret: undefined });
    assert.ok(bad.errors.some((e) => e.includes('JWT_SECRET')), 'flags missing JWT secret');
    assert.ok(bad.errors.some((e) => e.includes('COOKIE_SECURE')), 'flags insecure cookie setting');
    assert.equal(validateEnvConfig('development', {}).errors.length, 0, 'dev is not blocked');

    process.env.COOKIE_SECURE = '1';
    for (const k of mpesaKeys) delete process.env[k];
    const good = validateEnvConfig('production', { jwtSecret: 'x'.repeat(48) });
    assert.equal(good.errors.length, 0, `safe production config passes (errors=${JSON.stringify(good.errors)})`);

    process.env.MPESA_ENV = 'sandbox';
    assert.ok(
      validateEnvConfig('production', { jwtSecret: 'x'.repeat(48) }).errors.some((e) => e.includes('M-Pesa')),
      'sandbox M-Pesa is flagged in production'
    );
  } finally {
    if (saved === undefined) delete process.env.COOKIE_SECURE;
    else process.env.COOKIE_SECURE = saved;
    resetMpesa();
  }
});

await test('login rate limit returns 429 after too many attempts', async () => {
  process.env.RATE_LIMIT_LOGIN_MAX = '3';
  const app2 = createApp();
  const srv2 = app2.listen(0);
  const { port: p2 } = srv2.address();
  try {
    let last;
    for (let i = 0; i < 4; i += 1) {
      last = await fetch(`http://127.0.0.1:${p2}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@test.ke', password: 'wrong-pass' }),
      });
    }
    assert.equal(last.status, 429);
    assert.ok(last.headers.get('retry-after'), 'sends Retry-After header');
  } finally {
    delete process.env.RATE_LIMIT_LOGIN_MAX;
    await new Promise((resolve) => srv2.close(resolve));
  }
});

await test('mpesa refuses mock mode in production (no live credentials)', async () => {
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  for (const k of ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY', 'MPESA_ENV']) delete process.env[k];
  const fresh = (await import(`../src/services/payments/mpesa.js?prod=${Date.now()}`)).default;
  await assert.rejects(() => fresh.stkPush({ phone: '0712345678', amount: 100 }), /not configured/i);
  process.env.NODE_ENV = saved;
});

await test('mpesa uses mock mode outside production', async () => {
  const saved = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  const fresh = (await import(`../src/services/payments/mpesa.js?mock=${Date.now()}`)).default;
  const push = await fresh.stkPush({ phone: '0712345678', amount: 100 });
  assert.match(push.checkoutRequestId, /^MOCK-/);
  process.env.NODE_ENV = saved;
});

await test('uploads reject spoofed content and disallowed extensions', async () => {
  const s = session();
  await register(s, { role: 'landlord', full_name: 'Upload Owner', email: 'upload.owner@test.ke' });
  const cookie = { cookie: s.cookie() };

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  const good = new FormData();
  good.append('files', new Blob([png], { type: 'image/png' }), 'sample.png');
  const okRes = await fetch(`${base}/api/uploads`, { method: 'POST', headers: cookie, body: good });
  assert.equal(okRes.status, 201, 'valid PNG accepted');
  assert.ok((await okRes.json()).files[0].startsWith('/uploads/'));

  const spoof = new FormData();
  spoof.append('files', new Blob([Buffer.from('<html>not an image</html>')], { type: 'image/png' }), 'fake.png');
  const spoofRes = await fetch(`${base}/api/uploads`, { method: 'POST', headers: cookie, body: spoof });
  assert.equal(spoofRes.status, 400, 'spoofed image content rejected');

  const badExt = new FormData();
  badExt.append('files', new Blob([Buffer.from('x')], { type: 'image/png' }), 'payload.html');
  const badExtRes = await fetch(`${base}/api/uploads`, { method: 'POST', headers: cookie, body: badExt });
  assert.equal(badExtRes.status, 400, 'disallowed extension rejected');

  const svg = new FormData();
  svg.append('files', new Blob([Buffer.from('<svg></svg>')], { type: 'image/svg+xml' }), 'x.svg');
  const svgRes = await fetch(`${base}/api/uploads`, { method: 'POST', headers: cookie, body: svg });
  assert.equal(svgRes.status, 400, 'SVG no longer allowed');
});

async function acctScenario({ landlordEmail, tenantEmail, rent = 12500, start, end, unitNo = 'A1' }) {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Acct Owner', email: landlordEmail });
  const prop = (await (await landlord.request('POST', '/api/properties', { name: `${landlordEmail} Place`, county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const unit = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: unitNo, unit_type: '1 Bedroom', rent })).json()).unit;
  const tenant = await (await landlord.request('POST', '/api/tenants', {
    full_name: 'Acct Tenant',
    email: tenantEmail,
    phone: '0709123456',
    unit_id: unit.id,
    start_date: start,
    end_date: end,
    password: 'Tenant@123',
  })).json();
  return { landlord, prop, unit, tenant };
}

const _now = new Date();
const ymOff = (off) => {
  const d = new Date(_now.getFullYear(), _now.getMonth() - off, 5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

await test('rent accounting is timezone-safe, amount-based and underpayment cannot clear months', async () => {
  const R = 12500;
  const start = ymOff(5);
  const { landlord, prop, unit, tenant } = await acctScenario({
    landlordEmail: 'acct1.l@test.ke',
    tenantEmail: 'acct1.t@test.ke',
    rent: R,
    start: `${start}-05`,
    end: `${Number(start.slice(0, 4)) + 1}-${start.slice(5, 7)}-05`,
  });
  const db = new DatabaseSync(process.env.DB_PATH);
  const pay = (amount, period, months) =>
    db
      .prepare(
        `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'cash', 'cash', 'completed', ?)`
      )
      .run(tenant.tenant_id, prop.id, unit.id, tenant.lease_id, amount, period, months, new Date().toISOString());

  const leaseArrears = async () => (await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json()).lease;

  let l = await leaseArrears();
  assert.equal(l.arrears_months, 6, 'six elapsed months count (no phantom month from timezone parsing)');
  assert.equal(l.arrears, 6 * R);

  pay(R, start, 1);
  l = await leaseArrears();
  assert.equal(l.arrears_months, 5, 'one exact payment covers exactly one month');
  assert.equal(l.arrears, 5 * R);

  pay(1, start, 12);
  l = await leaseArrears();
  assert.equal(l.arrears_months, 5, 'a 1 KES payment does not clear the twelve claimed months');
  assert.equal(l.arrears, 5 * R - 1, 'arrears drop by exactly the amount actually paid');

  pay(R, start, 1);
  l = await leaseArrears();
  assert.equal(l.arrears, 4 * R - 1, 'overpayment auto-allocates forward into later months');
  assert.equal(l.arrears_months, 4);
});

await test('terminated leases stop accruing arrears at their end date', async () => {
  const R = 10000;
  const S = ymOff(3);
  const E = ymOff(1);
  const { landlord, prop, unit, tenant } = await acctScenario({
    landlordEmail: 'acct2.l@test.ke',
    tenantEmail: 'acct2.t@test.ke',
    rent: R,
    start: `${S}-05`,
    end: `${E}-05`,
    unitNo: 'B1',
  });
  const db = new DatabaseSync(process.env.DB_PATH);
  const pay = (amount, period) =>
    db
      .prepare(
        `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'cash', 'cash', 'completed', ?)`
      )
      .run(tenant.tenant_id, prop.id, unit.id, tenant.lease_id, amount, period, new Date().toISOString());
  pay(R, S);
  pay(R, ymOff(2));
  pay(R, E);

  let l = (await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json()).lease;
  assert.equal(l.status, 'active');
  assert.equal(l.arrears, R, 'only the current (beyond-end) month is unpaid while active');

  const term = await landlord.request('POST', `/api/leases/${tenant.lease_id}/terminate`, { terminate_date: `${E}-05` });
  assert.equal(term.status, 200);
  l = (await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json()).lease;
  assert.equal(l.status, 'terminated');
  assert.equal(l.arrears, 0, 'arrears stop accruing once the lease is terminated at its end date');
  assert.equal(l.arrears_months, 0);
});

await test('manual payment records notify tenant and preserve the recording date', async () => {
  const { landlord, tenant } = await acctScenario({
    landlordEmail: 'acct3.l@test.ke',
    tenantEmail: 'acct3.t@test.ke',
    rent: 12000,
    start: '2026-01-05',
    end: '2027-01-05',
    unitNo: 'C1',
  });
  const rec = await landlord.request('POST', '/api/payments/record', {
    tenant_id: tenant.tenant_id,
    amount: 24000,
    method: 'bank',
    months_covered: 2,
    paid_at: '2026-03-01T09:30:00.000Z',
  });
  assert.equal(rec.status, 201);
  const body = await rec.json();
  assert.ok(body.receipt && body.receipt.startsWith('SR-'));
  const row = dbGet('SELECT * FROM payments WHERE id = ?', [body.payment_id]);
  assert.equal(row.status, 'completed');
  assert.equal(row.paid_at, '2026-03-01T09:30:00.000Z', 'recorded payment date is preserved');

  const ts = session();
  await ts.request('POST', '/api/auth/login', { email: 'acct3.t@test.ke', password: 'Tenant@123' });
  const ns = await (await ts.request('GET', '/api/notifications?limit=20')).json();
  assert.ok(ns.notifications.some((n) => n.title === 'Payment received'), 'tenant is notified of a recorded payment');

  const bad = await landlord.request('POST', '/api/payments/record', { tenant_id: tenant.tenant_id, amount: 100, method: 'bitcoin' });
  assert.equal(bad.status, 400, 'unknown payment method is rejected');
});

await test('M-Pesa callback cannot complete a failed payment nor a mismatched amount', async () => {
  const { landlord, prop, unit, tenant } = await acctScenario({
    landlordEmail: 'acct4.l@test.ke',
    tenantEmail: 'acct4.t@test.ke',
    rent: 20000,
    start: '2026-01-05',
    end: '2027-01-05',
    unitNo: 'D1',
  });
  const db = new DatabaseSync(process.env.DB_PATH);
  const insPay = (status, amount, ref) =>
    db
      .prepare(
        `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, provider_ref, phone)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'mpesa', 'mpesa', ?, ?, '0712345678')`
      )
      .run(tenant.tenant_id, prop.id, unit.id, tenant.lease_id, amount, '2026-02-01', status, ref);
  const cb = (ref, amount) => ({
    Body: {
      stkCallback: {
        CheckoutRequestID: ref,
        ResultCode: 0,
        ResultDesc: 'Successful',
        CallbackMetadata: { Items: amount == null ? [] : [{ Name: 'Amount', Value: amount }] },
      },
    },
  });
  const postCallback = (payload) =>
    fetch(`${base}/api/payments/mpesa/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  insPay('failed', 20000, 'MOCK-TEST-FAILED');
  let res = await postCallback(cb('MOCK-TEST-FAILED', 20000));
  assert.equal((await res.json()).ResultDesc, 'Ignored', 'success callback for a failed payment is ignored');
  assert.equal(dbGet("SELECT status FROM payments WHERE provider_ref = 'MOCK-TEST-FAILED'").status, 'failed');

  const mismatchId = insPay('processing', 20000, 'MOCK-TEST-MISMATCH').lastInsertRowid;
  res = await postCallback(cb('MOCK-TEST-MISMATCH', 1000));
  assert.equal((await res.json()).ResultDesc, 'Accepted', 'callback ack is always given');
  const after = dbGet('SELECT status, failure_reason FROM payments WHERE id = ?', [mismatchId]);
  assert.equal(after.status, 'failed');
  assert.match(after.failure_reason, /amount does not match/i);

  const okId = insPay('processing', 20000, 'MOCK-TEST-OK').lastInsertRowid;
  await postCallback(cb('MOCK-TEST-OK', 20000));
  const ok = dbGet('SELECT status, receipt_number FROM payments WHERE id = ?', [okId]);
  assert.equal(ok.status, 'completed');
  assert.ok(ok.receipt_number, 'matching callback completes the payment with a receipt');
});

await test('lease creation rejects non-tenant emails, invalid rent/frequency; terminate is guarded', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'LeaseVal Landlord', email: 'lv.landlord@test.ke' });
  const prop = (await (await landlord.request('POST', '/api/properties', { name: 'LeaseVal Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const unit = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: 'LV1', unit_type: '1 Bedroom', rent: 15000, deposit: 15000 })).json()).unit;
  const unit2 = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: 'LV2', unit_type: 'Studio', rent: 10000 })).json()).unit;
  const base = { unit_id: unit.id, start_date: '2026-06-05', end_date: '2027-06-05' };
  const nonTenant = await landlord.request('POST', '/api/leases', { ...base, tenant_name: 'Bad Tenant', tenant_email: 'lv.landlord@test.ke', tenant_phone: '0711111111' });
  assert.equal(nonTenant.status, 409, 'a landlord email cannot be bound as the tenant');
  const badRent = await landlord.request('POST', '/api/leases', { ...base, tenant_name: 'Bad Tenant', tenant_email: 'lv.t0@test.ke', tenant_phone: '0711111111', rent: 'abc' });
  assert.equal(badRent.status, 400, 'non-numeric rent rejected');
  const badFreq = await landlord.request('POST', '/api/leases', { ...base, tenant_name: 'Bad Tenant', tenant_email: 'lv.t0@test.ke', tenant_phone: '0711111111', frequency: 'weekly' });
  assert.equal(badFreq.status, 400, 'invalid frequency rejected');

  const tenant = await (await landlord.request('POST', '/api/tenants', {
    full_name: 'LV Tenant', email: 'lv.t@test.ke', phone: '0712222222', unit_id: unit.id,
    start_date: '2026-06-05', end_date: '2027-06-05', password: 'Tenant@123',
  })).json();
  const futureTerm = await landlord.request('POST', `/api/leases/${tenant.lease_id}/terminate`, { terminate_date: '2030-01-01' });
  assert.equal(futureTerm.status, 400, 'future termination date rejected');
  const mo = await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out`, { move_out_date: '2026-09-01', reason: 'x', keys_returned: true });
  assert.equal(mo.status, 201);
  const blocked = await landlord.request('POST', `/api/leases/${tenant.lease_id}/terminate`, {});
  assert.equal(blocked.status, 400, 'terminate is blocked while a move-out is in progress');

  const tenant2 = await (await landlord.request('POST', '/api/tenants', {
    full_name: 'LV Tenant 2', email: 'lv.t2@test.ke', phone: '0713333333', unit_id: unit2.id,
    start_date: '2026-06-05', end_date: '2027-06-05',
  })).json();
  const term = await landlord.request('POST', `/api/leases/${tenant2.lease_id}/terminate`, {});
  assert.equal(term.status, 200);
  const after = (await (await landlord.request('GET', `/api/leases/${tenant2.lease_id}`)).json()).lease;
  assert.equal(after.status, 'terminated');
  assert.equal(after.unit_status, 'vacant', 'unit is released on termination');
});

await test('move-out completion recomputes outstanding rent from the live ledger', async () => {
  const R = 20000;
  const start = ymOff(2);
  const { landlord, prop, unit, tenant } = await acctScenario({
    landlordEmail: 'acct5.l@test.ke',
    tenantEmail: 'acct5.t@test.ke',
    rent: R,
    start: `${start}-05`,
    end: `${Number(start.slice(0, 4)) + 1}-${start.slice(5, 7)}-05`,
    unitNo: 'E1',
  });
  const db = new DatabaseSync(process.env.DB_PATH);
  const pay = (amount, period) =>
    db
      .prepare(
        `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, 'cash', 'cash', 'completed', ?)`
      )
      .run(tenant.tenant_id, prop.id, unit.id, tenant.lease_id, amount, period, new Date().toISOString());

  const initiate = await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out`, {
    move_out_date: `${start}-10`, reason: 'Moving', keys_returned: true,
  });
  assert.equal(initiate.status, 201);
  const initiated = (await initiate.json()).move_out;

  pay(R, start);

  const complete = await landlord.request('POST', `/api/leases/${tenant.lease_id}/move-out/complete`, { keys_returned: true });
  assert.equal(complete.status, 200);
  const done = (await complete.json()).move_out;

  assert.equal(initiated.outstanding_rent, 3 * R, 'initiation snapshot precedes the late payment');
  assert.equal(done.outstanding_rent, 2 * R, 'settlement recomputes rent from the live ledger, one month paid');
  const stored = dbGet('SELECT outstanding_rent FROM move_outs WHERE id = ?', [done.id]).outstanding_rent;
  assert.equal(stored, 2 * R, 'recomputed outstanding is persisted');
});

await test('an assigned application cannot be reverted to a non-assigned status', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'App Landlord', email: 'al.landlord@test.ke' });
  const prop = (await (await landlord.request('POST', '/api/properties', { name: 'App Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const unit = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: 'AP1', unit_type: '1 Bedroom', rent: 15000 })).json()).unit;
  const applicant = session();
  await register(applicant, { role: 'tenant', full_name: 'App Tenant', email: 'al.t@test.ke' });
  const apply = await applicant.request('POST', `/api/market/properties/${prop.id}/apply`, {
    full_name: 'App Tenant', email: 'al.t@test.ke', phone: '0709333111', move_in_date: '2026-11-01',
  });
  assert.equal(apply.status, 201);
  const appId = (await apply.json()).applicationId;
  const assign = await landlord.request('PATCH', `/api/applications/${appId}`, { status: 'assigned', unit_id: unit.id });
  assert.equal(assign.status, 200);
  const revert = await landlord.request('PATCH', `/api/applications/${appId}`, { status: 'pending' });
  assert.equal(revert.status, 400, 'reverting an assigned application is rejected');
  const lease = dbGet('SELECT * FROM leases WHERE tenant_id = (SELECT applicant_id FROM applications WHERE id = ?)', [appId]);
  assert.ok(lease && lease.status === 'active', 'the assigned lease is preserved');
});

await test('expenses: landlord CRUD with validations and cross-landlord privacy', async () => {
  const l1 = session();
  await register(l1, { role: 'landlord', full_name: 'Exp One', email: 'e1.landlord@test.ke' });
  const p1 = (await (await l1.request('POST', '/api/properties', { name: 'Exp One Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const u1 = (await (await l1.request('POST', '/api/units', { property_id: p1.id, unit_number: 'EX1', unit_type: '1 Bedroom', rent: 15000 })).json()).unit;
  const p2 = (await (await l1.request('POST', '/api/properties', { name: 'Exp Two Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const u2 = (await (await l1.request('POST', '/api/units', { property_id: p2.id, unit_number: 'EX2', unit_type: 'Studio', rent: 10000 })).json()).unit;

  const other = session();
  await register(other, { role: 'landlord', full_name: 'Exp Other', email: 'e2.landlord@test.ke' });
  const otherProp = (await (await other.request('POST', '/api/properties', { name: 'Other Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;

  const future = await l1.request('POST', '/api/expenses', { property_id: p1.id, description: 'x', amount: 100, expense_date: '2099-01-01' });
  assert.equal(future.status, 400, 'future expense date rejected');
  const badCat = await l1.request('POST', '/api/expenses', { property_id: p1.id, description: 'x', amount: 100, category: 'Nope' });
  assert.equal(badCat.status, 400, 'unknown category rejected');
  const badAmt = await l1.request('POST', '/api/expenses', { property_id: p1.id, description: 'x', amount: 0 });
  assert.equal(badAmt.status, 400, 'non-positive amount rejected');
  const wrongUnit = await l1.request('POST', '/api/expenses', { property_id: p1.id, unit_id: u2.id, description: 'x', amount: 100 });
  assert.equal(wrongUnit.status, 400, 'unit from another property rejected');
  const foreign = await l1.request('POST', '/api/expenses', { property_id: otherProp.id, description: 'x', amount: 100 });
  assert.equal(foreign.status, 403, 'cannot book an expense on another landlord\'s property');

  const created = await l1.request('POST', '/api/expenses', {
    property_id: p1.id, unit_id: u1.id, category: 'Utilities', description: 'Water bill', amount: 2500,
    expense_date: '2026-09-01', vendor: 'Nairobi Water', receipt_url: 'https://x.ke/r.pdf', notes: 'Sept bill',
  });
  assert.equal(created.status, 201);
  const exp = (await created.json()).expense;
  assert.equal(exp.amount, 2500);
  assert.equal(exp.property_name, 'Exp One Court');

  assert.equal((await other.request('GET', `/api/expenses/${exp.id}`)).status, 403, 'other landlord cannot read a foreign expense');
  assert.equal((await other.request('DELETE', `/api/expenses/${exp.id}`)).status, 403, 'other landlord cannot delete a foreign expense');

  const list = await (await l1.request('GET', `/api/expenses?property_id=${p1.id}&category=Utilities`)).json();
  assert.equal(list.expenses.length, 1);
  assert.equal(list.stats.total, 2500);
  assert.equal(list.byCategory[0].category, 'Utilities');
  assert.ok(list.categories.includes('Utilities'));

  const patched = await l1.request('PATCH', `/api/expenses/${exp.id}`, { amount: 3000, vendor: 'Water Co' });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).expense.amount, 3000);

  assert.equal((await l1.request('DELETE', `/api/expenses/${exp.id}`)).status, 200);
  assert.equal((await l1.request('GET', `/api/expenses/${exp.id}`)).status, 404);
});

await test('expenses: caretakers are scoped to assigned properties and notify the landlord', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Exp Landlord', email: 'el.landlord@test.ke' });
  const pa = (await (await landlord.request('POST', '/api/properties', { name: 'Exp A Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const pb = (await (await landlord.request('POST', '/api/properties', { name: 'Exp B Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  await landlord.request('POST', `/api/properties/${pa.id}/caretakers`, {
    full_name: 'Exp Caretaker', email: 'exp.caretaker@test.ke', phone: '0711222333', password: 'Caretaker@123',
  });

  const c = session();
  await c.request('POST', '/api/auth/login', { email: 'exp.caretaker@test.ke', password: 'Caretaker@123' });

  const outside = await c.request('POST', '/api/expenses', { property_id: pb.id, description: 'x', amount: 100 });
  assert.equal(outside.status, 403, 'caretaker cannot book an expense for an unassigned property');
  assert.equal((await c.request('GET', `/api/expenses?property_id=${pb.id}`)).status, 403, 'caretaker cannot filter by an unassigned property');

  const today = new Date().toISOString().slice(0, 10);
  const mine = await c.request('POST', '/api/expenses', { property_id: pa.id, description: 'Gate repairs', amount: 6000, category: 'Maintenance', expense_date: today });
  assert.equal(mine.status, 201);
  const expId = (await mine.json()).expense.id;

  const list = await (await c.request('GET', '/api/expenses')).json();
  assert.equal(list.expenses.length, 1, 'caretaker sees only in-scope expenses');
  assert.equal(list.stats.month, 6000, 'current-month stat counts the just-recorded expense');

  const ts = session();
  await ts.request('POST', '/api/auth/login', { email: 'el.landlord@test.ke', password: 'Secret123' });
  const ns = await (await ts.request('GET', '/api/notifications?limit=20')).json();
  assert.ok(ns.notifications.some((n) => n.title === 'Expense recorded'), 'landlord is notified when a caretaker records an expense');

  const child = session();
  await register(child, { role: 'tenant', full_name: 'Exp Child', email: 'exp.child@test.ke' });
  assert.equal((await child.request('GET', '/api/expenses')).status, 403, 'tenants cannot access expenses');
  assert.equal((await child.request('POST', '/api/expenses', { property_id: pa.id, description: 'x', amount: 1 })).status, 403, 'tenants cannot create expenses');

  assert.equal((await c.request('DELETE', `/api/expenses/${expId}`)).status, 200, 'caretaker can delete an in-scope expense');
});

await test('authentication: logout clears the session and revokes access to protected routes', async () => {
  const s = session();
  await register(s, { role: 'landlord', full_name: 'Logout User', email: 'logout.l@test.ke' });
  assert.equal((await s.request('GET', '/api/auth/me')).status, 200);
  const out = await s.request('POST', '/api/auth/logout');
  assert.equal(out.status, 200);
  const me = await s.request('GET', '/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user, null, 'no authenticated user after logout');
  assert.equal((await s.request('GET', '/api/properties')).status, 401, 'the logged-out cookie no longer unlocks protected routes');
});

await test('M-Pesa STK initiation creates a processing payment that callbacks complete', async () => {
  const R = 12500;
  const start = ymOff(3);
  const { landlord, prop, unit, tenant } = await acctScenario({
    landlordEmail: 'stk1.l@test.ke',
    tenantEmail: 'stk1.t@test.ke',
    rent: R,
    unitNo: 'F1',
    start: `${start}-05`,
    end: `${Number(start.slice(0, 4)) + 1}-${start.slice(5, 7)}-05`,
  });
  const t = session();
  await t.request('POST', '/api/auth/login', { email: 'stk1.t@test.ke', password: 'Tenant@123' });
  const before = (await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json()).lease.arrears_months;

  const badPhone = await t.request('POST', '/api/payments/initiate', { amount: R, phone: '123' });
  assert.equal(badPhone.status, 400, 'an invalid M-Pesa number is rejected');

  const initiate = await t.request('POST', '/api/payments/initiate', { amount: R, months_covered: 1, phone: '0712345678' });
  assert.equal(initiate.status, 201);
  const body = await initiate.json();
  assert.ok(body.checkout_request_id, 'a checkout request id is returned to the tenant');
  const row = dbGet('SELECT status, provider_ref FROM payments WHERE id = ?', [body.payment_id]);
  assert.equal(row.status, 'processing', 'the payment starts as processing');
  assert.equal(row.provider_ref, body.checkout_request_id);

  const cb = await fetch(`${base}/api/payments/mpesa/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Body: {
        stkCallback: {
          CheckoutRequestID: body.checkout_request_id,
          ResultCode: 0,
          ResultDesc: 'Successful',
          CallbackMetadata: { Items: [{ Name: 'Amount', Value: R }] },
        },
      },
    }),
  });
  assert.equal((await cb.json()).ResultDesc, 'Accepted');
  const settled = dbGet('SELECT status, receipt_number FROM payments WHERE id = ?', [body.payment_id]);
  assert.equal(settled.status, 'completed', 'a successful callback completes the STK payment');
  assert.ok(settled.receipt_number, 'it is settled with a receipt number');
  const after = (await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json()).lease;
  assert.equal(after.arrears_months, before - 1, 'one confirmed month is removed from arrears');

  const none = session();
  await register(none, { role: 'tenant', full_name: 'No Lease', email: 'stk.none@test.ke' });
  assert.equal((await none.request('POST', '/api/payments/initiate', { amount: 100 })).status, 400, 'no active lease blocks initiation');
});

await test('duplicate M-Pesa callbacks are idempotent and never double-credit', async () => {
  const { landlord, prop, unit, tenant } = await acctScenario({
    landlordEmail: 'dup.l@test.ke',
    tenantEmail: 'dup.t@test.ke',
    rent: 20000,
    unitNo: 'G1',
    start: '2026-01-05',
    end: '2027-01-05',
  });
  const db = new DatabaseSync(process.env.DB_PATH);
  db.prepare(
    `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, provider_ref, phone)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'mpesa', 'mpesa', 'processing', ?, '0712345678')`
  ).run(tenant.tenant_id, prop.id, unit.id, tenant.lease_id, 20000, '2026-02-01', 'DUP-CALLBACK-1');
  const post = () =>
    fetch(`${base}/api/payments/mpesa/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        Body: {
          stkCallback: {
            CheckoutRequestID: 'DUP-CALLBACK-1',
            ResultCode: 0,
            ResultDesc: 'Successful',
            CallbackMetadata: { Items: [{ Name: 'Amount', Value: 20000 }] },
          },
        },
      }),
    });
  assert.equal((await (await post()).json()).ResultDesc, 'Accepted');
  const first = dbGet("SELECT status, receipt_number FROM payments WHERE provider_ref = 'DUP-CALLBACK-1'");
  assert.equal(first.status, 'completed');
  assert.equal((await (await post()).json()).ResultDesc, 'Accepted', 'a duplicate callback is still acknowledged');
  const second = dbGet("SELECT status, receipt_number FROM payments WHERE provider_ref = 'DUP-CALLBACK-1'");
  assert.equal(second.status, 'completed', 'the payment stays completed');
  assert.equal(second.receipt_number, first.receipt_number, 'the same receipt is reused, not regenerated');
  assert.equal(dbGet('SELECT COUNT(*) AS c FROM payments WHERE lease_id = ?', [tenant.lease_id]).c, 1, 'no extra ledger rows are created');
  const l1 = (await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json()).lease;
  const l2 = (await (await landlord.request('GET', `/api/leases/${tenant.lease_id}`)).json()).lease;
  assert.equal(l2.arrears, l1.arrears, 'arrears are not double-reduced');
});

await test('receipts are generated only for completed payments and only for their owner', async () => {
  const R = 20000;
  const { landlord, prop, unit, tenant } = await acctScenario({
    landlordEmail: 'rec.l@test.ke',
    tenantEmail: 'rec.t@test.ke',
    rent: R,
    unitNo: 'H1',
    start: '2026-01-05',
    end: '2027-01-05',
  });
  const rec = await (await landlord.request('POST', '/api/payments/record', { tenant_id: tenant.tenant_id, amount: R, method: 'bank' })).json();
  const db = new DatabaseSync(process.env.DB_PATH);
  db.prepare(
    `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, provider_ref, phone)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'mpesa', 'mpesa', 'processing', ?, '0712345678')`
  ).run(tenant.tenant_id, prop.id, unit.id, tenant.lease_id, R, '2026-03-01', 'REC-PENDING');

  const mine = session();
  await mine.request('POST', '/api/auth/login', { email: 'rec.t@test.ke', password: 'Tenant@123' });
  const r1 = await mine.request('GET', `/api/payments/${rec.payment_id}/receipt`);
  assert.equal(r1.status, 200);
  const body = await r1.json();
  assert.equal(body.receipt.status, 'completed');
  assert.ok(body.receipt.receipt_number.startsWith('SR-'), 'the receipt carries a serial number');
  assert.equal(body.receipt.landlord.full_name, 'Acct Owner', 'the receipt shows landlord details');
  assert.equal(body.receipt.property.id, prop.id, 'the receipt references the right property');

  const stranger = session();
  await register(stranger, { role: 'tenant', full_name: 'Stranger', email: 'rec.x@test.ke' });
  assert.equal((await stranger.request('GET', `/api/payments/${rec.payment_id}/receipt`)).status, 403, 'an unrelated tenant cannot read the receipt');

  const pending = dbGet("SELECT id FROM payments WHERE provider_ref = 'REC-PENDING'");
  assert.equal((await mine.request('GET', `/api/payments/${pending.id}/receipt`)).status, 400, 'no receipt while the payment is still processing');
});

await test('maintenance: tenants raise requests, owners update them, outsiders are blocked', async () => {
  const { landlord, prop, unit, tenant } = await acctScenario({
    landlordEmail: 'maint.l@test.ke',
    tenantEmail: 'maint.t@test.ke',
    rent: 15000,
    unitNo: 'I1',
    start: '2026-01-05',
    end: '2027-01-05',
  });
  const perp = session();
  await register(perp, { role: 'tenant', full_name: 'No Lease T', email: 'maint.none@test.ke' });
  assert.equal(
    (await perp.request('POST', '/api/maintenance', { title: 'Burst pipe', description: 'Water is leaking into the living room', property_id: prop.id })).status,
    400,
    'a tenant without an active lease cannot raise a request'
  );

  const t = session();
  await t.request('POST', '/api/auth/login', { email: 'maint.t@test.ke', password: 'Tenant@123' });
  const created = await t.request('POST', '/api/maintenance', {
    title: 'Leaking roof',
    description: 'Water is dripping through the ceiling',
    category: 'Plumbing',
    priority: 'urgent',
    property_id: prop.id,
  });
  assert.equal(created.status, 201);
  const mid = (await created.json()).request.id;

  const other = session();
  await register(other, { role: 'landlord', full_name: 'Maint Other', email: 'maint.l2@test.ke' });
  await other.request('POST', '/api/properties', { name: 'Other Court', county: 'Nairobi', property_type: 'Apartment' });
  assert.equal((await other.request('GET', `/api/maintenance/${mid}`)).status, 404, 'other landlords cannot view the request');
  assert.equal((await other.request('PATCH', `/api/maintenance/${mid}`, { status: 'in_progress' })).status, 403, 'other landlords cannot update it');
  assert.equal((await t.request('PATCH', `/api/maintenance/${mid}`, { status: 'in_progress' })).status, 403, 'tenants cannot change statuses');

  const upd = await landlord.request('PATCH', `/api/maintenance/${mid}`, { status: 'in_progress', actual_cost: 4500 });
  assert.equal(upd.status, 200);
  assert.equal((await upd.json()).request.status, 'in_progress');
  assert.equal((await landlord.request('PATCH', `/api/maintenance/${mid}`, { status: 'assigned' })).status, 400, 'the workflow cannot move backwards');

  const ns = await (await t.request('GET', '/api/notifications?limit=20')).json();
  assert.ok(ns.notifications.some((n) => n.title === 'Maintenance in progress'), 'the tenant is notified of progress');
  const list = await (await landlord.request('GET', `/api/maintenance?property_id=${prop.id}`)).json();
  assert.equal(list.stats.open, 1);
});

await test('expenses are audited on create, update and delete', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Audit L', email: 'au.l@test.ke' });
  const prop = (await (await landlord.request('POST', '/api/properties', { name: 'Audit Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const created = await landlord.request('POST', '/api/expenses', { property_id: prop.id, description: 'Audited expense', amount: 800, expense_date: '2026-09-05' });
  assert.equal(created.status, 201);
  const id = (await created.json()).expense.id;
  const sid = String(id);
  assert.equal(dbGet("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'expense.created' AND entity = 'expense' AND entity_id = ?", [sid]).c, 1);
  await landlord.request('PATCH', `/api/expenses/${id}`, { amount: 900 });
  assert.equal(dbGet("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'expense.updated' AND entity = 'expense' AND entity_id = ?", [sid]).c, 1);
  await landlord.request('DELETE', `/api/expenses/${id}`);
  assert.equal(dbGet("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'expense.deleted' AND entity = 'expense' AND entity_id = ?", [sid]).c, 1);
});

await test('caretaker assignment can be revoked, cutting off all property access', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Care L', email: 'care.l@test.ke' });
  const pa = (await (await landlord.request('POST', '/api/properties', { name: 'Care A', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const assign = await landlord.request('POST', `/api/properties/${pa.id}/caretakers`, {
    full_name: 'Care W',
    email: 'care.w@test.ke',
    phone: '0715511111',
    password: 'Caretaker@123',
  });
  assert.equal(assign.status, 201);
  const caretakerId = (await assign.json()).caretaker.id;
  const c = session();
  await c.request('POST', '/api/auth/login', { email: 'care.w@test.ke', password: 'Caretaker@123' });
  assert.equal((await c.request('GET', `/api/expenses?property_id=${pa.id}`)).status, 200, 'an assigned caretaker has scope');

  const other = session();
  await register(other, { role: 'landlord', full_name: 'Care Other', email: 'care.l2@test.ke' });
  await other.request('POST', '/api/properties', { name: 'Care B', county: 'Nairobi', property_type: 'Apartment' });
  assert.equal((await other.request('DELETE', `/api/properties/${pa.id}/caretakers/${caretakerId}`)).status, 403, 'only the property owner can revoke');

  assert.equal((await landlord.request('DELETE', `/api/properties/${pa.id}/caretakers/${caretakerId}`)).status, 200);
  assert.equal(dbGet('SELECT COUNT(*) AS c FROM property_caretakers WHERE property_id = ? AND caretaker_id = ?', [pa.id, caretakerId]).c, 0);
  assert.equal(dbGet("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'caretaker.removed' AND entity = 'property' AND entity_id = ?", [String(pa.id)]).c, 1);
  assert.equal((await c.request('GET', `/api/expenses?property_id=${pa.id}`)).status, 403, 'a revoked caretaker loses scope');
  assert.equal(
    (await c.request('POST', '/api/maintenance', { title: 'Sneaky request', description: 'Should be rejected for the caretaker', property_id: pa.id })).status,
    403,
    'a revoked caretaker cannot act on the property'
  );
});

await test('application rejection notifies the applicant and tenants cannot decide applications', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'App2 Landlord', email: 'ap2.l@test.ke' });
  const prop = (await (await landlord.request('POST', '/api/properties', { name: 'App2 Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const actor = session();
  await register(actor, { role: 'tenant', full_name: 'App2 Tenant', email: 'ap2.t@test.ke' });
  const apply = await actor.request('POST', `/api/market/properties/${prop.id}/apply`, {
    full_name: 'App2 Tenant',
    email: 'ap2.t@test.ke',
    phone: '0709444999',
    move_in_date: '2026-11-01',
  });
  assert.equal(apply.status, 201);
  const appId = (await apply.json()).applicationId;
  assert.equal((await actor.request('PATCH', `/api/applications/${appId}`, { status: 'under_review' })).status, 403, 'tenants cannot decide applications');
  const rejected = await landlord.request('PATCH', `/api/applications/${appId}`, { status: 'rejected', reviewer_notes: 'No vacancy' });
  assert.equal(rejected.status, 200);
  assert.equal(dbGet('SELECT status FROM applications WHERE id = ?', [appId]).status, 'rejected');
  const ns = await (await actor.request('GET', '/api/notifications?limit=20')).json();
  assert.ok(ns.notifications.some((n) => n.title === 'Application rejected'), 'the applicant is notified of the rejection');
});

await test('admin routes are admin-only and settings updates persist', async () => {
  const bcryptMod = (await import('bcryptjs')).default;
  const db = new DatabaseSync(process.env.DB_PATH);
  db.prepare("INSERT INTO users (role, full_name, email, phone, password_hash, status) VALUES ('admin', 'WF Admin', 'wf.admin@test.ke', '0710000000', ?, 'active')").run(
    await bcryptMod.hash('Admin@123', 10)
  );
  const admin = session();
  const login = await admin.request('POST', '/api/auth/login', { email: 'wf.admin@test.ke', password: 'Admin@123' });
  assert.equal(login.status, 200);
  assert.equal((await login.json()).user.role, 'admin');

  const outsider = session();
  await register(outsider, { role: 'tenant', full_name: 'Admin Outsider', email: 'ao.t@test.ke' });
  assert.equal((await outsider.request('GET', '/api/admin/users')).status, 403, 'tenants cannot list users');
  assert.equal((await outsider.request('PUT', '/api/admin/settings', { currency: 'USD' })).status, 403, 'tenants cannot change settings');
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Admin L', email: 'ao.l@test.ke' });
  assert.equal((await landlord.request('GET', '/api/admin/audit-logs')).status, 403, 'landlords cannot read audit logs');

  const users = await (await admin.request('GET', '/api/admin/users?role=tenant')).json();
  assert.ok(users.users.some((u) => u.email === 'ao.t@test.ke'), 'admins see tenant accounts');

  const put = await admin.request('PUT', '/api/admin/settings', { currency: 'USD' });
  assert.equal(put.status, 200);
  assert.ok((await put.json()).updated.includes('currency'));
  const settings = await (await admin.request('GET', '/api/admin/settings')).json();
  assert.equal(settings.settings.currency, 'USD', 'the updated setting persists');

  const create = await admin.request('POST', '/api/admin/users', {
    full_name: 'Admin-created caretaker',
    email: 'ao.caretaker@test.ke',
    phone: '0715550000',
    password: 'Caretaker@123',
    role: 'caretaker',
  });
  assert.equal(create.status, 201);
  const c2 = session();
  assert.equal((await c2.request('POST', '/api/auth/login', { email: 'ao.caretaker@test.ke', password: 'Caretaker@123' })).status, 200, 'an admin-created caretaker can log in');
});

await test('CSV exports respect role scope and never leak across landlords', async () => {
  const l1 = session();
  await register(l1, { role: 'landlord', full_name: 'CSV L1', email: 'csv1.l@test.ke' });
  const p1 = (await (await l1.request('POST', '/api/properties', { name: 'CSV One Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const u1 = (await (await l1.request('POST', '/api/units', { property_id: p1.id, unit_number: 'C1', unit_type: '1 Bedroom', rent: 9000 })).json()).unit;
  const t1 = await (await l1.request('POST', '/api/tenants', {
    full_name: 'CSV T1',
    email: 'csv1.t@test.ke',
    phone: '0709111111',
    unit_id: u1.id,
    start_date: '2026-01-05',
    end_date: '2027-01-05',
  })).json();
  await l1.request('POST', '/api/payments/record', { tenant_id: t1.tenant_id, amount: 9000, method: 'cash' });

  const l2 = session();
  await register(l2, { role: 'landlord', full_name: 'CSV L2', email: 'csv2.l@test.ke' });
  const p2 = (await (await l2.request('POST', '/api/properties', { name: 'CSV Two Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const u2 = (await (await l2.request('POST', '/api/units', { property_id: p2.id, unit_number: 'C2', unit_type: '1 Bedroom', rent: 11000 })).json()).unit;
  const t2 = await (await l2.request('POST', '/api/tenants', {
    full_name: 'CSV T2',
    email: 'csv2.t@test.ke',
    phone: '0709222222',
    unit_id: u2.id,
    start_date: '2026-01-05',
    end_date: '2027-01-05',
  })).json();
  await l2.request('POST', '/api/payments/record', { tenant_id: t2.tenant_id, amount: 11000, method: 'cash' });

  const csv1 = await (await l1.request('GET', '/api/reports/export?type=payments')).text();
  assert.ok(csv1.includes('CSV T1'), 'an export includes the owner data');
  assert.ok(!csv1.includes('CSV T2'), 'an export never includes another landlord tenant');
  const csv2 = await (await l2.request('GET', '/api/reports/export?type=payments')).text();
  assert.ok(csv2.includes('CSV T2'));
  assert.ok(!csv2.includes('CSV T1'), 'the isolation is reciprocal');

  await l1.request('POST', '/api/expenses', { property_id: p1.id, description: 'CSV expense leak check', amount: 123, expense_date: '2026-09-05' });
  const expCsv = await (await l1.request('GET', '/api/reports/export?type=expenses')).text();
  assert.ok(expCsv.includes('CSV expense leak check'));
  const expCsv2 = await (await l2.request('GET', '/api/reports/export?type=expenses')).text();
  assert.ok(!expCsv2.includes('CSV expense leak check'), 'expense exports are isolated too');

  const assign = await l1.request('POST', `/api/properties/${p1.id}/caretakers`, {
    full_name: 'CSV Caretaker',
    email: 'csv.caretaker@test.ke',
    phone: '0715333333',
    password: 'Caretaker@123',
  });
  assert.equal(assign.status, 201);
  const c = session();
  await c.request('POST', '/api/auth/login', { email: 'csv.caretaker@test.ke', password: 'Caretaker@123' });
  const caretakerCsv = await (await c.request('GET', '/api/reports/export?type=payments')).text();
  assert.ok(caretakerCsv.includes('CSV T1'));
  assert.ok(!caretakerCsv.includes('CSV T2'), 'caretaker exports are scoped to assigned properties');

  assert.equal((await l1.request('GET', '/api/reports/export?type=bogus')).status, 400, 'an unknown report type is rejected');
  const tenant = session();
  await register(tenant, { role: 'tenant', full_name: 'CSV Outsider', email: 'csv.t@test.ke' });
  assert.equal((await tenant.request('GET', '/api/reports/export?type=payments')).status, 403, 'tenants cannot export reports');
});

await test('messages notify the recipient, stay one-way private, and self-mail is blocked', async () => {
  const { landlord, prop, unit, tenant } = await acctScenario({
    landlordEmail: 'msg.l@test.ke',
    tenantEmail: 'msg.t@test.ke',
    rent: 10000,
    unitNo: 'J1',
    start: '2026-01-05',
    end: '2027-01-05',
  });
  const t = session();
  await t.request('POST', '/api/auth/login', { email: 'msg.t@test.ke', password: 'Tenant@123' });
  const tenantId = dbGet('SELECT id FROM users WHERE email = ?', ['msg.t@test.ke']).id;
  const landlordId = dbGet('SELECT landlord_id FROM properties WHERE id = ?', [prop.id]).landlord_id;

  const self = await t.request('POST', '/api/messages', { recipient_id: tenantId, subject: 'To myself', body: 'This should fail' });
  assert.equal(self.status, 400, 'self-messaging is blocked');

  const send = await t.request('POST', '/api/messages', { recipient_id: landlordId, subject: 'Rent question', body: 'Please confirm the due date' });
  assert.equal(send.status, 201);
  const mid = (await send.json()).id;

  const ns = await (await landlord.request('GET', '/api/notifications?limit=20')).json();
  assert.ok(ns.notifications.some((n) => n.title === 'New message from Acct Tenant'), 'the recipient is notified');

  const inbox = await (await landlord.request('GET', '/api/messages')).json();
  assert.ok(inbox.messages.some((m) => m.id === mid && m.is_read === 0));
  const read = await (await landlord.request('GET', `/api/messages/${mid}`)).json();
  assert.equal(read.message.is_read, 1, 'opening the message marks it read');

  const spy = session();
  await register(spy, { role: 'landlord', full_name: 'Msg Spy', email: 'msg.spy@test.ke' });
  assert.equal((await spy.request('GET', `/api/messages/${mid}`)).status, 403, 'a third party cannot read the message');
});

await test('tenants with multiple active leases can view them all; M-Pesa initiates against the newest', async () => {
  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'ML Landlord', email: 'ml.l@test.ke' });
  const prop = (await (await landlord.request('POST', '/api/properties', { name: 'ML Court', county: 'Nairobi', property_type: 'Apartment' })).json()).property;
  const u1 = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: 'M1', unit_type: 'Studio', rent: 9000 })).json()).unit;
  const u2 = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: 'M2', unit_type: 'Studio', rent: 12000 })).json()).unit;
  const t = session();
  await register(t, { role: 'tenant', full_name: 'ML Tenant', email: 'ml.t@test.ke' });
  const base = {
    property_id: prop.id,
    tenant_name: 'ML Tenant',
    tenant_email: 'ml.t@test.ke',
    tenant_phone: '0711111111',
    start_date: '2026-01-05',
    end_date: '2027-01-05',
  };
  assert.equal((await landlord.request('POST', '/api/leases', { ...base, unit_id: u1.id })).status, 201);
  assert.equal((await landlord.request('POST', '/api/leases', { ...base, unit_id: u2.id })).status, 201);

  await t.request('POST', '/api/auth/login', { email: 'ml.t@test.ke', password: 'Secret123' });
  const leases = await (await t.request('GET', '/api/leases')).json();
  assert.equal(leases.leases.length, 2, 'the tenant lists every active lease');
  assert.ok(leases.leases.every((l) => l.status === 'active'));

  const initiate = await t.request('POST', '/api/payments/initiate', { amount: 5000, phone: '0711111111' });
  assert.equal(initiate.status, 201);
  const row = dbGet('SELECT unit_id FROM payments WHERE id = ?', [(await initiate.json()).payment_id]);
  assert.equal(row.unit_id, u2.id, 'M-Pesa initiation targets the most recent active lease');
});

await test('uploads require auth, reject spoofed types, and use unguessable filenames', async () => {
  const anon = await fetch(`${base}/api/uploads`, { method: 'POST' });
  assert.equal(anon.status, 401, 'an unauthenticated upload is rejected');

  const landlord = session();
  await register(landlord, { role: 'landlord', full_name: 'Upload L', email: 'up.l@test.ke' });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const send = (buf, name) => {
    const form = new FormData();
    form.append('files', new Blob([buf], { type: 'image/png' }), name);
    return fetch(`${base}/api/uploads`, { method: 'POST', headers: { cookie: landlord.cookie() }, body: form });
  };
  const ok = await send(png, 'photo.png');
  assert.equal(ok.status, 201);
  const files = (await ok.json()).files;
  assert.equal(files.length, 1);
  assert.match(files[0], /^\/uploads\/\d+-[0-9a-f]{8}\.png$/, 'the filename is a timestamp plus random hex');
  const ok2 = await send(png, 'photo2.png');
  const second = (await ok2.json()).files[0];
  assert.notEqual(second, files[0], 'each upload gets a unique, unguessable filename');

  const bad = await send(Buffer.from('not really a png despite the claim'), 'evil.png');
  assert.equal(bad.status, 400, 'content that does not match the declared type is rejected');
});

await test('utility bills: per-unit issue, tenant scoping, payment lock and validation', async () => {
  const period = ymOff(0);
  const { landlord, prop, unit, tenant } = await acctScenario({
    landlordEmail: 'ub1.l@test.ke',
    tenantEmail: 'ub1.t@test.ke',
    rent: 10000,
    start: '2026-01-05',
    end: '2027-01-05',
    unitNo: 'UB1',
  });
  const other = session();
  await register(other, { role: 'landlord', full_name: 'Other L', email: 'ub.other@test.ke' });

  assert.equal((await fetch(`${base}/api/utility-bills`)).status, 401, 'bills listing requires auth');

  const created = await landlord.request('POST', '/api/utility-bills', {
    property_id: prop.id,
    unit_id: unit.id,
    category: 'Water',
    period,
    amount: 750,
  });
  assert.equal(created.status, 201);
  const bill = (await created.json()).bill;
  assert.equal(bill.tenant_id, tenant.tenant_id, 'bill is assigned to the unit active tenant');
  assert.equal(bill.status, 'unpaid');

  assert.equal(
    (await landlord.request('POST', '/api/utility-bills', { property_id: prop.id, unit_id: unit.id, category: 'Water', period, amount: 800 })).status,
    409,
    'duplicate unit + period + category is rejected'
  );
  assert.equal(
    (await landlord.request('POST', '/api/utility-bills', { property_id: prop.id, unit_id: unit.id, category: 'Water', period: '2026-13', amount: 100 })).status,
    400,
    'invalid period is rejected'
  );
  assert.equal(
    (await landlord.request('POST', '/api/utility-bills', { property_id: prop.id, unit_id: unit.id, category: 'Water', period: ymOff(1), amount: 0 })).status,
    400,
    'non-positive amount is rejected'
  );
  assert.equal(
    (await landlord.request('POST', '/api/utility-bills', { property_id: prop.id, unit_id: unit.id, category: 'Plasma', period: ymOff(1), amount: 100 })).status,
    400,
    'unknown category is rejected'
  );

  const vacant = (await (await landlord.request('POST', '/api/units', { property_id: prop.id, unit_number: 'UB2', unit_type: 'Studio', rent: 9000 })).json()).unit;
  assert.equal(
    (await landlord.request('POST', '/api/utility-bills', { property_id: prop.id, unit_id: vacant.id, category: 'Water', period, amount: 100 })).status,
    400,
    'a vacant unit cannot be billed'
  );

  assert.equal(
    (await other.request('POST', '/api/utility-bills', { property_id: prop.id, unit_id: unit.id, category: 'Water', period: ymOff(2), amount: 100 })).status,
    403,
    'a non-owning landlord cannot issue bills'
  );
  assert.equal((await other.request('GET', `/api/utility-bills/${bill.id}`)).status, 403, 'a non-owning landlord cannot read the bill');

  const tenantS = session();
  assert.equal((await tenantS.request('POST', '/api/auth/login', { email: 'ub1.t@test.ke', password: 'Tenant@123' })).status, 200);
  const list = await (await tenantS.request('GET', '/api/utility-bills')).json();
  assert.equal(list.bills.length, 1, 'tenant sees exactly their own bill');
  assert.equal(list.bills[0].id, bill.id);
  assert.equal(list.stats.unpaid, 750);

  assert.equal(
    (await tenantS.request('POST', '/api/utility-bills', { property_id: prop.id, unit_id: unit.id, category: 'Water', period: ymOff(3), amount: 100 })).status,
    403,
    'tenant cannot issue bills'
  );
  assert.equal((await tenantS.request('POST', `/api/utility-bills/${bill.id}/pay`, { method: 'cash' })).status, 403, 'tenant cannot settle a bill');

  assert.equal((await landlord.request('POST', `/api/utility-bills/${bill.id}/pay`, { method: 'mpesa', reference: 'MPE123' })).status, 200);
  assert.equal((await landlord.request('POST', `/api/utility-bills/${bill.id}/pay`, {})).status, 400, 'a bill cannot be paid twice');
  assert.equal((await landlord.request('PATCH', `/api/utility-bills/${bill.id}`, { amount: 1 })).status, 400, 'paid bills cannot be edited');
  assert.equal((await landlord.request('DELETE', `/api/utility-bills/${bill.id}`)).status, 400, 'paid bills cannot be deleted');

  const after = await (await tenantS.request('GET', '/api/utility-bills')).json();
  assert.equal(after.stats.unpaid, 0);
  assert.equal(after.stats.paid, 750);

  const created2 = await landlord.request('POST', '/api/utility-bills', { property_id: prop.id, unit_id: unit.id, category: 'Electricity', period, amount: 1200 });
  assert.equal(created2.status, 201);
  const bill2 = (await created2.json()).bill;
  const patched = await landlord.request('PATCH', `/api/utility-bills/${bill2.id}`, { amount: 1300 });
  assert.equal(patched.status, 200);
  assert.equal((await patched.json()).bill.amount, 1300, 'unpaid bills are editable');
  assert.equal((await landlord.request('DELETE', `/api/utility-bills/${bill2.id}`)).status, 200, 'unpaid bills can be deleted');
});

await test('utility bills: caretaker only manages assigned properties', async () => {
  const period = ymOff(0);
  const { landlord, prop, unit } = await acctScenario({
    landlordEmail: 'ub2.l@test.ke',
    tenantEmail: 'ub2.t@test.ke',
    rent: 9000,
    start: '2026-01-05',
    end: '2027-01-05',
    unitNo: 'UB1',
  });
  const prop2 = (await (await landlord.request('POST', '/api/properties', { name: 'UB Unassigned', county: 'Nairobi', property_type: 'Apartment' })).json()).property;

  const assigned = await landlord.request('POST', `/api/properties/${prop.id}/caretakers`, {
    full_name: 'UB Caretaker',
    email: 'ub.care@test.ke',
    phone: '0722333444',
    password: 'Caretaker@123',
  });
  assert.equal(assigned.status, 201);

  await landlord.request('POST', '/api/utility-bills', { property_id: prop.id, unit_id: unit.id, category: 'Water', period, amount: 500 });

  const care = session();
  assert.equal((await care.request('POST', '/api/auth/login', { email: 'ub.care@test.ke', password: 'Caretaker@123' })).status, 200);
  const list = await (await care.request('GET', '/api/utility-bills')).json();
  assert.equal(list.bills.length, 1, 'caretaker sees assigned property bills');
  assert.equal(list.bills[0].property_id, prop.id);

  assert.equal(
    (await care.request('POST', '/api/utility-bills', { property_id: prop2.id, unit_id: unit.id, category: 'Water', period: ymOff(3), amount: 100 })).status,
    403,
    'caretaker cannot bill an unassigned property'
  );
});

server.close();
await new Promise((resolve) => server.on('close', resolve));try {
  fs.rmSync(tmpDir, { recursive: true, force: true });
} catch {
  /* Windows may briefly keep the SQLite file locked */
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
process.exit(0);
