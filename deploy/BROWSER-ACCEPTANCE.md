# Smart Rentals — Manual Browser Acceptance Checklist

No browser automation was available in the working environment, and automated coverage at the
HTTP level cannot judge layout or catch console errors. Run this checklist twice — desktop
(≥1280 px) and mobile (~390 px) — once staging is live at a real HTTPS URL.

For each step: watch **DevTools → Console** for errors and **Network** for
failed/4xx/5xx requests. Every unexpected entry (exception, mixed content, favicon 404 can be
ignored only if not part of the app) is a **fail**.

---

## 0. Setup
- [ ] Open the staging URL over **HTTPS** in a **private window** (no cached login).
- [ ] Open DevTools (F12): Console → "Preserve log". Network tab open.
- [ ] Start at the public landing page (no login).

## 1. Public surface
- [ ] Marketplace loads: property cards, search/filter, no layout overflow at desktop **and** mobile widths.
- [ ] A property page (`/property/:id`) loads images and details.
- [ ] Mobile: navigation/header collapses to a hamburger with no horizontal scroll.

## 2. Authentication
- [ ] Login (`/login`): wrong password shows an error toast. On a production build, more than 20 failed attempts from one IP within 15 minutes returns `429` (staging/dev uses a higher limit unless `RATE_LIMIT_LOGIN_MAX` is set) — verify no console exception.
- [ ] Login with admin `admin@smartrentals.co.ke / Admin@123` → lands on `/app`.
- [ ] Refresh at `/app/payments` → page reloads, still logged in (SPA fallback works).
- [ ] Logout → redirected to `/login`; going back does **not** restore the logged-in view; reloading `/app` redirects to `/login`.
- [ ] Verified `Set-Cookie` flags over HTTPS: `HttpOnly`, `Secure`, `SameSite=Lax` (Application → Cookies).

## 3. Role navigation (desktop + mobile) — repeat for each role
| Role | Account |
| --- | --- |
| Admin | `admin@smartrentals.co.ke / Admin@123` |

> The Riesta seed creates **only** the admin plus a suspended placeholder owner. There are no
> demo landlord/caretaker/tenant logins. To exercise the other roles, register a landlord and
> build a property → unit → tenant/caretaker fixture through the UI (or reuse the smoke-test setup).

For each role:
- [ ] Sidebar/tab navigation highlights the active page on every main area.
- [ ] Tenant sees only: Dashboard, My Lease, Rent & Payments, My Bills, Maintenance, Applications, Messages, Announcements, SMS Log — **not** Properties/Units/Tenants/Reports.
- [ ] Caretaker sees only pages for their assigned properties; navigating to `/app/reports` shows caretaker reports, **not** landlord-wide data.
- [ ] Landlord sees full property management + reports; **no** admin pages.
- [ ] Admin additionally sees Users / Audit / Settings.
- [ ] Manually typing a role-restricted URL (e.g. tenant visits `/app/admin/users`) shows a "not allowed" state, **never a crash or blank page**.

## 4. Feature workflows
- **Announcements**: caretaker posts to a property and selects recipients; tenants of that property see it in **Announcements** and get a notification; a landlord sees it; a caretaker of a *different* property gets an error.
- **Tenant management**: caretaker creates a tenant in an assigned unit; tenant can **login** with their new account; landlord edits tenant details; tenant with no active lease sees a clear "no active lease" message.
- **Payments**: tenant initiates an M-Pesa payment (manual sandbox flow only if configured; otherwise the recorded-payment flow): landlord/caretaker records a payment → receipt shows, tenant notification links to `/app/payments`.
- **Move-outs**: start a move-out, attempt completion without returning keys → rejection with a clear message; return keys → unit becomes vacant, tenant history preserved.
- **Maintenance**: tenant raises a request, attaches a photo; caretaker updates status; landlord sees it. Photo must actually render.
- **Messages**: landlord↔tenant send/receive; unread badge updates.

## 5. Refreshes, deep links, legacy redirects
- [ ] Refresh **each** `/app/*` page directly (URL reload) → loads the same page.
- [ ] Open a legacy link from a notification in a new tab: `/tenant/payments`, `/landlord/reports`, `/landlord/payments`, `/landlord/leases`, `/caretaker/announcements`, `/tenant/lease`, `/tenant/messages` → the client redirects to the matching `/app/*` page.
- [ ] Hard-navigate to `/api/does-not-exist` → JSON `{"error":"Endpoint not found"}` (not HTML, no stack trace).
- [ ] Hard-navigate to an unknown `/app/xyz` → the app's 404 page (not a raw server 404).

## 6. Error handling & resilience
- [ ] Kill the backend (or refresh with it stopped) → frontend shows a readable "network error" message, **no** white screen or unhandled promise rejection in Console.
- [ ] Submit an invalid upload (fake `.png` text file) → inline error, no broken reference.
- [ ] Trigger a validation error on every form used above → field-level messages shown.
- [ ] No failed network requests (red entries) during normal flows.

## 7. Mobile-specific
- [ ] Forms usable on a 390 px screen (no tiny/overlapping controls).
- [ ] Tables scroll horizontally or reflow instead of overflowing the viewport.
- [ ] Announcements/payment tables readable; buttons tappable.

## 8. Performance sanity
- [ ] First load: main bundle loads; page-chunk files load lazily as you visit areas (Network shows several JS chunks, not one giant file).
- [ ] Reports page loads its separate charts chunk only when opened.

---

## Recording results
For every item above record one of: **PASS / FAIL / N/A**. Attach a Console/Network screenshot or
text dump for any FAIL and note the page + action that triggered it. A run is considered passing
only if all applicable items are PASS with a clean Console and no failed network requests.