# How Smart Rentals works — role guide

This guide explains the real flows behind each role, with the API routes that implement them.

## Core concept: the lease is the connection

Accounts are just logins. What makes a tenant "yours" is a **lease** row linking `tenant_id → unit_id → property_id`. Until a lease exists for a tenant, they have nothing on their dashboard.

Two paths to create that link:

1. **Tenant self-serves:** anyone (no account needed) can apply to a listed property (`POST /api/market/properties/:id/apply`) and gets a reference like `APP-000123`; they can poll `GET /api/market/applications/status?reference=&email=`. Logged-in tenants can also register (`POST /api/auth/register`, role `tenant`) → browse listings → apply → landlord/caretaker approves and assigns a unit → lease created.
2. **Landlord/caretaker adds:** they create a lease directly for a user. For a brand-new applicant with no password, the system creates the tenant user and issues a **single-use activation link** (see below) — never a temporary password.

## Role flows

### Tenant

- Register or log in (`POST /api/auth/login`).
- Browse/search/filter listed properties by county, type, price, bedrooms (`GET /api/market/properties`); view a property + its vacant units; contact the landlord; request a viewing.
- Apply to a property (one active application per property at a time).
- After assignment: see the lease (`/tenant/lease`), pay rent through M-Pesa (`POST /api/payments/initiate` → STK push → callback completes it), view receipts and payment history.
- View utility bills issued for their unit (`GET /api/utility-bills` — returns only their own) at `/app/my-bills`; settle by paying the landlord/caretaker, who records it.
- Raise maintenance requests and track their status.
- Message the landlord; receive announcements and notifications.
- **Activate a landlord-created account:** open the SMS link at `/activate?token=…` (`GET/POST /api/auth/activation`, resend at `POST /api/auth/activation/resend`), set a password, and sign in.
- **Manage SMS preferences:** opt out/in of automated texts from Profile (`POST /api/sms/opt-out`).
- Move-out keeps their payment/tenancy history.

### Landlord

- Publish properties with units, pricing, amenities, images (`POST /api/properties`, `POST /api/properties/:id/units`).
- Manage tenants and leases; terminate leases; run move-outs (settlement = deposit refund, meters, keys, notes).
- Review rental applications (`PATCH /api/applications/:id`) and **assign units → new leases**.
- **Assign/remove caretakers per property** (`POST/DELETE /api/properties/:id/caretakers`). A caretaker user can be created on the spot (name, email, phone + password) or an existing caretaker account linked. Caretaker access = union of their `property_caretakers` rows.
- View payments, arrears, occupancy, dashboards and CSV reports — always scoped to their own portfolio.
- Record/audit expenses, post announcements, message tenants.
- **Utility bills:** issue a bill per occupied unit + month + category (`Water`, `Electricity`, `Garbage`, `Internet`, `Other`) via `POST /api/utility-bills` (the tenant is resolved from the unit's active lease), edit while unpaid, record settlement (`POST /api/utility-bills/:id/pay` with method `cash|mpesa|bank|other` + reference), and delete unpaid bills. The tenant is notified on issue and on payment. Paid bills are locked from edits/deletes.

### Caretaker

- Everything is scoped to the properties they are assigned to.
- Record rent, add/manage tenants & units, handle maintenance requests, log expenses (notifies the landlord), post announcements, and **accept rental applications → assign units → create leases** for applicants (issuing a single-use activation link for applicants without an account).
- Issue utility bills and record their settlement for assigned properties (same `utility-bills` routes, scoped by `isCaretakerOfProperty`).
- Removing the assignment (`DELETE .../caretakers/:caretakerId`) instantly revokes access.

### Admin

- Admin-only routes (`GET/POST /api/admin/...`): manage users of any role, platform settings, audit log, platform statistics and global reports.
- **SMS settings:** toggle `sms_enabled` / pick `sms_provider` in `PUT /api/admin/settings`; inspect the delivery log (`GET /api/sms`), list gateways (`GET /api/sms/providers`) and drain the queue (`POST /api/sms/flush`).
- Also the only path to create admin accounts.

## SMS notifications

Automated texts are queued asynchronously (never blocking the request) whenever a relevant event happens:

- **Rent due / overdue** — the scheduled reminder passes (`scheduler.js`).
- **Payment receipt** — only once a payment is `completed` (M-Pesa or recorded).
- **Utility bill issued / settled** — when a bill is created or marked paid.
- **Announcement** — per tenant in the targeted scope.
- **Maintenance update** — when a request changes status.
- **Account activation** — the tenant's single-use link.

Each message is deduped (so retries don't double-send), stored in `sms_messages` with state `queued → sent → delivered` (or `failed`, retried up to `SMS_MAX_ATTEMPTS`), and scoped by role: admins see all, landlords see their portfolio, caretakers their assigned properties, tenants their own. The active gateway is chosen by `SMS_PROVIDER` (or the admin setting); the default `mock` provider logs the text and marks it **simulated** — no real SMS is sent. A gateway can post delivery receipts to `POST /api/sms/webhook`.

## Tenant account activation

When staff add a tenant without a password, the server mints a token (`account_activations`), stores only its hash-checkable form, and sends a link `…/activate?token=…` by SMS. The link is single-use and expires after `ACTIVATION_TTL_HOURS` (default 48); consuming it sets the password hash, marks the account active, notifies and audits. Resends are non-enumerating (the response is identical whether or not the email exists). Permanent passwords are never sent by SMS.

## Security & isolation rules enforced per route

- Landlords only ever see their own properties/units/leases/tenants/payments/caretakers/reports.
- Caretakers only see assigned properties (checked via `isCaretakerOfProperty`).
- Tenants only see their own leases/payments/applications; they cannot decide applications.
- Payments: `activeLeaseOfTenant` targets the **newest** active lease for M-Pesa initialization; listing endpoints show all active leases.
- Utility bills: staff are scoped to their properties; the `tenant_id` is always derived from the unit's active lease (`activeLeaseOfUnit`), never from the request body; a unit can have at most one bill per period + category; paid bills cannot be edited or deleted.
- Receipts exist only for completed payments and only for the owner; M-Pesa callbacks are idempotent; failed/amount-mismatched callbacks cannot complete a payment.
- Uploads require auth, validate real content types, and store files under unguessable names.
- Public applications require no login, are rate-limited, reject duplicates for the same property + contact details, and expose only public listing data; a unit's availability is rechecked on submit and again on approval.
- SMS history is role-scoped (`/api/sms`), opt-out is respected at send time, and mock deliveries are always flagged `simulated`. Activation tokens are single-use, expiring, and never reveal whether an account exists.