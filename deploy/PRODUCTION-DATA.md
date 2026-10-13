# Smart Rentals — Production Data & Riesta Register Runbook

This runbook loads the real **Riesta Apartments** register into a **production** database and
creates usable logins for the owner, caretaker and tenants. It assumes the app is already
installed and configured (see `deploy/STAGING.md` for the base install, and `DEPLOYMENT.md`
for architecture/config/backups).

Nothing here has been run against a live host. Replace `REAL_OWNER_EMAIL`, phone numbers,
passwords and dates with the landlord's confirmed values before running.

Persistent paths used below (match `deploy/STAGING.md`):

| What | Path |
| --- | --- |
| Code | `/opt/smart-rentals` |
| Database | `/var/lib/smart-rentals/data.db` (+ `-wal` / `-shm`) |
| Uploads | `/var/lib/smart-rentals/uploads` |
| Backups | `/var/lib/smart-rentals/backups` |
| Env file | `/etc/smart-rentals/.env` |

> Every command below must use the **same** `DB_PATH` and environment. If your running
> service loads `/etc/smart-rentals/.env`, run these scripts as the service user with that
> file present so `DB_PATH` resolves to the real database.

---

## 0. Pre-flight

- [ ] The app builds: `npm run build` succeeds.
- [ ] `.env` is production-safe: `NODE_ENV=production`, `COOKIE_SECURE=1`, strong `JWT_SECRET`,
      HTTPS `CLIENT_ORIGIN`/`PUBLIC_BASE_URL`. The server refuses to boot otherwise.
- [ ] `SEED_ADMIN_PASSWORD` is set to a strong value (otherwise a random admin password is
      generated and printed once).
- [ ] If a database already exists, take a backup **before** anything:
      ```bash
      sudo -u smartrentals DB_PATH=/var/lib/smart-rentals/data.db npm run db:backup
      ```

> **`npm run seed` DELETES the database at `DB_PATH`** (`server/src/db/seed.js`). Use it only
> on a brand-new database. On any existing/live database use `npm run import:riesta` instead,
> which is idempotent and non-destructive.

---

## 1. Load the Riesta register

Preferred (idempotent — adds/refreshes records, never deletes):

```bash
cd /opt/smart-rentals
sudo -u smartrentals DB_PATH=/var/lib/smart-rentals/data.db npm run import:riesta
```

Creates:

- the **Riesta Apartments** property (status `archived`) and 85 units (rooms 1–85);
- the paper-register rows: rooms 1–13 tenants, deposits, and historical rent entries;
- the **admin** account (`SEED_ADMIN_PASSWORD`, or a random password printed once);
- a **suspended placeholder owner** `owner.pending@riesta.local` (unusable password, no login).

Print and store the admin password securely. Re-running is safe.

To start from an empty database instead (only if none exists yet — this wipes it):

```bash
sudo -u smartrentals DB_PATH=/var/lib/smart-rentals/data.db npm run seed
```

---

## 2. Activate the owner as a landlord

Turns the suspended placeholder into a login-capable landlord assigned to the property.

```bash
sudo -u smartrentals DB_PATH=/var/lib/smart-rentals/data.db \
  npm run activate:landlord -- \
    --name "Real Owner Name" \
    --phone "07XXXXXXXX" \
    --password "OWNER_STRONG_PASSWORD"
```

- Omit `--password` to have one generated (printed once).
- The script targets the placeholder email `owner.pending@riesta.local`. It can update
  `name`, `phone` and `password`, but **not the email**. To use a real owner email, change
  that one row in `users` (e.g. with the sqlite CLI) **before or after** running this, then
  sign in with the new email.

Verify: sign in as the owner, open Properties → the Riesta property should be visible.

---

## 3. Activate the caretaker

Creates the caretaker account, assigns them to the Riesta property, and notifies them.

```bash
sudo -u smartrentals DB_PATH=/var/lib/smart-rentals/data.db \
  npm run activate:caretaker -- \
    --email "caretaker@riesta.local" \
    --name "Caretaker Name" \
    --phone "07XXXXXXXX" \
    --password "CARETAKER_STRONG_PASSWORD"
```

- Omit `--password` to have one generated (printed once). Re-running with an existing
  caretaker updates status/phone (and password if supplied) instead of duplicating.

---

## 4. Activate the register tenants (rooms 2–13)

Creates tenant logins, active leases and marks the units occupied.

```bash
sudo -u smartrentals DB_PATH=/var/lib/smart-rentals/data.db \
  npm run activate:tenants -- \
    --domain riesta.local \
    --start 2026-01-01 \
    --end 2026-12-31
```

Notes:

- Logins are `room2@riesta.local` … `room13@riesta.local` (room 1 is the caretaker's
  accommodation and is skipped). Passwords are **random, printed once — capture the output**.
- Rent defaults to the unit's recorded rent (`0` unless already set). Pass `--rent <KES>` to
  set a flat monthly rent, or set rents from the landlord dashboard afterwards.
- Re-running is safe: existing logins are reactivated and existing active leases are reused.

---

## 5. Start the service

```bash
sudo systemctl restart smart-rentals     # or: docker compose -f deploy/docker-compose.yml up -d
```

On boot the config guard re-validates the environment and the schema is migrated
idempotently. Check the logs for `[config] WARNING` / `[security] WARNING` lines.

---

## 6. Post-launch

- [ ] Sign in as admin; confirm the Riesta property, units and register rows imported.
- [ ] Sign in as owner; set real monthly rents and verify leases.
- [ ] Have the caretaker and each tenant change their generated passwords.
- [ ] Ask tenants to complete phone/county/ID from the profile page (imported as pending).
- [ ] Confirm a backup exists and `npm run db:backup` is scheduled.

---

## Known data limitations (confirm with the landlord)

- Owner name/contact, property **location/county**, and rent amounts are **unverified**
  (imported from a paper register).
- Rooms **14–85** exist but occupancy is **unknown**; only rooms 1–13 have names.
- Tenants were imported **without** phone/email/ID — those are placeholders until confirmed.
- Room 1 is caretaker accommodation (not a rent-paying tenancy).
- Rent-entry dates are imported **unverified** (`date_verified=0`).

---

## Recovery

If something goes wrong, restore from the latest verified backup (see `DEPLOYMENT.md`):
stop the service, replace `data.db` (+ `-wal`/`-shm`) and `uploads/` from the backup, then
start the service. `npm run import:riesta` and the activation scripts are all idempotent and
can be re-run to reconcile state.
