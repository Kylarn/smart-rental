# Smart Rentals

Rental property management platform for Kenya. Landlords and caretakers manage buildings, units and leases; tenants pay rent via M-Pesa STK Push, raise maintenance requests and track their lease; admins oversee the platform.

## Roles & what each can do

| Role | Capabilities |
|---|---|
| **Admin** | Manage users (landlord/tenant/caretaker), platform settings, audit log, platform-wide reports |
| **Landlord** | Publish properties, add units, create/manage leases and tenants, assign & remove caretakers, approve rental applications, view payments/arrears/reports (CSV export), post announcements, manage expenses and issue/reconcile utility bills for their own portfolio |
| **Caretaker** | Works only on assigned properties: manage tenants/units, accept & assign rental applications (creating the lease), record rent/expenses, issue utility bills, handle maintenance, post announcements |
| **Tenant** | Browse & apply to listed properties, view own lease & arrears, pay rent (M-Pesa), view utility bills, raise maintenance, message landlord, see announcements |

The link between a tenant and a building is a **lease**. A tenant applies to a listed property (or is added directly by the landlord/caretaker), and once a unit is assigned a lease is created — that lease scopes everything the tenant sees.

## Tech stack

- **Frontend:** React 18, Vite 6, react-router, Recharts, lucide-react (`client/`)
- **Backend:** Node.js + Express, cookie-based sessions, bcryptjs, multer (`server/`)
- **Database:** SQLite via the built-in `node:sqlite` (requires **Node.js 22.5+**)
- **Payments:** M-Pesa Daraja STK Push (sandbox + production; mock/dummy mode in development)
- **Workspace:** npm workspaces (root orchestrates `server` + `client`)

## Repository layout

```
server/src/            Express API: routes, middleware, services (payments, rent, notify, scheduler)
server/src/db/         schema (index.js), Riesta seed + importer (riesta.js), db access
server/tests/          api.test.js (60), smoke.mjs (19), backup.restore.mjs (5) suites
client/src/            React SPA (pages, components, lib)
server/scripts/        backup.js, import-riesta.mjs
deploy/                Dockerfile, compose, nginx, systemd unit, staging, production-data & verification docs
```

## Quick start (development)

Prerequisites: Node.js **22.5+** and npm.

```bash
npm install            # install all workspaces
npm run dev            # server (node --watch) + client (Vite) together
```

- API: `http://localhost:4000` (see `.env`, copy from `.env.example` — defaults apply without changes locally)
- SPA: `http://localhost:5173`

### Seed / import real data

The seed now loads the **Riesta Apartments** register (real records only — no demo tenants):

- 1 archived property (Riesta Apartments), 85 rooms
- Rooms 1–13 from the paper register (room 1 = caretaker accommodation)
- A separate **deposit ledger** (12 deposits) that is never counted as rental income
- **Historical rent register** entries (35 rows), kept unverified with their original dates
- Rooms 14–85 created with unknown occupancy; all units imported with `details_verified = 0`

```bash
# Rebuild the database at DB_PATH from scratch (deletes the existing file)
DB_PATH=/path/to/data.db npm run seed

# Add/refresh the Riesta records without deleting anything (idempotent)
DB_PATH=/path/to/data.db npm run import:riesta

# Turn the 12 register tenants (rooms 2-13) into active logins + leases (idempotent)
DB_PATH=/path/to/data.db npm run activate:tenants

# Make the Riesta placeholder owner a login-capable landlord so the register shows
# on the landlord Tenants/Properties/Leases pages (idempotent)
DB_PATH=/path/to/data.db npm run activate:landlord

# Create a caretaker login and assign it to Riesta so the caretaker pages work (idempotent)
DB_PATH=/path/to/data.db npm run activate:caretaker
```

Unverified tenancies live in `rental_register` (not in `leases`), so the rent engine never
computes arrears or sends rent SMS for them. The owner is held by a **suspended placeholder**
landlord account until real owner details are supplied.

`npm run activate:tenants` creates an active tenant account for each register tenant in
rooms 2-13 (room 1 stays caretaker accommodation). Because no contacts are known it uses a
placeholder `room<N>@riesta.local` email and prints a random one-time password per new account
to hand out; the tenant then completes their own details (phone, county, ID) under **Profile**.
Each gets an active lease on their room (deposit from the register, rent left at `0` until the
landlord sets it). It is safe to re-run: existing accounts are left untouched. Options:
`--start YYYY-MM-DD` (default `2026-01-01`), `--end YYYY-MM-DD` (default `2026-12-31`),
`--domain riesta.local`, `--rent <amount>`.

