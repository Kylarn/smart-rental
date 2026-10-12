# Smart Rentals — Staging Deployment Runbook

This is the exact procedure to stand up a **staging** instance. It is written for a Linux VPS
(Ubuntu 22.04/24.04) but the application steps are OS-independent. Nothing here has been
executed against a provider — no hosting access, domain, or credentials were available in the
working environment. Work through it top to bottom once the prerequisites are supplied.

See also `DEPLOYMENT.md` (architecture, configuration, backups) and `.env.example`.

---

## 0. What is required before you can deploy

| Requirement | Why | Who provides it |
| --- | --- | --- |
| A server (VPS/container host) reachable on the public internet | Runs the Node process | You / hosting provider |
| A domain or subdomain (e.g. `staging.smartrentals.co.ke`) with an A/AAAA record | Public HTTPS + M-Pesa callback | You / DNS provider |
| Ability to install TLS (Let's Encrypt via certbot, or an ACME proxy like Caddy) | HTTPS is required; production cookies are `Secure` and M-Pesa callbacks must be HTTPS | You (server access) |
| Persistent storage for the SQLite file and uploads (disk path or volume) | Data must survive restarts/redeploys | Hosting provider |
| A distinct staging database + test accounts | Never point staging at the real `data.db` | Generated (this runbook) |
| Outbound internet (only if M-Pesa is enabled) | Reach `sandbox.safaricom.co.ke` | Hosting provider |

**Do not** purchase or change any billable service without authorization. **Do not** copy the
local `data.db` or any real customer data to staging.

Hard runtime requirement: **Node.js ≥ 22.5** (verified on Node 24.x). No external DB/cache.

---

## 1. Install runtime and reverse proxy (Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y curl ca-certificates nginx
# Install Node 24 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # must be >= 22.5
```

## 2. Create the service user and directories (persistent storage)

```bash
sudo useradd --system --create-home --home-dir /opt/smart-rentals --shell /usr/sbin/nologin smartrentals
sudo mkdir -p /var/lib/smart-rentals/uploads /var/lib/smart-rentals/backups
sudo chown -R smartrentals:smartrentals /var/lib/smart-rentals
```

Persistent paths (must be on durable storage, backed up):
- Database: `/var/lib/smart-rentals/data.db` (+ `-wal` / `-shm`)
- Uploads: `/var/lib/smart-rentals/uploads`
- Backups: `/var/lib/smart-rentals/backups`

## 3. Get the code onto the server and build

```bash
sudo -u smartrentals bash
cd /opt/smart-rentals
# Upload or clone the repository into this directory (git, scp, or rsync), then:
npm ci
npm run build          # builds client/dist so the server can serve the SPA
```

## 4. Configure secrets (never commit this file)

```bash
sudo mkdir -p /etc/smart-rentals
sudo -u smartrentals node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('base64url'))" \
  | sudo tee /etc/smart-rentals/.env >/dev/null
```

Then edit `/etc/smart-rentals/.env` (e.g. `sudo nano /etc/smart-rentals/.env`) to contain:

```ini
NODE_ENV=staging
PORT=4000
CLIENT_ORIGIN=https://staging.smartrentals.co.ke
JWT_SECRET=<the long random value generated above>
COOKIE_SECURE=1
DB_PATH=/var/lib/smart-rentals/data.db
UPLOADS_DIR=/var/lib/smart-rentals/uploads
BACKUP_DIR=/var/lib/smart-rentals/backups

