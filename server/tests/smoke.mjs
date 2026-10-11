import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smart-rentals-smoke-'));
const dbPath = path.join(tmp, 'smoke.db');
const uploadsDir = path.join(tmp, 'uploads');
const port = 4099 + Math.floor(Math.random() * 500);
const base = `http://127.0.0.1:${port}`;

const env = {
  ...process.env,
  NODE_ENV: 'staging',
  PORT: String(port),
  DB_PATH: dbPath,
  UPLOADS_DIR: uploadsDir,
  JWT_SECRET: `smoke-${'x'.repeat(48)}`,
  CLIENT_ORIGIN: base,
  COOKIE_SECURE: '0',
};

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed += 1;
    failures.push(name);
    console.error(`  \u2717 ${name}\n      ${err.message}`);
  }
}

function session() {
  let cookie = '';
  return {
    cookie: () => cookie,
    capture: (res) => {
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
    },
    async request(method, url, body, extraHeaders = {}) {
      const headers = { ...extraHeaders };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cookie) headers.cookie = cookie;
      const res = await fetch(`${base}${url}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      this.capture(res);
      return res;
    },
    async login(email, password) {
      const res = await this.request('POST', '/api/auth/login', { email, password });
      assert.equal(res.status, 200, `login failed for ${email} (${res.status})`);
      this.capture(res);
      return res;
    },
  };
}

function startServer() {
  const child = spawn(process.execPath, [path.join(root, 'server', 'src', 'index.js')], {
    env,
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`      [server] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`      [server:err] ${d}`));
  return child;
}

async function waitHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('server did not become healthy in time');
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once('exit', resolve);
    child.kill();
    setTimeout(() => resolve(), 4000);
  });
}

console.log('Smart Rentals staging smoke test\n');

fs.mkdirSync(uploadsDir, { recursive: true });
const seeded = spawnSync(process.execPath, [path.join(root, 'server', 'src', 'db', 'seed.js')], {
  env,
  cwd: root,
  stdio: 'ignore',
});
if (seeded.status !== 0) {
  console.error('Failed to seed disposable database; aborting.');
  process.exit(1);
}

