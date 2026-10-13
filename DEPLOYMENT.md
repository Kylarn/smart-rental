# Smart Rentals — Deployment Guide

This document describes how to deploy Smart Rentals to a staging or production server.
It covers what the app actually does today (verified against the code in this repository),
the environment it requires, hardening that is enforced at startup, and operational
procedures for the database, uploads, backups and M-Pesa.

> Scope note: live M-Pesa STK Push requires real Safaricom Daraja credentials and a public
> HTTPS callback URL. Without them, STK Push is disabled in production (manual payments only).
> See [M-Pesa](#m-pesa) below.

---

## 1. Architecture

| Layer | Technology |
| --- | --- |
| Backend | Node.js (ESM), Express 4, `node:sqlite` (built-in SQLite) |
| Auth | JWT in an HTTP-only cookie (`sr_token`, SameSite=Lax) |
| Frontend | React 18 + Vite 6, built to static assets |
| Storage | SQLite file `data.db` (WAL mode) + local `uploads/` directory |
| Payments | M-Pesa Daraja STK Push (sandbox/mock/configurable) |

**Single-process deployment.** The Express server serves both the JSON API (under `/api`)
and the built React SPA (from `client/dist`) with an SPA fallback, so refreshing a deep link
such as `/app/payments` returns `index.html` and the client router takes over. In development
the Vite dev server (port 5173) proxies `/api` and `/uploads` to the API (port 4000).

```
public HTTPS  ->  reverse proxy (TLS)  ->  node server/src/index.js (PORT, default 4000)
                                             |-- /api/*      JSON API
                                             |-- /uploads/*  uploaded files
                                             |-- everything else -> client/dist/index.html
                                             +-- data.db (SQLite, WAL)
```

### Repository layout

```
package.json            npm workspaces root (server, client); build/start/test scripts
server/src/index.js     process entry: boots app, payment recovery, scheduler
server/src/app.js       Express app: CORS, JSON, cookies, static, routes, SPA fallback
server/src/config.js    env loading + startup safety validation
server/src/db/index.js  schema + idempotent migrations (openDb)
server/src/db/seed.js   Riesta register seed (staging/dev only)
server/scripts/import-riesta.mjs   idempotent Riesta import (never deletes)
server/src/db/bootstrap.js  removes DB files to start fresh
server/tests/api.test.js    60 API/migration/isolation tests
server/tests/smoke.mjs      end-to-end staging smoke (API + SPA + restart) 
server/tests/backup.restore.mjs  backup/restore verification on a disposable DB
server/scripts/backup.js    verified SQLite backup script
deploy/                     STAGING.md runbook + systemd / nginx / Docker samples
deploy/BROWSER-ACCEPTANCE.md  manual desktop+mobile browser checklist
deploy/PRODUCTION-DATA.md   production Riesta register import + account activation runbook
client/                 React app (Vite)
```

### Runtime requirements

- **Node.js ≥ 22.5** (SQLite is provided by the built-in `node:sqlite` module; verified on Node 24.x).
- No external database or cache service is required.
- A process manager (systemd, PM2, Docker, etc.) and a TLS-terminating reverse proxy (nginx, Caddy, Traefik).

---

## 2. Configuration

Copy `.env.example` to `.env` at the repository root. The server loads `<root>/.env` on startup.
Environment variables can also be provided by the host/process manager.

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` on a real server. Enables safety checks and production error messages. |
| `PORT` | no | API/SPA port (default `4000`). |
| `CLIENT_ORIGIN` | recommended | Comma-separated allowed browser origins for CORS. In production only these are allowed. A same-origin SPA needs none. |
| `JWT_SECRET` | **yes (prod)** | ≥ 32 random characters. Startup refuses the dev default / short values in production. |
| `COOKIE_SECURE` | **yes (prod)** | Must be `1` in production (secure, HTTPS-only cookies). `0` only for local HTTP. |
| `DB_PATH` | no | SQLite file path. Default `<root>/data.db`. |
| `UPLOADS_DIR` | no | Upload directory. Default `<root>/uploads`. |
| `BACKUP_DIR` | no | Backup output directory. Default `<root>/backups`. |
| `MPESA_ENV` | for M-Pesa | `sandbox` or `production`. Required to be `production` for live payments. |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL` | for M-Pesa | Daraja credentials. Callback URL must be public HTTPS in production and should be kept unguessable. |
| `MPESA_CALLBACK_AMOUNT_TOLERANCE` | no | Allowed absolute difference (KES) between the callback amount and the expected amount (default `1`). |
| `SMS_ENABLED` | no | `0` disables all outbound SMS. Default `1`. |
| `SMS_PROVIDER` | for SMS | `mock` (default, logs only — no real texts), `http` (real gateway) or `disabled`. |
| `SMS_SENDER_ID` | for SMS | Alphanumeric sender ID / short code shown to recipients. |
| `SMS_API_URL`, `SMS_API_KEY` | for `http` provider | Gateway endpoint (POST JSON) and API key. Required for the `http` provider to be `ready`. |
| `SMS_MAX_ATTEMPTS` | no | Retry ceiling for failed sends (default `3`). |
| `SMS_WEBHOOK_SECRET` | for the SMS webhook | Shared secret for the HMAC-SHA256 signature on `POST /api/sms/webhook`. Without it the webhook rejects every callback (fails closed). |
| `SMS_WEBHOOK_TOLERANCE_SECONDS` | no | Max age/clock skew accepted for a signed webhook timestamp (default `300`). |
| `PUBLIC_BASE_URL` | recommended | Public URL used to build tenant activation links, e.g. `https://app.example.com`. Falls back to `CLIENT_ORIGIN` or `http://localhost:5173`. |
| `ACTIVATION_TTL_HOURS` | no | Lifetime of a tenant activation link in hours (default `48`). |
| `RATE_LIMIT_*` | no | Optional overrides for rate limits (see below). |

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Startup safety checks (enforced)

The process **refuses to start in production** if:

- `JWT_SECRET` is missing, shorter than 32 characters, or still the development default.
- `COOKIE_SECURE` is not `1`.
- M-Pesa credentials are present but `MPESA_ENV` is not `production`.
- M-Pesa is in production mode but `MPESA_CALLBACK_URL` is missing or not `https://`.
- SMS is enabled with the `http` provider but `SMS_API_URL`/`SMS_API_KEY` are missing.

If M-Pesa is not configured at all, the server starts with a warning and STK Push is disabled
(manual/recorded payments still work). It will never silently fall back to mock mode in production.

If SMS is left at the default `mock` provider, messages are logged and marked **simulated** — no real
texts are sent. Switch `SMS_PROVIDER=http` and supply gateway credentials to deliver real messages.

---

## 3. Install, build and run

```bash
# 1. Install dependencies (root installs both workspaces)
npm install

# 2. Configure
cp .env.example .env
#   then edit .env (at minimum NODE_ENV, JWT_SECRET, COOKIE_SECURE in production)

# 3. Build the frontend (required so the server can serve the SPA)
npm run build

# 4. Start
npm start            # runs: node server/src/index.js
```

Development (hot reload, Vite proxy):

```bash
npm run dev          # server (4000) + client (5173) together
```

### First-time database

The schema is created automatically and **idempotently** the first time the server opens the
database. Migrations run on every boot and bring older databases up to the current schema
without dropping data (verified against an old-schema fixture and a copy of the real DB).

- **Staging:** `npm run seed` loads the Riesta Apartments register (real records only; no demo
  tenants). Use `npm run import:riesta` to add/refresh those records idempotently without deleting.
- **Production:** start with an empty database. The app creates the schema on first boot.
  There is no self-service admin signup (registration only creates landlord/tenant), so the
  first administrator must be created once, either by:
  - running `npm run seed` (set `SEED_ADMIN_PASSWORD` to a strong value) and removing the
    placeholder owner, or
  - inserting an admin row directly into `users` (bcrypt password hash).

  Creating the production admin is a **pre-launch step that must be performed deliberately**.
  In production the seed **never** uses the demo password: it uses `SEED_ADMIN_PASSWORD` if set,
  otherwise it generates a random password and prints it once. On boot the server warns if an
  active admin still has the default demo password.

Account created by `npm run seed` in **staging/development only** (never ship this to production):

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@smartrentals.co.ke` | `Admin@123` (demo) |

> Riesta's owner is a **suspended placeholder** (`owner.pending@riesta.local`, unusable password)
> until the real owner details are supplied. No tenant logins exist because no contacts are known.

### Reverse proxy / TLS

Terminate TLS at the proxy and forward to the Node process. The app trusts the proxy
(`trust proxy` is enabled) so secure cookies and client IPs work correctly behind it.

- Route all traffic (API + SPA) to the Node port.
- Do **not** strip the `Set-Cookie` header.
- Make `MPESA_CALLBACK_URL` point at the public HTTPS URL of `/api/payments/mpesa/callback`.

---

## 4. Persistence, migrations & restart

- **Persistence:** all state lives in `data.db` (plus `data.db-wal` / `data.db-shm`) and
  `uploads/`. These paths **must be on durable storage** (bind mount / volume) and persist
  across restarts and redeploys. Never mount them on ephemeral container storage.
- **Restart safety:** the server is stateless apart from these files. On boot it reopens the
  database, replays/checkpoints the WAL, re-runs idempotent migrations, recovers stuck payments
  and starts the notification scheduler. Verified by the smoke test (register → restart → login).
- **Migrations:** additive and idempotent; row counts and password hashes are preserved.
  Confirmed by tests against an old-schema fixture and a copy of the real `data.db`.

---

## 5. Backups & restore

Create a verified, timestamped backup:

```bash
npm run db:backup
# -> backups/<timestamp>/data.db (+ -wal/-shm)
#    validates with PRAGMA integrity_check and prints per-table row counts
```

The script checkpoints the WAL when possible, copies `data.db` and its `-wal`/`-shm` files,
reopens the copy, runs `PRAGMA integrity_check` and reports row counts. Point `BACKUP_DIR`
at off-host storage and schedule it (e.g. cron) — SQLite file copies are cheap.

**Restore procedure:**

1. Stop the server (so no writer is active).
2. Back up the current files as a precaution.
3. Replace `data.db`, `data.db-wal`, `data.db-shm` with the backup copies (copy all three
   if present; remove stale `-wal`/`-shm` that don't belong to the restored `data.db`).
4. Restore the matching `uploads/` directory if needed.
5. Start the server and confirm with `GET /api/health` and a login.

---

## 6. Security hardening (implemented)

- **Auth cookies:** HTTP-only, SameSite=Lax, `Secure` in production, `Path=/`; logout clears
  the cookie with the same attributes so it is actually removed over HTTPS.
- **Startup guard:** refuses unsafe production configuration (see §2).
- **CORS:** in production only the origins listed in `CLIENT_ORIGIN` are allowed; localhost
  origins are permitted only outside production.
- **Rate limiting:** in-memory limits on login, registration, payment initiation, uploads and
  the M-Pesa callback. Returns `429` with `Retry-After`. Override with `RATE_LIMIT_*` env vars.
  (In-memory: for multi-instance deployments use a shared store or a proxy-level limiter.)
- **Uploads:** only JPEG/PNG/WEBP/GIF/PDF; MIME type **and** file extension are checked, and
  file contents are validated against magic-byte signatures, so spoofed content is rejected.
  SVG uploads are no longer accepted (XSS risk). Served from `/uploads` with
  `X-Content-Type-Options: nosniff` and a restrictive `Content-Security-Policy`.
- **Error handling:** internal errors return a generic JSON message in production; stack traces
  and database paths are never sent to clients.
- **Health endpoint:** `GET /api/health` returns `{ok, service, time}` only — no configuration.

### Routed / legacy URLs

- Canonical app routes live under `/app/*` (`/app/payments`, `/app/leases`, `/app/reports`, …).
- Direct navigation and refreshes to `/app/*` are served by the SPA fallback.
- Legacy notification links (`/tenant/*`, `/landlord/*`, `/caretaker/*`) are redirected
  client-side to their `/app/*` equivalents, so old links and refreshes resolve correctly.
- Unknown API paths return a clean JSON `404` (never the SPA HTML).

---

## 7. M-Pesa

Payments use Daraja STK Push. Behaviour depends on configuration:

| State | Behaviour |
| --- | --- |
| No credentials, `NODE_ENV != production` | **Mock mode**: simulated STK push; a payment is auto-completed (or failed for amounts ending in `13`). |
| No credentials, `NODE_ENV == production` | STK Push **disabled** and returns an error; mock mode is never used. |
| Credentials set, `MPESA_ENV=production`, HTTPS callback | **Live** STK Push. |

Callback handling at `POST /api/payments/mpesa/callback`:

- Public endpoint (no auth), rate-limited, **idempotent** (repeated callbacks do not double-complete).
- **Callbacks are never trusted on their own.** Daraja does not cryptographically sign STK Push
  callbacks, so the callback is only a trigger: the server correlates `CheckoutRequestID` +
  `MerchantRequestID` with a server-created pending payment, checks the amount, and then confirms
  the real transaction status **server-to-server** with the Daraja STK Push Query API (signed with
  our own OAuth token + passkey). Only a provider-confirmed success completes a payment.
- Fail closed: unknown references, merchant-reference mismatches, amount mismatches, or a callback
  whose status cannot be verified by the provider leave the payment unchanged (and unverified
  failures do not mutate state). A callback for an already-final payment is ignored.
- Stuck payments are recovered on startup and by the scheduler.

### SMS delivery-status webhook

`POST /api/sms/webhook` requires an HMAC-SHA256 signature (`X-SMS-Signature: sha256=<hex>`) keyed by
`SMS_WEBHOOK_SECRET` over the raw request body (or `<X-SMS-Timestamp>.<body>` when a timestamp is
sent). Unsigned/invalid/stale requests are rejected with `401`. The generic HTTP gateway provides no
vendor signature, so this shared-secret contract is the supported mechanism; if the gateway cannot
produce it, the webhook must be left disabled (it fails closed). Only messages already in our DB
(via `provider_message_id`) can be updated, and `delivered`/`failed` are terminal.

### Sandbox testing status

A real Daraja **sandbox round-trip could not be executed** because no Safaricom credentials were
provided (`MPESA_*` are blank). The callback/STK logic is covered by automated tests
(production guard, mock mode, callback idempotency/matching, and callback verification with a
provider double). To validate against real Safaricom:

1. Set `MPESA_ENV=sandbox` and the sandbox key/secret/shortcode/passkey and a public HTTPS callback.
2. Initiate a tenant payment, confirm the callback arrives and that the server-to-server STK Push
   Query returns `ResultCode 0` before the payment flips to `completed`.
3. Only after success, switch to production credentials with `MPESA_ENV=production`.
4. Restrict/allow the callback URL to Safaricom's IP ranges at the proxy, and keep the URL secret.

---

## 8. Verification performed

- `npm run test:api` — **60/60 pass** (RBAC/isolation, caretaker scope, move-out settlement,
  migration from old schema and from a copy of the real DB, production config guard, rate
  limiting, M-Pesa mock/production guard, upload signature validation).
- `npm run test:smoke` — **19/19 pass** against a disposable seeded DB: health, SPA fallback,
  legacy link resolution, every `/app/*` route served as HTML on refresh, JSON 404 for unknown
  API, auth cookie flags, admin/landlord/caretaker/tenant workflows, scoping, `nosniff` on
  uploads, no 500s, and **data survives a restart**.
- `npm run test:backup` — **5/5 pass** on a disposable DB: backup passes integrity check, row
  counts match the source, restore is consistent, and the restored DB boots and authenticates.
- `npm run build` — client builds; main bundle ~197 kB (was ~789 kB single chunk); page code is
  split per route and the chart library loads only with Reports.
- `npm run db:backup` — ran against the real `data.db`: backup created, `integrity_check: ok`,
  row counts reported.

**Manual checks still recommended before go-live** (not automatable here): real-browser pass on
desktop and mobile (visual layout, console errors) using `deploy/BROWSER-ACCEPTANCE.md`, and a
governed M-Pesa sandbox round-trip (§7). No hosting provider access or credentials were available
at the time of writing, so a staging deployment was **not executed** — see `deploy/STAGING.md`
for the complete runbook to run it.

---

## 9. Go-live checklist

- [ ] `NODE_ENV=production`, `JWT_SECRET` (≥32 chars), `COOKIE_SECURE=1` set on the server.
- [ ] Production database created; first admin created deliberately.
- [ ] `CLIENT_ORIGIN` set to the real domain(s); DNS and TLS configured.
- [ ] `npm run build` run; server started under a process manager that restarts on failure.
- [ ] `DB_PATH` and `UPLOADS_DIR` on durable, backed-up storage.
- [ ] Scheduled `npm run db:backup` writing to off-host storage; restore drill done once.
- [ ] Reverse proxy forwards all routes to the Node port and preserves `Set-Cookie`.
- [ ] M-Pesa: either intentionally disabled (manual payments) or configured with production
      credentials + HTTPS callback and IP allow-listing.
- [ ] Confirm `GET /api/health` from outside, then log in as each role.

## 10. Rollback

1. Stop the server.
2. Restore the previous code revision.
3. Restore `data.db` (+ `-wal`/`-shm`) and `uploads/` from the latest verified backup if the
   schema changed incompatibly (migrations are additive, so a code-only rollback usually needs
   no restore).
4. Start the server and verify `GET /api/health` and a login.