# Leave M-Pesa blank unless staging sandbox credentials are provided (see §8).
MPESA_ENV=sandbox
MPESA_CONSUMER_KEY=
MPESA_CONSUMER_SECRET=
MPESA_SHORTCODE=
MPESA_PASSKEY=
MPESA_CALLBACK_URL=https://staging.smartrentals.co.ke/api/payments/mpesa/callback
```

```bash
sudo chown root:smartrentals /etc/smart-rentals/.env
sudo chmod 640 /etc/smart-rentals/.env
```

> Note: `NODE_ENV=staging` (not `production`) intentionally relaxes the production startup guard
> for this environment while still using secure cookies. Use `NODE_ENV=production` only for the
> real production deployment, where `COOKIE_SECURE=1`, a valid `JWT_SECRET`, and (if enabled)
> `MPESA_ENV=production` are enforced.

## 5. Create the staging database with test accounts

```bash
sudo -u smartrentals bash -lc 'cd /opt/smart-rentals && DB_PATH=/var/lib/smart-rentals/data.db npm run seed'
```

This creates a **separate** staging DB containing the admin account listed in `DEPLOYMENT.md`
(`admin@smartrentals.co.ke / Admin@123`) plus a suspended placeholder owner. No demo
landlord/caretaker/tenant logins are created — register or add those through the UI. The original
developer `data.db` is untouched.

## 6. Run the app under systemd

Copy `deploy/smart-rentals.service` from this repo to `/etc/systemd/system/`:

```bash
sudo cp /opt/smart-rentals/deploy/smart-rentals.service /etc/systemd/system/smart-rentals.service
sudo systemctl daemon-reload
sudo systemctl enable --now smart-rentals
systemctl status smart-rentals --no-pager
curl -s http://127.0.0.1:4000/api/health   # {"ok":true,...}
```

## 7. HTTPS reverse proxy (nginx + Let's Encrypt)

```bash
sudo cp /opt/smart-rentals/deploy/nginx.conf.example /etc/nginx/sites-available/smart-rentals
sudo ln -s /etc/nginx/sites-available/smart-rentals /etc/nginx/sites-enabled/smart-rentals
sudo nginx -t
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d staging.smartrentals.co.ke --redirect --agree-tos -m you@example.com --no-eff-email
sudo systemctl reload nginx
```

Verify externally:

```bash
curl -sI https://staging.smartrentals.co.ke/api/health
curl -sk https://staging.smartrentals.co.ke/app/payments | head -c 60   # should be HTML
```

> Alternative: skip nginx and use [Caddy](https://caddyserver.com) which provisions TLS
> automatically — see the Caddyfile sample at the bottom of `nginx.conf.example`.

## 8. M-Pesa sandbox (only if credentials are provided)

1. Put the Safaricom Daraja **sandbox** key/secret/shortcode/passkey in `/etc/smart-rentals/.env`.
2. Keep `MPESA_ENV=sandbox` and `MPESA_CALLBACK_URL` on the public HTTPS host.
3. `sudo systemctl restart smart-rentals`.
4. Run the sandbox round-trip in `DEPLOYMENT.md` §7.
   Never use real customer money; sandbox numbers only.

If credentials are not provided, leave M-Pesa blank: staging serves manual/recorded payments and
STK Push returns a clear "not configured" error (no mock, no silent success).

## 9. Post-deploy verification

```bash
curl -s https://staging.smartrentals.co.ke/api/health
# Log in as each role and exercise the workflows in the manual checklist below.
# Create a backup from the live staging DB:
sudo -u smartrentals bash -lc 'cd /opt/smart-rentals && BACKUP_DIR=/var/lib/smart-rentals/backups npm run db:backup'
```

## 10. Rollback

```bash
sudo systemctl stop smart-rentals
# restore previous code revision, then optionally restore the DB from backups/
sudo systemctl start smart-rentals
curl -s http://127.0.0.1:4000/api/health
```

---

## Container alternative (Docker)

If Docker is available, `deploy/Dockerfile` and `deploy/docker-compose.yml` build and run the
same app with a named volume at `/data` for the database and uploads:

```bash
cd /opt/smart-rentals
cp .env.example .env    # set NODE_ENV=staging, JWT_SECRET, COOKIE_SECURE=1, CLIENT_ORIGIN
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml exec app npm run seed
```

The compose file sets `DB_PATH=/data/data.db` and `UPLOADS_DIR=/data/uploads`, both on the
persistent `smart-rentals-data` volume. Terminate TLS at a proxy in front of the container.
