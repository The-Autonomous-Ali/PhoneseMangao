# Deployment — Oracle Cloud Always Free

Fixed monthly cost: ₹0. Variable: ~₹0.14 per WhatsApp OTP, plus Razorpay's 2% + GST
on online payments only.

| Concern | Where it runs |
|---|---|
| App | Docker, `output: "standalone"`, on one ARM instance in Mumbai |
| Database | Postgres in a container on the same box, not published to the host |
| TLS | Caddy on the origin, Cloudflare proxying in front |
| Cron | Host crontab → loopback HTTP → Postgres advisory locks |
| Backups | Nightly `pg_dump` → Cloudflare R2 via rclone |

---

## 1. The instance

Oracle Cloud → Compute → Instance. Pick **Ampere A1 (ARM)**, Ubuntu 22.04+,
region **Mumbai**. The free allowance is 4 OCPU / 24 GB across all A1 instances;
one instance with 2 OCPU / 12 GB leaves headroom and is far more than this app
needs.

Two firewalls have to agree, and forgetting the second is the usual reason a new
instance appears unreachable:

1. VCN → Security List → ingress for TCP 80 and 443 from `0.0.0.0/0`.
2. On the box itself, Oracle's Ubuntu images ship a restrictive iptables:

```sh
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Install Docker, then log out and back in so the group membership applies:

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

## 2. The app

```sh
sudo mkdir -p /opt/phonesemangao && sudo chown "$USER" /opt/phonesemangao
git clone <repo> /opt/phonesemangao && cd /opt/phonesemangao
cp .env.example .env
```

Fill in `.env`. Beyond the variables `.env.example` documents, compose needs
three of its own:

```bash
POSTGRES_PASSWORD=          # openssl rand -base64 32
POSTGRES_USER=phonesemangao
POSTGRES_DB=phonesemangao
DOMAIN=yourdomain.in
```

`DATABASE_URL` is composed by `docker-compose.yml` from those and overrides
whatever is in `.env` — it has to point at the `db` service, not at localhost.

Then:

```sh
docker compose build
docker compose run --rm migrate      # applies prisma/migrations
docker compose up -d
```

Migrations are a deliberate separate step. Running them from the app's entrypoint
means every restart — including an automatic one at 3am — can alter the schema.

## 3. DNS and TLS

Cloudflare → add the domain → A record for `@` pointing at the instance's public
IP, **proxy enabled** (orange cloud). The proxy is what keeps the origin IP off
public DNS.

Then SSL/TLS → **Full (strict)**. Not "Flexible": that mode talks plain HTTP to
the origin, so every session cookie crosses the internet in the clear while the
browser still shows a padlock.

Caddy gets its own certificate from Let's Encrypt automatically on first start.

## 4. Google sign-in

Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID (Web).

Authorized redirect URI, exactly, with no trailing slash:

```
https://yourdomain.in/api/auth/google/callback
```

This must byte-match what the app builds from `APP_URL`. A trailing slash on
either side fails at the consent screen, which is why `APP_URL` is validated for
one at boot.

## 5. WhatsApp OTP

In order — steps 2 and 3 are the ones that bite:

1. Business Manager → WhatsApp Business Account → add the shop's number.
2. **Add a payment method.** Without one the number is deactivated and every
   send fails, with no warning beforehand.
3. Create the template under the **Authentication** category. Utility templates
   are rejected for one-time codes, and only the Authentication format renders
   the copy-code button the app sends a parameter for.
4. Generate a **System User** token with `whatsapp_business_messaging`. The token
   shown in the dev dashboard expires in 24 hours — using it means OTPs stop
   working tomorrow.

Then set `SMS_DRIVER=whatsapp` and the three `WHATSAPP_*` values. Selecting the
driver without those makes the app refuse to boot rather than fail at login.

Business verification is not needed to launch: an unverified WABA allows 250
unique recipients per rolling 24 hours, well above expected volume.

## 6. Cron

```sh
chmod +x /opt/phonesemangao/deploy/*.sh
crontab /opt/phonesemangao/deploy/crontab
```

The jobs reach the app on `127.0.0.1:3000`, which `docker-compose.yml` binds to
loopback for exactly this. Each route takes a Postgres advisory lock, so an
overlapping or manually repeated run is a no-op rather than a double sweep.

Verify one by hand before trusting the schedule:

```sh
/opt/phonesemangao/deploy/cron-job.sh generate-slots
```

## 7. Backups and monitoring

```sh
sudo apt install -y rclone
rclone config          # s3 -> Cloudflare R2, name the remote "r2"
rclone mkdir r2:phonesemangao-backups
```

Set a lifecycle rule on the bucket to expire objects after 30 days. Pruning
offsite copies from the box is deliberately not done by `backup.sh`: a
compromised instance must not be able to delete the backups it is the reason for.

**Restore-test once before launch.** An untested backup is a guess:

```sh
rclone copy r2:phonesemangao-backups/<file> .
gunzip -c <file> | docker compose exec -T db psql -U phonesemangao phonesemangao
```

Point UptimeRobot at `https://yourdomain.in/api/health` — it queries the database,
so it stays red for the failures that actually take the shop down, not just for
Next having stopped listening.

## 8. Updating

```sh
cd /opt/phonesemangao
git pull
docker compose build
docker compose run --rm migrate
docker compose up -d
```

## Notes

- **The retry envelope is no longer a problem here.** `withDbRetry` allows ~95s
  across three attempts, which exceeded the function-duration cap on serverless
  hosting. A long-running Node process has no such cap.
- **`connect_timeout=30` is not needed** against a local Postgres. It exists for
  a managed tier that idles down; localhost does not.
