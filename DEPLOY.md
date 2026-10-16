# Deployment runbook

Production deployment for SHS Job Pilot: an Oracle Cloud VM running the
`docker-compose.prod.yml` stack, fronted by a shared Caddy reverse proxy that
terminates TLS.

> This is the operator-facing runbook. For local development see the
> [Quick start](README.md#quick-start) in the README.

## Production topology

```
                         Internet
                            │  :80 / :443
                            ▼
                  ┌───────────────────┐
                  │  shs-caddy        │   (Docker container, owned by the
                  │  Caddy v2         │    separate `shs_ai_service` project)
                  └───┬───────────┬───┘
        job.<domain>  │           │  api.<domain>
                      ▼           ▼
             job-pilot-web:3000   (shs_ai_service API — not part of this repo)
                      │
        ┌─────────────┼──────────────────────────────┐
        ▼             ▼                               ▼
  job-pilot-web  job-pilot-api:3001  ────►  job-pilot-db:5432 (postgres:16)
   (Next.js 15)        │                   job-pilot-redis:6379 (redis:7)
                       ▼
                 job-pilot-worker (BullMQ processors)

  Networks: shs-job-pilot-network (internal)  +  shs_ai_service_shs-network (Caddy ingress)
```

- **Host:** Oracle Cloud Ubuntu VM, public IP `150.230.116.185`.
- **App directory:** `/home/ubuntu/shs_job_pilot` (a checkout of `main`).
- **Compose project:** `shs-job-pilot` (`docker-compose.prod.yml`).
- **Public URL:** `https://job.shs-trade-forge-service.name.ng`.

Images are built **on the VM** (there is no local Docker); `IMAGE_TAG` in the VM
`.env` is `dev`.

## 1. Host access

```bash
ssh ubuntu@150.230.116.185        # or the configured SSH alias
```

The VM needs Docker Engine with the Compose v2 plugin. Everything runs as the
`ubuntu` user (member of the `docker` group); no `sudo` is required for the
compose commands below.

## 2. DNS

The domain `shs-trade-forge-service.name.ng` is managed at **Whogohost**
(`nsa.whogohost.com` / `nsb.whogohost.com`). The records this stack depends on:

| Name                                  | Type  | Value             |
| ------------------------------------- | ----- | ----------------- |
| `job.shs-trade-forge-service.name.ng` | A     | `150.230.116.185` |
| `api.shs-trade-forge-service.name.ng` | A     | `150.230.116.185` |
| `shs-trade-forge-service.name.ng`     | A     | `150.230.116.185` |
| `www.shs-trade-forge-service.name.ng` | CNAME | apex              |

TLS certificates are issued by Let's Encrypt **on demand** via HTTP-01. A record
must resolve to the host's public IP **before** Caddy can obtain a certificate
for that name.

## 3. Filesystem layout

| Path                                                 | Purpose                         |
| ---------------------------------------------------- | ------------------------------- |
| `/home/ubuntu/shs_job_pilot`                         | App checkout + `.env`           |
| `/home/ubuntu/shs_job_pilot/docker-compose.prod.yml` | Production compose              |
| `/home/ubuntu/shs_ai_service/docker-compose.yml`     | Sibling project (owns Caddy)    |
| `/home/ubuntu/shs_ai_service/caddy/Caddyfile`        | **Caddy config (bind-mounted)** |

Named volumes (managed by Docker): `shs-job-pilot_job_pilot_pgdata`,
`..._job_pilot_redisdata`, `..._job_pilot_documents`.

## 4. Environment (`/home/ubuntu/shs_job_pilot/.env`)

`.env` is **not committed** and holds every secret. Start from `.env.example`
and set, at minimum:

```dotenv
NODE_ENV=production
APP_URL=https://job.shs-trade-forge-service.name.ng
WEB_URL=https://job.shs-trade-forge-service.name.ng
API_URL=https://job.shs-trade-forge-service.name.ng   # API is proxied via the web origin
CORS_ORIGINS=https://job.shs-trade-forge-service.name.ng

JWT_SECRET=<openssl rand -base64 48>
SESSION_SECRET=<openssl rand -base64 48>
COOKIE_SECURE=true          # false only when serving over plain HTTP

DB_PASSWORD=<strong random password>   # consumed by job-pilot-db and the DATABASE_URLs

# Email via Resend SMTP
EMAIL_PROVIDER=smtp
EMAIL_FROM="SHS Job Pilot <onboarding@resend.dev>"
SMTP_HOST=smtp.resend.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=resend
SMTP_PASS=<resend api key>

# Admin bootstrap (used by db:seed:admin)
ADMIN_EMAIL=<admin email>
ADMIN_PASSWORD=<admin password>

# Admin console allowlist — comma-separated emails that may reach /admin.
# Requires the ADMIN role as well. Falls back to a single ADMIN_EMAIL. When
# empty, the admin console is reachable by nobody (deny-by-default).
ADMIN_EMAILS=ogbogukenny@yahoo.com

IMAGE_TAG=dev
```

The API/worker containers read `DATABASE_URL` and `REDIS_URL` from
`docker-compose.prod.yml` (they point at the `job-pilot-db` / `job-pilot-redis`
service names), so leave those out of `.env` for production.

Provider keys (`PROVIDER_ADZUNA_*`, `PROVIDER_JOOBLE_*`, `AI_API_KEY`, …) are
optional; providers without credentials simply do not register.

## 5. First-time deployment

```bash
ssh ubuntu@150.230.116.185
git clone https://github.com/Kennius7/SHS_JOB_PILOT.git /home/ubuntu/shs_job_pilot
cd /home/ubuntu/shs_job_pilot
cp .env.example .env && nano .env      # fill in section 4

docker compose -f docker-compose.prod.yml build          # build api/worker/web images
docker compose -f docker-compose.prod.yml up -d

# Apply migrations and create the admin user (run inside the api image)
docker compose -f docker-compose.prod.yml exec job-pilot-api \
  npx prisma migrate deploy --schema=prisma/schema.prisma
docker compose -f docker-compose.prod.yml exec job-pilot-api npm run db:seed:admin
```

Then attach `job-pilot-web` to the Caddy ingress network (section 6) and add the
Caddy site block (section 7). Verify:

```bash
docker compose -f docker-compose.prod.yml ps
curl -sS -o /dev/null -w '%{http_code}\n' https://job.shs-trade-forge-service.name.ng
```

## 6. Caddy ingress network

`job-pilot-web` publishes `127.0.0.1:3000` **and** joins the external network
`shs_ai_service_shs-network` (declared at the bottom of
`docker-compose.prod.yml`). That network is created by the sibling
`shs_ai_service` project, so its compose file must be brought up at least once
before this stack can start:

```bash
cd /home/ubuntu/shs_ai_service && docker compose up -d   # if not already running
```

Keep the port bound to `127.0.0.1` — Caddy reaches the container over the shared
network by name (`job-pilot-web`), so nothing needs to be exposed publicly.

## 7. Reverse proxy (Caddy)

Caddy runs in the `shs-caddy` container from the **other** project, with its
config bind-mounted (read-only) from `/home/ubuntu/shs_ai_service/caddy/Caddyfile`.
The site block for this app is:

```caddy
job.shs-trade-forge-service.name.ng {
	encode gzip
	reverse_proxy job-pilot-web:3000
}
```

Reload after editing:

```bash
docker exec shs-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

> **Gotcha — file bind-mount inodes.** `sed -i` (and editors that write-temp +
> rename) replace the Caddyfile with a **new inode**, but the container's bind
> mount still points at the old one, so the reload reports
> `"config is unchanged"` and nothing happens. Either edit the file **in place**
> (append with `>>`, or `cat new > Caddyfile`), or restart the container to
> re-resolve the mount:
>
> ```bash
> docker restart shs-caddy
> ```
>
> Certificates are requested from the **production** ACME directory by default;
> the staging CA seen during retries is Caddy's automatic fallback while a name
> does not yet resolve.

## 8. Update / redeploy

```bash
ssh ubuntu@150.230.116.185
cd /home/ubuntu/shs_job_pilot
git fetch origin && git reset --hard origin/main
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
# if a new migration was added:
docker compose -f docker-compose.prod.yml exec job-pilot-api \
  npx prisma migrate deploy --schema=prisma/schema.prisma
```

`up -d` only recreates containers whose image or config changed. To pull
pre-built images instead of building, set `IMAGE_TAG` to a published tag (the
`publish.yml` workflow pushes `v*` tags and `dev` to GHCR) and omit `build`.

## 9. Database: migrations, seed, backup, restore

Migrations run inside the `job-pilot-api` container (the image contains the
Prisma schema, CLI, and `node_modules`):

```bash
docker compose -f docker-compose.prod.yml exec job-pilot-api \
  npx prisma migrate deploy --schema=prisma/schema.prisma
```

**Backup** (custom-format dump; keep these off-box):

```bash
docker compose -f docker-compose.prod.yml exec -T job-pilot-db \
  pg_dump -U jobpilot -Fc jobpilot > jobpilot-$(date +%F).dump
```

**Restore:**

```bash
cat jobpilot-2026-10-16.dump | docker compose -f docker-compose.prod.yml exec -T job-pilot-db \
  pg_restore -U jobpilot -d jobpilot --clean --if-exists
```

Documents live in the `job_pilot_documents` volume — back up with a throwaway
container if you need the files:

```bash
docker run --rm -v shs-job-pilot_job_pilot_documents:/data -v "$PWD":/backup alpine \
  tar czf /backup/documents-$(date +%F).tar.gz -C /data .
```

## 10. Rollback

Because this deployment builds images from a git checkout:

```bash
cd /home/ubuntu/shs_job_pilot
git log --oneline -10                       # find the last good commit
git reset --hard <sha>
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

For a migrations rollback, restore the pre-deploy database dump (section 9) — do
**not** rely on down-migrations. Always back up before deploying a migration.

## 11. Local access via SSH tunnel

For psql/pgAdmin or running the integration suite from a dev machine, tunnel the
database and Redis over SSH:

```bash
ssh -N -L 15432:job-pilot-db:5432 -L 16379:job-pilot-redis:6379 ubuntu@150.230.116.185
```

Then point `DATABASE_URL` at `localhost:15432` and `REDIS_URL` at
`redis://localhost:16379` locally.

## 12. Troubleshooting

| Symptom                                            | Likely cause / fix                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Caddy `config is unchanged` after edit             | Bind-mount inode changed — edit in place or `docker restart shs-caddy` (§7).        |
| Cert never issues, `NXDOMAIN` in `tls.obtain` logs | DNS record missing/typo'd; verify it resolves to `150.230.116.185`.                 |
| `127.0.0.1:3000` not reachable from outside        | Expected — Caddy proxies it; the port is intentionally localhost-only.              |
| Web calls hit `localhost:3001`                     | `API_INTERNAL_URL` build arg missing; it must be set in the `web` build (§compose). |
| Login sets no cookie / refresh fails               | `COOKIE_SECURE=true` requires HTTPS; set `false` only for plain HTTP.               |
| Admin console returns 403 for a real admin         | Email missing from `ADMIN_EMAILS` in `.env` (deny-by-default); recreate the API.    |
| Emails only reach the account owner                | `onboarding@resend.dev` test sender limitation — verify a sending domain in Resend. |
| Prisma `libssl` warning                            | Image must install `openssl` (already done in `docker/Dockerfile`).                 |

## 13. Pre-deploy checklist

- [ ] `git fetch && git reset --hard origin/main` on the VM.
- [ ] `.env` updated (secrets, URLs, `COOKIE_SECURE`, `ADMIN_EMAILS`).
- [ ] Database backed up before any migration.
- [ ] `docker compose ... build` succeeded.
- [ ] `docker compose ... up -d` — all containers healthy.
- [ ] `migrate deploy` run (if migrations changed).
- [ ] `https://job.shs-trade-forge-service.name.ng` returns 200 and login works.