let server = startServer();
try {
  await waitHealth();

  await check('health endpoint is public and reports ok', async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  await check('homepage is the rental-management landing page (not the marketplace)', async () => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get('content-type') || '').includes('text/html'), 'root serves the SPA');

    const assetsDir = path.join(root, 'client', 'dist', 'assets');
    const bundle = fs
      .readdirSync(assetsDir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
      .join('\n');

    assert.ok(bundle.includes('Manage your rental property with ease'), 'new hero headline is bundled');
    assert.ok(bundle.includes('Buildings & unit management'), 'buildings feature section is bundled');
    assert.ok(bundle.includes('Tenants & lease management'), 'tenants feature section is bundled');
    assert.ok(bundle.includes('M-Pesa'), 'M-Pesa rent messaging is bundled');
    assert.ok(bundle.includes('Get Started'), 'primary CTA is bundled');
    assert.ok(bundle.includes('Sign In'), 'sign-in nav is bundled');
    assert.ok(!bundle.includes('Find your next home in Kenya'), 'old marketplace hero is gone');
  });

  await check('SPA deep link /app/payments is served as HTML (refresh works)', async () => {
    const res = await fetch(`${base}/app/payments`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get('content-type') || '').includes('text/html'));
  });

  await check('legacy /tenant/payments deep link resolves (client redirect)', async () => {
    const res = await fetch(`${base}/tenant/payments`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get('content-type') || '').includes('text/html'));
  });

  await check('every SPA route is served as HTML on refresh', async () => {
    const routes = [
      '/app', '/app/properties', '/app/properties/1', '/app/units', '/app/tenants',
      '/app/tenants/1', '/app/leases', '/app/lease', '/app/applications', '/app/payments',
      '/app/maintenance', '/app/moveouts', '/app/messages', '/app/announcements',
      '/app/notifications', '/app/reports', '/app/profile', '/app/admin/users',
      '/app/admin/audit', '/app/admin/settings',
      '/login', '/register', '/property/1',
    ];
    for (const route of routes) {
      const res = await fetch(`${base}${route}`);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      assert.ok((res.headers.get('content-type') || '').includes('text/html'), `${route} is not HTML`);
    }
  });

  await check('legacy landlord and caretaker links resolve to the SPA', async () => {
    for (const route of ['/landlord/payments', '/landlord/leases', '/landlord/reports', '/caretaker/reports', '/caretaker/announcements', '/tenant/lease', '/tenant/messages']) {
      const res = await fetch(`${base}${route}`);
      assert.equal(res.status, 200, `${route} returned ${res.status}`);
      assert.ok((res.headers.get('content-type') || '').includes('text/html'), `${route} is not HTML`);
    }
  });

  await check('unknown SPA path falls back to HTML (client-side 404, not server 404)', async () => {
    const res = await fetch(`${base}/app/this-page-does-not-exist`);
    assert.equal(res.status, 200);
    assert.ok((res.headers.get('content-type') || '').includes('text/html'));
  });

  await check('unknown API route returns JSON 404', async () => {
    const res = await fetch(`${base}/api/does-not-exist`);
    assert.equal(res.status, 404);
    assert.ok((res.headers.get('content-type') || '').includes('application/json'));
  });

  await check('protected route rejects unauthenticated request (401)', async () => {
    const res = await fetch(`${base}/api/payments`);
    assert.equal(res.status, 401);
  });

  await check('auth cookie is HttpOnly and SameSite=Lax', async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'james@landlord.co.ke', password: 'Landlord@123' }),
    });
    const sc = res.headers.get('set-cookie') || '';
    assert.ok(sc.includes('HttpOnly'), 'HttpOnly flag present');
    assert.ok(/SameSite=Lax/i.test(sc), 'SameSite=Lax present');
  });

  await check('admin can list users', async () => {
    const s = session();
    await s.login('admin@smartrentals.co.ke', 'Admin@123');
    const me = await s.request('GET', '/api/auth/me');
    assert.equal((await me.json()).user.role, 'admin');
    const res = await s.request('GET', '/api/admin/users');
    assert.equal(res.status, 200);
  });

  await check('landlord can list own properties', async () => {
    const s = session();
    await s.login('james@landlord.co.ke', 'Landlord@123');
    const res = await s.request('GET', '/api/properties');
    assert.equal(res.status, 200);
    assert.ok((await res.json()).properties.length >= 1);
  });

  await check('caretaker dashboard is scoped and returns byProperty', async () => {
    const s = session();
    await s.login('caretaker@smartrentals.co.ke', 'Caretaker@123');
    const res = await s.request('GET', '/api/dashboard');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.role, 'caretaker');
    assert.ok(body.stats && Array.isArray(body.byProperty));
  });

  await check('tenant sees only own payments', async () => {
    const s = session();
    await s.login('peter.otieno@tenant.co.ke', 'Tenant@123');
    const me = await s.request('GET', '/api/auth/me');
    const uid = (await me.json()).user.id;
    const res = await s.request('GET', '/api/payments');
    const body = await res.json();
    assert.ok(body.payments.every((p) => p.tenant_id === uid), 'no other tenants payments leaked');
  });

  await check('tenant is forbidden from landlord reports (403)', async () => {
    const s = session();
    await s.login('peter.otieno@tenant.co.ke', 'Tenant@123');
    const res = await s.request('GET', '/api/reports/overview');
    assert.equal(res.status, 403);
  });

  await check('uploaded files are served with nosniff', async () => {
    fs.writeFileSync(path.join(uploadsDir, 'smoke.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
    const res = await fetch(`${base}/uploads/smoke.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  await check('no unexpected 500 responses across workflows', async () => {
    const s = session();
    await s.login('caretaker@smartrentals.co.ke', 'Caretaker@123');
    for (const url of ['/api/dashboard', '/api/properties', '/api/tenants', '/api/maintenance', '/api/reports/overview', '/api/reports/caretakers']) {
      const res = await s.request('GET', url);
      assert.notEqual(res.status, 500, `${url} returned 500`);
    }
  });

  const newEmail = `staging.persist.${Date.now()}@test.ke`;
  await check('registering a new landlord persists', async () => {
    const s = session();
    const res = await s.request('POST', '/api/auth/register', {
      role: 'landlord',
      full_name: 'Staging Persist',
      email: newEmail,
      phone: '0722999888',
      password: 'Secret123',
    });
    assert.equal(res.status, 201);
  });

  await stopServer(server);
  server = startServer();
  await waitHealth();

  await check('data survives a server restart (login after restart)', async () => {
    const s = session();
    await s.login(newEmail, 'Secret123');
    const me = await s.request('GET', '/api/auth/me');
    assert.equal((await me.json()).user.email, newEmail);
  });
} finally {
  await stopServer(server);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* Windows may hold SQLite handles briefly */
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.error(`failed checks: ${failures.join(', ')}`);
  process.exit(1);
}
