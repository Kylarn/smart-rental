# How Smart Rentals works — role guide

This guide explains the real flows behind each role, with the API routes that implement them.

## Core concept: the lease is the connection

Accounts are just logins. What makes a tenant "yours" is a **lease** row linking `tenant_id → unit_id → property_id`. Until a lease exists for a tenant, they have nothing on their dashboard.

Two paths to create that link:

1. **Tenant self-serves:** tenant registers (public `POST /api/auth/register`, role `tenant`) → browses active listings (`GET /api/market/properties`) → applies (`POST /api/market/properties/:id/apply`) → landlord/caretaker approves and assigns a unit → lease created.
2. **Landlord/caretaker adds:** they create a lease directly for a user (or accept a walk-in application where the applicant has no account — the system creates the tenant user and the staff set a temporary password).

## Role flows

### Tenant

- Register or log in (`POST /api/auth/login`).
- Browse/search/filter listed properties by county, type, price, bedrooms (`GET /api/market/properties`); view a property + its vacant units; contact the landlord; request a viewing.
- Apply to a property (one active application per property at a time).
- After assignment: see the lease (`/tenant/lease`), pay rent through M-Pesa (`POST /api/payments/initiate` → STK push → callback completes it), view receipts and payment history.
- View utility bills issued for their unit (`GET /api/utility-bills` — returns only their own) at `/app/my-bills`; settle by paying the landlord/caretaker, who records it.
- Raise maintenance requests and track their status.
- Message the landlord; receive announcements and notifications.
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
- Record rent, add/manage tenants & units, handle maintenance requests, log expenses (notifies the landlord), post announcements, and **accept rental applications → assign units → create leases** for applicants (setting a temporary password for applicants without an account).
- Issue utility bills and record their settlement for assigned properties (same `utility-bills` routes, scoped by `isCaretakerOfProperty`).
- Removing the assignment (`DELETE .../caretakers/:caretakerId`) instantly revokes access.

### Admin

- Admin-only routes (`GET/POST /api/admin/...`): manage users of any role, platform settings, audit log, platform statistics and global reports.
- Also the only path to create admin accounts.

## Security & isolation rules enforced per route

- Landlords only ever see their own properties/units/leases/tenants/payments/caretakers/reports.
- Caretakers only see assigned properties (checked via `isCaretakerOfProperty`).
- Tenants only see their own leases/payments/applications; they cannot decide applications.
- Payments: `activeLeaseOfTenant` targets the **newest** active lease for M-Pesa initialization; listing endpoints show all active leases.
- Utility bills: staff are scoped to their properties; the `tenant_id` is always derived from the unit's active lease (`activeLeaseOfUnit`), never from the request body; a unit can have at most one bill per period + category; paid bills cannot be edited or deleted.
- Receipts exist only for completed payments and only for the owner; M-Pesa callbacks are idempotent; failed/amount-mismatched callbacks cannot complete a payment.
- Uploads require auth, validate real content types, and store files under unguessable names.