`npm run activate:landlord` flips the Riesta placeholder owner to an active landlord and sets a
password (generated and printed unless `--password` is given; `--email`, `--name`, `--phone`
override the placeholder details). Signed in as that landlord, the 12 tenants and the property
appear on the Properties, Tenants and Leases pages.

`npm run activate:caretaker` creates (or reactivates) a caretaker — default `Sebastian Mshai`
(Room 1's caretaker), email `caretaker@riesta.local`, generated password printed once — and
assigns it to Riesta, so the caretaker Tenants/Units/Payments pages are scoped to the property.
Override with `--name`, `--email`, `--phone`, `--password`.

**Accounts (staging/development only)**

| Role | Email | Password |
|---|---|---|
| Admin | `admin@smartrentals.co.ke` | `Admin@123` |

> The `Admin@123` default applies to **staging/development only**. A fresh seed with
> `NODE_ENV=production` never uses it: set `SEED_ADMIN_PASSWORD`, or the seed generates a random
> password and prints it once. Startup warns if an active admin still has the demo password.
>
> `npm run seed` **deletes** whatever database is at `DB_PATH`. Take a backup first
> (`npm run db:backup`). `npm run import:riesta` is safe to run any time.

## Configuration (`.env`)

See `.env.example` for every variable. Key ones:

- `PORT`, `DB_PATH`, `UPLOADS_DIR`, `BACKUP_DIR` — runtime locations; change `DB_PATH` to keep the real data db separate from staging/seed.
- `JWT_SECRET` — required in production (min 32 chars).
- `COOKIE_SECURE=1` — required in production for HTTPS cookies.
- **M-Pesa:** `MPESA_ENV=sandbox` (or `production`), plus `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL` (public HTTPS). In development, leaving the credentials blank enables a mock/money-free mode; in production mock mode is refused. Daraja does not sign STK callbacks, so `POST /api/payments/mpesa/callback` never completes a payment from the callback body alone — it correlates to a server-created payment and confirms status server-to-server via the STK Push Query API. Keep the callback URL unguessable.
- **SMS:** `SMS_PROVIDER=mock` (default; logs only, marked simulated), `http` (real gateway — also set `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER_ID`), or `disabled`. Set `SMS_WEBHOOK_SECRET` to enable the signed delivery-status webhook (`POST /api/sms/webhook`); without it the endpoint rejects every callback. `SMS_ENABLED=0` turns texts off entirely. Set `PUBLIC_BASE_URL` so tenant activation links are absolute; `ACTIVATION_TTL_HOURS` controls their lifetime (default 48).

## Tests

All suites run against disposable databases and never touch your real data db.

```bash
npm run test:api      # 60 API/regression tests (auth, leases, M-Pesa, receipts, maintenance,
                      # expenses, utility bills, caretaker scoping, applications, public
                      # applications, tenant activation, SMS, admin, CSV, messages, uploads)
npm run test:smoke    # 19 e2e smoke checks against the running server (logins, SPA routes, isolation)
npm run test:backup   # backup/restore round-trip + integrity
npm run build         # client production build (Vite)
```

## Documentation

- `DEPLOYMENT.md` — production deployment (Node/Docker/service, env, nginx, backups)
- `deploy/STAGING.md` — running the local staging instance and admin login
- `deploy/WORKFLOW-VERIFICATION.md` — workflow-by-workflow verification results, defects fixed, known blockers
- `deploy/BROWSER-ACCEPTANCE.md` — manual browser sign-off checklist
- `deploy/PRODUCTION-DATA.md` — production Riesta register import + owner/caretaker/tenant account activation
- `docs/ROLE-GUIDE.md` — how the system works per role with the exact flows

## Security notes

- `.env`, all `*.db` files, `uploads/`, `backups/`, and build output are git-ignored and never committed.
- All county dropdowns use the official **47 Kenyan counties** (single source in `client/src/lib/counties.js`).
- Rate limiting on auth/payment/upload endpoints, HttpOnly/SameSite cookies, per-role authorization on every route.