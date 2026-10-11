# Smart Rentals

Rental property management platform for Kenya. Landlords and caretakers manage buildings, units and leases; tenants pay rent via M-Pesa STK Push, raise maintenance requests and track their lease; admins oversee the platform.

## Roles & what each can do

| Role | Capabilities |
|---|---|
| **Admin** | Manage users (landlord/tenant/caretaker), platform settings, audit log, platform-wide reports |
| **Landlord** | Publish properties, add units, create/manage leases and tenants, assign & remove caretakers, approve rental applications, view payments/arrears/reports (CSV export), post announcements, manage expenses for their own portfolio |
| **Caretaker** | Works only on assigned properties: manage tenants/units, accept & assign rental applications (creating the lease), record rent/expenses, handle maintenance, post announcements |
| **Tenant** | Browse & apply to listed properties, view own lease & arrears, pay rent (M-Pesa), raise maintenance, message landlord, see announcements |

The link between a tenant and a building is a **lease**. A tenant applies to a listed property (or is added directly by the landlord/caretaker), and once a unit is assigned a lease is created — that lease scopes everything the tenant sees.

## Tech stack

- **Frontend:** React 18, Vite 6, react-router, Recharts, lucide-react (`client/`)
- **Backend:** Node.js + Express, cookie-based sessions, bcryptjs, multer (`server/`)
- **Database:** SQLite via the built-in `node:sqlite` (requires **Node.js 22+**)
- **Payments:** M-Pesa Daraja STK Push (sandbox + production; mock/dummy mode in development)
- **Workspace:** npm workspaces (root orchestrates `server` + `client`)

## Repository layout

```
server/src/            Express API: routes, middleware, services (payments, rent, notify, scheduler)
server/src/db/         schema (bootstrap.js), seed.js, db access
server/tests/          api.test.js (53), smoke.mjs (19), backup.restore.mjs (5) suites
client/src/            React SPA (pages, components, lib)
deploy/                Dockerfile, compose, nginx, systemd unit, staging & verification docs
```

## Quick start (development)

Prerequisites: Node.js **22+** and npm.

```bash
npm install            # install all workspaces
npm run dev            # server (node --watch) + client (Vite) together
```

- API: `http://localhost:4000` (see `.env`, copy from `.env.example` — defaults apply without changes locally)
- SPA: `http://localhost:5173`

### Seed demo data

Resets the database at `DB_PATH` (default `<repo root>/data.db`) with demo accounts, 6 properties, 50 units, 1 tenant lease, maintenance, applications, notifications and settings:

```bash
npm run seed
```

**Demo accounts**

| Role | Email | Password |
|---|---|---|
| Admin | `admin@smartrentals.co.ke` | `Admin@123` |
| Landlord | `james@landlord.co.ke` | `Landlord@123` |
| Caretaker | `caretaker@smartrentals.co.ke` | `Caretaker@123` |
| Tenant | `peter.otieno@tenant.co.ke` | `Tenant@123` |

James owns all 6 seeded properties (Nairobi, Mombasa, Nakuru, Kisumu); the caretaker manages all of them; Peter rents at Kilimani Heights.

> `npm run seed` **deletes** whatever database is at `DB_PATH`. Keep a real database in a separate location from the disposable demo one.

## Configuration (`.env`)

See `.env.example` for every variable. Key ones:

- `PORT`, `DB_PATH`, `UPLOADS_DIR`, `BACKUP_DIR` — runtime locations; change `DB_PATH` to keep the real data db separate from staging/seed.
- `JWT_SECRET` — required in production (min 32 chars).
- `COOKIE_SECURE=1` — required in production for HTTPS cookies.
- **M-Pesa:** `MPESA_ENV=sandbox` (or `production`), plus `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL` (public HTTPS). In development, leaving the credentials blank enables a mock/money-free mode; in production mock mode is refused.

## Tests

All suites run against disposable databases and never touch your real data db.

```bash
npm run test:api      # 53 API/regression tests (auth, leases, M-Pesa, receipts, maintenance,
                      # expenses, caretaker scoping, applications, admin, CSV, messages, uploads)
npm run test:smoke    # 19 e2e smoke checks against the running server (logins, SPA routes, isolation)
npm run test:backup   # backup/restore round-trip + integrity
npm run build         # client production build (Vite)
```

## Documentation

- `DEPLOYMENT.md` — production deployment (Node/Docker/service, env, nginx, backups)
- `deploy/STAGING.md` — running the local staging instance and demo logins
- `deploy/WORKFLOW-VERIFICATION.md` — workflow-by-workflow verification results, defects fixed, known blockers
- `deploy/BROWSER-ACCEPTANCE.md` — manual browser sign-off checklist
- `docs/ROLE-GUIDE.md` — how the system works per role with the exact flows

## Security notes

- `.env`, all `*.db` files, `uploads/`, `backups/`, and build output are git-ignored and never committed.
- All county dropdowns use the official **47 Kenyan counties** (single source in `client/src/lib/counties.js`).
- Rate limiting on auth/payment/upload endpoints, HttpOnly/SameSite cookies, per-role authorization on every route.