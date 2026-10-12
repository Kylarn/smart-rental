# Smart Rentals — End-to-End Workflow Verification Report

- **Date:** 2026-10-10
- **Scope:** End-to-end verification of the 13 user workflows before deployment.
- **Method:** HTTP-level automated regression, staging smoke, backup/restore, and a client
  production build, run against **disposable test databases and synthetic accounts only**.
  The real `data.db` was **not touched** (no seeding, resetting, or overwriting).
- **Status:** Strong automated workflow coverage. Browser acceptance, a live Daraja
  round-trip, and deployment to a real host are **still outstanding** — see
  [Not tested / outstanding blockers](#not-tested--outstanding-blockers).

---

## Executive summary

Smart Rentals has comprehensive automated coverage of its business workflows at the HTTP
layer: **all 60 API regression tests, 19 staging smoke checks, and 5 backup/restore checks
pass**, and the client production build succeeds (2,233 modules). The verification added 13
new regression tests for previously unverified workflow areas (logout, M-Pesa STK initiation,
duplicate callbacks, receipts, maintenance authorization, expense auditing, caretaker
revocation, application rejection, admin route guards, CSV export isolation, messaging,
multi-lease behavior, and upload isolation).

One defect was found and fixed during verification (a message detail response returned a
stale `is_read` value). All reported results were produced with disposable databases and
synthetic accounts.

**This does not mean the system is production-ready.** Browser-level acceptance (layout,
console/network errors, desktop + mobile), a real M-Pesa sandbox transaction over a public
HTTPS callback, and a deployment on an external host have not been performed.

---

## Automated test results

| Suite | Result |
|---|---|
| API regression (`server/tests/api.test.js`) | **53/53 passed** (40 existing + 13 new) |
| Staging smoke (`server/tests/smoke.mjs`) | **19/19 passed** |
| Backup/restore (`server/tests/backup.restore.mjs`) | **5/5 passed** |
| Client production build (`vite build`) | **passed** — 2,233 modules transformed |
| Staging server health | **passed** — `GET /api/health` returns `ok` on `:4000` |
| Homepage check | **passed** — `GET /` returns HTTP 200 with `id="root"` |

All suites ran in a sandboxed environment against fresh temporary databases seeded with
synthetic accounts. The real `data.db` was left untouched.

---

## Detailed workflow verification

Legend: **PASS (automated)** = covered and passing via the automated suites listed above.

### 1. Onboarding & account setup — PASS (automated)
- Register landlord/tenant, login, session cookie (HttpOnly, SameSite=Lax), session
  persistence across a server restart, profile/avatar update, login rate limiting (429
  after repeated attempts), and duplicate-email rejection (409).
- **New:** logout clears the session and the logged-out cookie no longer unlocks protected
  routes.

### 2. Authentication & role-based access — PASS (automated)
- Unauthenticated requests to protected routes return 401.
- Tenants are forbidden from landlord reports and from `/api/admin/*`; landlords are
  forbidden from `/api/admin/*` and matching-only users are forbidden from reading other
  roles' data; tenant IDs cannot be enumerated (IDOR fixed).
- **New:** admin-only guards on `GET /api/admin/users`, `PUT /api/admin/settings`, and
  `GET /api/admin/audit-logs`; settings updates persist.

### 3. Rent collection — PASS (automated)
- Manual payment recording (amount/method validation, recorded-date preservation, receipt
  numbers, tenant + landlord notifications).
- **New:** M-Pesa STK initiation (`POST /api/payments/initiate`) creates a `processing`
  payment with a checkout request id; a successful callback completes it with a receipt and
  removes one month from arrears. Invalid phone numbers (400) and tenants with no active
  lease (400) are rejected.

### 4. Callback processing — PASS (automated)
- Unknown callbacks acknowledged; success callbacks for failed payments ignored; mismatched
  amounts fail the payment.
- **New:** a duplicate success callback is idempotent — the payment stays completed with the
  same receipt, no extra ledger rows are created, and arrears are not double-reduced.

### 5. Financial accuracy, arrears & receipts — PASS (automated)
- Timezone-safe arrears math, exact one-month coverage, overpayment auto-allocation forward,
  underpayment cannot clear months, and terminated leases stop accruing at their end date.
- **New:** receipts are generated only for completed payments and only for their owner; an
  unrelated tenant is blocked (403) and a receipt for a `processing` payment is refused (400).

### 6. Maintenance lifecycle — PASS (automated)
- Tenants raise requests (blocked without an active lease); owners view and update them with
  tenant notification; the workflow cannot move backwards; tenants cannot change statuses;
  other landlords are blocked (GET 404 / PATCH 403); cross-property unit/tenant binding is
  rejected.

### 7. Caretaker management — PASS (automated)
- Caretaker creation/assignment, dashboard and reports scoping, scoped announcements,
  applications, and maintenance.
- **New:** revocation (`DELETE /api/properties/:id/caretakers/:caretakerId`) removes scope —
  the caretaker loses property access (expenses 403, maintenance POST 403), only the owning
  landlord can revoke, and the removal is audit-logged.

### 8. Move-outs — PASS (automated)
- Initiate and complete move-outs, keys-required enforcement, duplicate-completion blocking,
  outstanding rent recomputed from the live ledger and persisted, and deposit/meter/keys/notes
  settlement values preserved.

### 9. Applications — PASS (automated)
- An assigned application cannot be reverted; tenants cannot decide applications (403).
- **New:** rejection notifies the applicant and persists the `rejected` status.

### 10. Leases & multi-lease — PASS (automated)
- Lease creation validations (non-tenant emails, invalid rent/frequency), termination guards
  (future dates, blocked while a move-out is in progress), unit released on termination.
- **New / documented assumption:** a tenant with multiple active leases can list them all,
  but M-Pesa-initiated payments target the **most recent active lease** (see
  [Assumptions](#assumption-m-pesa-multi-lease-behavior)).

### 11. Reports, dashboards & exports — PASS (automated)
- Overview, tenant lists, and caretaker reports never mix landlords; activity/audit filters
  work; caretaker dashboards are scoped.
- **New:** CSV exports (`payments`, `expenses`) are scoped per landlord and per caretaker,
  with reciprocal cross-landlord isolation verified; unknown report types return 400 and
  tenants cannot export (403).

### 12. Communications — PASS (automated)
- Notifications (read-all, mark-read, dedupe) and announcements (property-wide and targeted,
  correctly scoped to active tenants).
- **New:** messages notify the recipient, are private to the two parties (third-party read
  blocked 403), self-messaging is blocked (400), and opening a message marks it read — the
  response now reflects `is_read = 1` after the fix (see below).

### 13. Data isolation & uploads — PASS (automated)
- IDOR fixed (a tenant cannot read another tenant), cross-landlord property/expense/report
  isolation, files served with `nosniff`, and MIME-spoofed uploads rejected.
- **New:** uploads require authentication (401 anonymous), filenames are timestamp + random
  hex (unguessable, unique per upload), and content that does not match the declared type is
  rejected.

### Assumption: M-Pesa multi-lease behavior
Note: `POST /api/payments/initiate` resolves the tenant's lease via
`activeLeaseOfTenant` which returns the **newest** active lease (`ORDER BY created_at DESC
LIMIT 1`). Initiation therefore targets the **most recent active lease**. This is the
documented single-current-lease behavior; listing endpoints still show all active leases.

---

## Defects found and fixed

- **Stale `is_read` in message detail response.** `GET /api/messages/:id` marked a message
  as read in the database but returned the pre-update row, so the response reported
  `is_read = 0` immediately after opening the message.
  - **Fix:** `server/src/routes/communications.js` — after running the
    `UPDATE messages SET is_read = 1`, the returned object is now updated
    (`m.is_read = 1`) so the response reflects the new state.
  - **Verification:** covered by the new messaging regression test
    ("messages notify the recipient, stay one-way private, and self-mail is blocked").

No defects resulted in data loss. No application behavior was changed beyond this fix as
part of the documentation task.

---

## Not tested / outstanding blockers

These are deliberately **not** claimed as completed:

- **Browser/visual acceptance (desktop ≥1280px and mobile ~390px)** — no browser
  automation/tooling was available. Run the manual checklist in
  [`deploy/BROWSER-ACCEPTANCE.md`](./BROWSER-ACCEPTANCE.md) against a real HTTPS staging URL,
  watching DevTools Console and Network for errors.
- **M-Pesa sandbox end-to-end transaction** — requires Daraja credentials
  (`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`) and a
  public **HTTPS** `MPESA_CALLBACK_URL`. The API is verified in mock mode and the callback/
  STK logic is covered by automated tests, but a real Daraja round-trip has not been run.
- **External deployment/hosting** — no cloud/hosting credentials or CLIs available; staging
  runs locally on `:4000` only.
- **Off-host scheduled backups** — backup/restore is verified locally (5/5), but a scheduled,
  off-host backup pipeline has not been configured or tested.
- **Production configuration & security review** — `deploy/STAGING.md`,
  `deploy/nginx.conf.example`, `deploy/Dockerfile`, `deploy/docker-compose.yml`, and
  `deploy/smart-rentals.service` exist but a final review against a real production
  environment is outstanding.

---

## Production-readiness assessment

| Dimension | Status |
|---|---|
| Automated workflow coverage (API + smoke + backup + build) | **Strong — all green** |
| Financial accuracy / data isolation | **Automated coverage; passes** |
| Browser acceptance (layout, console, network, desktop + mobile) | **NOT TESTED** |
| Live payment integration (Daraja sandbox over HTTPS callback) | **NOT TESTED** |
| External deployment / real hosting | **NOT TESTED** |
| Off-host scheduled backups + recovery | **NOT TESTED** |
| Production config / security review | **NOT TESTED** |

**Conclusion:** Smart Rentals has strong automated end-to-end workflow coverage and passes
all local suites. It is **not yet fully production-ready**: manual browser acceptance,
a real M-Pesa sandbox transaction, external deployment, off-host backup recovery, and a
final production configuration/security review remain outstanding.

---

## Next steps

1. **Complete desktop and mobile browser acceptance** using
   [`deploy/BROWSER-ACCEPTANCE.md`](./BROWSER-ACCEPTANCE.md) against a live HTTPS staging URL;
   fix any console/network errors or layout issues found.
2. **Test the M-Pesa sandbox end-to-end** with real Daraja credentials and a public HTTPS
   `MPESA_CALLBACK_URL`; confirm STK push receipt, callback confirmation, receipts, and
   failure paths in the live sandbox.
3. **Deploy to a staging host** and verify the actual environment (HTTPS, static assets,
   SPA fallback, environment variables, Node process/service management).
4. **Configure off-host scheduled backups** (database + uploads) and test a real recovery/
   restore drill.
5. **Perform a final production configuration and security review** (secrets, cookie flags,
   rate limits, CORS, headers, upload limits, MPESA_ENV=production guard).