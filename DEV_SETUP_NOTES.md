# ClassroomHub — Local Dev Setup Guide

A practical guide to running classroomhub locally for development, plus a
troubleshooting reference for the errors you're likely to hit. Use it to set up a
fresh machine or to onboard a new contributor.

> Works on macOS, Linux, and Windows. **Windows users:** run the interactive
> commands in **Git Bash** (Unix commands like `cp` work there). The repo's package
> scripts are already cross-platform.

## Current workstation access reference

Last verified: **2026-07-17**. This section describes the maintained development
workstation for this fork. It is not a production credential inventory.

### Start after Windows reboot

The development runtime is registered as one Windows scheduled task. It starts Docker
Desktop, the local infrastructure, and all core source watchers after user logon:

```powershell
Get-ScheduledTask -TaskName 'ClassroomHub Development' | Select-Object TaskName, State
```

Expected state: `Running`. The task runs `scripts/start-development.cmd`, which starts
Docker Desktop, runs `pnpm infra:up`, then keeps `pnpm dev:core` active. Its log is
`C:\ProgramData\ClassroomHub\logs\development.log`. The old API, dashboard, and jobs
production tasks remain disabled so they cannot duplicate processes or occupy ports.

The `Cloudflared` Windows service uses automatic startup and normally needs no manual
command. Its dashboard ingress points to the Vite development server on `8000`, so HMR
is available through the public and tenant hostnames.

To start the same workflow manually:

```powershell
scripts\start-development.cmd
```

On Linux and macOS, after the one-time setup, use:

```bash
pnpm dev:local
```

### Dev Container on the Linux workstation

Open the repository in VS Code, install the **Dev Containers** extension, then run
**Dev Containers: Reopen in Container**. The definition uses Node 22 and the host
Docker daemon; on this Linux workstation it shares the host network so the existing
loopback-only development services remain reachable without changing any `.env` file.

After the container is ready, start the normal workflow from its terminal:

```bash
pnpm dev:local
```

`pnpm dev:local:status`, `pnpm dev:local:tunnel`, and `pnpm dev:local:stop` work the
same way. The container intentionally does not start watchers or alter Cloudflare tunnel
ingress on attach. This definition is Linux-host specific because it uses host networking;
use the documented native workflow on macOS or Windows.

It activates the Node version declared by `.nvmrc`, validates the local
configuration, starts Docker infrastructure, and keeps the API, dashboard, jobs,
and source watchers running with auto-reload. Use `pnpm dev:local:status` for a
local health/port/tunnel report, `pnpm dev:local:tunnel` for only the tunnel
check, and `pnpm dev:local:stop` after stopping the foreground watcher process.

Set `DEV_TUNNEL_URL` only in the shell invocation when an end-to-end public
tunnel probe is required. The command never changes a cloudflared ingress or
redirects a production tunnel to local services.

To stop the scheduled process before maintenance:

```powershell
Stop-ScheduledTask -TaskName 'ClassroomHub Development'
```

After the watchers are ready, verify the complete stack:

```powershell
pnpm dev:doctor
```

Use `pnpm infra:down` to stop the Docker development services after stopping the task.

### Verified endpoints

| Resource | Local | LAN | Public | Access |
|----------|-------|-----|--------|--------|
| Dashboard dev | `http://localhost:8000` | `http://192.168.1.234:8000` | `https://classroom-app.tedydev.io.vn` | Seeded account |
| API | `http://localhost:8001` | `http://192.168.1.234:8001` | `https://classroom-api.tedydev.io.vn` | Public health root; protected routes require auth |
| MinIO S3 API | `http://localhost:8004` | Loopback only | `https://classroom-assets.tedydev.io.vn` | S3 credentials or public object URL |
| MinIO console | `http://localhost:8005` | Loopback only | Not exposed | Development MinIO account |
| Mailpit SMTP | `localhost:8006` | Loopback only | Not exposed | No authentication |
| Mailpit UI | `http://localhost:8007` | Loopback only | Not exposed | No authentication |

Dashboard dev and API listen on all host interfaces for LAN testing. Postgres, Redis,
MinIO, and Mailpit are intentionally bound to `127.0.0.1` by
`docker-compose.dev.yaml`; access them remotely only through an explicitly configured
proxy or tunnel.

### Seeded tenant and sign-in accounts

The default seed creates one tenant and two accounts. Both accounts use the development-only password **`123456`**.

| Organization | Site name | Role | Email | Password |
|--------------|-----------|------|-------|----------|
| Udemy Test | `udemy-test` | Admin | `admin@test.com` | `123456` |
| Udemy Test | `udemy-test` | Student | `student@test.com` | `123456` |

Sign in at `http://localhost:8000/login` or
`https://classroom-app.tedydev.io.vn/login`. Local development can select a tenant
catalog with:

| Organization | Local tenant URL |
|--------------|------------------------|
| Udemy Test | `http://localhost:8000/?org=udemy-test` |

Use `pnpm --filter @cio/db seed -- --all --extended-demo` only when the optional Coursera and Skillshare multi-tenant fixtures are explicitly needed.

Do not reuse these accounts or this password in staging or production.

### Local infrastructure credentials

These deterministic values belong only to `docker-compose.dev.yaml` and are safe
only because the services bind to loopback.

| Service | Connection | Development credentials |
|---------|------------|-------------------------|
| PostgreSQL | `postgresql://postgres:postgres@localhost:8002/classroomhub` | User `postgres`, password `postgres`, database `classroomhub` |
| Redis | `redis://localhost:8003` | No password |
| MinIO S3 | `http://localhost:8004` | Access key `classroomhub`, secret key `classroomhub-dev-only` |
| MinIO console | `http://localhost:8005` | User `classroomhub`, password `classroomhub-dev-only` |
| Mailpit SMTP | `localhost:8006` | No authentication |
| Mailpit UI | `http://localhost:8007` | No authentication |

The Docker full-stack production-style flow is different: `run-docker-full-stack.sh`
generates or preserves strong values in the root `.env`. Never copy the development
credentials above into a public deployment.

### Environment files and secrets

| File or location | Owner | Important settings |
|------------------|-------|--------------------|
| `.env.dev` | Host development infrastructure | Port overrides consumed by `docker-compose.dev.yaml` |
| `apps/api/.env` | API | Database, Redis, auth, AI providers, object storage, public origins |
| `apps/dashboard/.env` | Dashboard | Public/private API URLs, shared private server key, deployment mode |
| `apps/jobs/.env` | Background workers | Database, Redis, AI providers, email, object storage |
| `packages/db/.env` | Database scripts | `DATABASE_URL` used by setup, seed, migration, and rehearsal commands |
| Root `.env` | Docker full stack | Container topology, production-style secrets, MinIO or R2 configuration |
| User environment | Cloudflare administration | `CLOUDFLARE_API_TOKEN`; never place it in tracked files |
| Cloudflare Worker secret store | Tenant router | `HLS_SIGNING_SECRET`; must match the API value |

The current workstation intentionally uses:

```bash
PUBLIC_IS_SELFHOSTED=false
PUBLIC_IS_SELF_OWNED=true
PUBLIC_SERVER_URL=https://classroom-api.tedydev.io.vn
DASHBOARD_ORIGIN=https://classroom-app.tedydev.io.vn
```

This combination keeps multi-tenant and custom-domain behavior enabled while all
product entitlements remain owned locally. The following values are secrets and must
only be read from their environment locations: `BETTER_AUTH_SECRET`,
`PRIVATE_SERVER_KEY`, provider API keys, Cloudflare API/R2 keys, SMTP passwords, and
`HLS_SIGNING_SECRET`. `PRIVATE_SERVER_KEY` must match between API and dashboard.

### Cloudflare routing status

| Hostname | Target | Verified status |
|----------|--------|-----------------|
| `classroom-app.tedydev.io.vn` | Dashboard Vite dev server on `localhost:8000` | Working |
| `classroom-api.tedydev.io.vn` | API on `localhost:8001` | Working |
| `classroom-assets.tedydev.io.vn` | MinIO on `localhost:8004` | Working |
| `dashboard-origin.tedydev.io.vn` | Dashboard origin for tenant router | Working |
| `api-origin.tedydev.io.vn` | API origin for tenant router | Working |
| `classroom.tedydev.io.vn` | Tenant-router marketing/root route | Working |
| `classroom-play.tedydev.io.vn` | Tenant-router course-app route | Working |
| `classroom-embed.tedydev.io.vn` | Tenant-router embed route | Working |
| `play.classroom.tedydev.io.vn` | Cloudflare for SaaS compatibility alias to `classroom-play.tedydev.io.vn` | Working |
| `embed.classroom.tedydev.io.vn` | Cloudflare for SaaS compatibility alias to `classroom-embed.tedydev.io.vn` | Working |
| `classroom-learn.tedydev.io.vn` | Tenant-router legacy redirect | Working |
| `udemy-test.classroom.tedydev.io.vn` | Cloudflare for SaaS tenant hostname | Working |
| `*.classroom.tedydev.io.vn` | Tenant-router tenant route | DNS and Worker route ready; each tenant still needs a SaaS custom-hostname certificate |

Cloudflare Universal SSL on the Free plan covers `tedydev.io.vn` and
`*.tedydev.io.vn`, but not the deeper `*.classroom.tedydev.io.vn` tenant names.
Cloudflare for SaaS is enabled with `dashboard-origin.tedydev.io.vn` as the active
fallback origin. The seeded tenant hostname and two deep compatibility aliases
above have active hostname and SSL status. The tenant router permanently redirects the
deep service aliases to the one-level canonical play and embed hosts while preserving
the path and query string. For every new tenant hostname, create an exact proxied CNAME
to the fallback origin and register that hostname in Cloudflare for SaaS; the wildcard
DNS record and Worker route alone do not issue the required deep-subdomain certificate.
The tunnel ingress configuration must preserve unrelated hostnames belonging to other
projects.

### Git topology

| Remote | URL | Policy |
|--------|-----|--------|
| `origin` | `https://github.com/Tedydev-web/classroomhub.git` | Fetch and push this fork |
| `upstream` | `https://github.com/classroomhub/classroomhub.git` | Fetch only; push is disabled |

The working integration branch is `main`. Follow [`docs/git-workflow.md`](docs/git-workflow.md)
for feature branches and [`docs/upstream-sync.md`](docs/upstream-sync.md) before importing
upstream changes.

### Health checks

```powershell
docker compose --env-file .env.dev -f docker-compose.dev.yaml ps
curl.exe -I http://localhost:8000/
curl.exe http://localhost:8001/
curl.exe -I https://classroom-app.tedydev.io.vn/
curl.exe https://classroom-api.tedydev.io.vn/
Get-Service Cloudflared
Get-ScheduledTask -TaskName 'ClassroomHub Development' | Select-Object TaskName, State
```

Expected: dashboard responses are `200`, API roots return JSON, all four Docker
services are healthy, `Cloudflared` is `Running`, and the development task is
`Running`. Run `pnpm dev:doctor` for the complete local check.

---

## 1. Prerequisites

| Tool | Version | Required? | Notes |
|------|---------|-----------|-------|
| Node.js | 22.x LTS (`.nvmrc` = v22.23.1) | **Required** | `nvm install && nvm use` |
| pnpm | 10.x | **Required** | The package scripts call `pnpm` directly (e.g. `build:clean` runs `pnpm run build`) — npm/yarn are not supported substitutes. `corepack enable` then `corepack prepare pnpm@latest --activate`, or `npm i -g pnpm` |
| Docker (Desktop) | latest | **Required** | Runs Postgres + Redis (and optionally the bundled SeaweedFS object storage). No local install of those needed. |
| Git | latest | **Required** | Windows: includes Git Bash |
| ffmpeg / ffprobe | latest | Optional | Only for media/thumbnail background jobs |

---

## 2. Setup steps

### Step 1 — Install dependencies
```bash
pnpm i
```

### Step 2 — Create the `.env` files
Each app/package reads its **own** `.env`. Copy each `.env.example` to `.env` and fill
the values below (host ports). The secret values are placeholders — **generate each one**
with `openssl rand -hex 32` rather than copying the example text. The two
`PRIVATE_SERVER_KEY` values **must match**, so generate it once and paste the same value
into both files.

**`apps/api/.env`**
```bash
PORT=8001
DATABASE_URL="postgresql://postgres:postgres@localhost:8002/classroomhub"
REDIS_URL="redis://localhost:8003"
PUBLIC_SERVER_URL="http://localhost:8001"
TRUSTED_ORIGINS="http://localhost:8000"        # the dashboard dev origin
BETTER_AUTH_SECRET="<generate-with-openssl-rand-hex-32>"
PRIVATE_SERVER_KEY="<generate-with-openssl-rand-hex-32>"   # generate once; use the SAME value in the dashboard
```

**`apps/dashboard/.env`**
```bash
PUBLIC_SERVER_URL="http://localhost:8001"
PRIVATE_SERVER_URL="http://localhost:8001"      # used by the SSR auth proxy — required for login
PRIVATE_SERVER_KEY="<generate-with-openssl-rand-hex-32>"   # must match the API (paste the value generated above)
PUBLIC_IS_SELFHOSTED=false
PUBLIC_IS_SELF_OWNED=true
```

`PUBLIC_IS_SELFHOSTED=false` keeps multi-tenant organizations and custom-domain routing available. `PUBLIC_IS_SELF_OWNED=true` enables all local product entitlements and disables upstream billing and product telemetry. Use `PUBLIC_IS_SELFHOSTED=true` only for a single-organization deployment.

**`apps/jobs/.env`** — only if you'll run the background workers (`pnpm dev:core` starts
them). Simplest: copy the API env, which already has `REDIS_URL` + `DATABASE_URL`.
```bash
cp apps/api/.env apps/jobs/.env
```

**`packages/db/.env`** — used by the DB setup scripts (Step 4). Created there.

> Why so many? The dashboard calls the API through a **server-side proxy**
> (`/api/auth/*`), so it needs `PRIVATE_SERVER_URL`. The API's better-auth needs
> `BETTER_AUTH_SECRET` (to sign sessions) and `TRUSTED_ORIGINS` (to trust the
> dashboard origin). Server-to-server data calls use the shared `PRIVATE_SERVER_KEY`.

### Step 3 — Start infrastructure (Postgres + Redis)
```bash
pnpm setup:env -- --apply-local-defaults
pnpm infra:up
```
This starts Postgres, Redis, MinIO, and Mailpit using the canonical development ports.

### Step 4 — Set up + seed the database
```bash
pnpm --filter @cio/db db:setup:seed              # creates schema + demo data
```

`db:setup` includes the assessment index/backfill finalizer. After a manual `db:migrate`, run
`pnpm --filter @cio/db db:finalize-assessment-schema`. Use
`pnpm --filter @cio/db db:rehearse-assessment-migration` to verify the complete chain against a disposable database.

### Step 5 — Build the shared packages once
```bash
pnpm build
```
The dashboard/api import workspace libs (`@cio/ui`, `@cio/api`, `@cio/db`, …) from
their `dist/`, which only exists after a build. (If `@cio/jobs-worker` fails here on
`ffmpegProbeLuma`, that's a known branch bug — see Known issues; it doesn't block
dashboard/api.)

### Step 6 — Run the core development stack
```bash
pnpm dev:core
```
> Don't use `pnpm dev` — it tries to start the whole monorepo (~20 services) and
> includes optional apps that are unnecessary for day-to-day development. `dev:core`
> scopes Turbo to the dashboard, API, workers, and their source-watching dependencies.

#### Testing on mobile or LAN with HTTPS (optional)
To test the dashboard on a mobile device or other local network device over HTTPS with locally-trusted certificates (via `mkcert`):
```bash
pnpm dashboard:dev:https
# or after killing stale watchers:
pnpm dashboard:dev:https:fresh
```
This automatically sets `HTTPS=true`, provisions local certificates, and binds Vite to `0.0.0.0`, serving on both `https://localhost:5173` and `https://<lan-ip>:5173`. Other UIs also support this (e.g. `pnpm storybook:dev:https`, `pnpm website:dev:https`, `pnpm embeds:dev:https`).

> [!NOTE]
> On separate mobile or LAN devices, the browser will display an untrusted certificate warning since the `mkcert` CA is installed only on your development host machine. If you have the option, you can bypass the warning by selecting **Advanced → Proceed** (or **Show Details → visit this website** in Safari) to continue testing.

### Step 7 — Log in
Open http://localhost:8000/login → `admin@test.com` / `123456`.

### Email (optional)
Email is **off by default** and the app runs fine without it. You only need it to
test auth emails (verify/reset) and notifications.

To enable, set the SMTP vars in **`apps/api/.env`** (auth-flow emails) and
**`apps/jobs/.env`** (all other emails) — both can point at the same server:
```bash
SMTP_HOST=  SMTP_PORT=  SMTP_USER=  SMTP_SENDER=  SMTP_PASSWORD=
```
Any SMTP provider works (Zoho ZeptoMail, Resend, Gmail SMTP, or Mailtrap for
throwaway testing). See the inline notes in [`apps/api/.env.example`](apps/api/.env.example)
for which emails each process sends.

**Cost:** most providers have a free tier for low volume; sustained/high volume is
paid. For local dev a free sandbox (e.g. Mailtrap) or a provider's free tier is
enough — developing costs nothing.

---

## 3. Ports

| Service     | URL / Port            | Notes                            |
|-------------|-----------------------|----------------------------------|
| Dashboard   | http://localhost:8000 | Vite dev server                   |
| API         | http://localhost:8001 | backend                           |
| Postgres    | localhost:8002        | Docker development service        |
| Redis       | localhost:8003        | Docker development service        |
| MinIO S3    | http://localhost:8004 | local object storage              |
| MinIO UI    | http://localhost:8005 | object storage console            |
| Mailpit SMTP| localhost:8006        | local outbound email sink         |
| Mailpit UI  | http://localhost:8007 | local email viewer                |
| Website     | http://localhost:8008 | optional                          |
| Docs        | http://localhost:8009 | optional                          |
| Storybook   | http://localhost:8010 | optional                          |
| Embeds      | http://localhost:8011 | optional                          |
| Preview/start helpers | localhost:8012–8016 | website, docs, and embeds |
| Generated course app | localhost:8017–8018 | dev and preview template    |
| Course app  | localhost:8019–8020 | dev and preview                   |
| Tenant router | localhost:8021 | local Wrangler worker                  |
| Storybook preview | localhost:8022 | static preview                     |
| Dashboard preview | localhost:8023 | optional production preview; not tunneled |
| jobs-worker | (none)                | background worker, no HTTP port   |

### Cloudflare Tunnel ingress

The remotely managed tunnel keeps the public hostnames stable while forwarding to the local development services:

| Hostname | Local service |
|----------|---------------|
| `classroom-app.tedydev.io.vn` | `http://localhost:8000` |
| `dashboard-origin.tedydev.io.vn` | `http://localhost:8000` |
| `classroom-api.tedydev.io.vn` | `http://localhost:8001` |
| `api-origin.tedydev.io.vn` | `http://localhost:8001` |
| `classroom-assets.tedydev.io.vn` | `http://localhost:8004` |

The `*-origin` hostnames are upstreams for the tenant-router Worker. Other tunnel ingress rules belong to other projects and must remain unchanged.
The one-level product hostnames, both `*-origin` records, and the seeded SaaS tenant
hostname resolve and are verified. New nested tenant hostnames require the
per-hostname Cloudflare for SaaS registration documented in the status table above.

## 4. Demo accounts

Seeded accounts use password **`123456`** (verified against the seed's bcrypt hashes):

- `admin@test.com` / `123456`  (admin — "Elon Gates")
- `student@test.com` / `123456` (student — "John Doe")

The optional accounts in `users.json` are inserted only with `--extended-demo`.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `no such service: db-init` | `db-init` was removed; the `api` container now runs DB setup | Don't reference `db-init`. For host dev use `db:setup:seed` (Step 4). |
| `DATABASE_URL or PRIVATE_DATABASE_URL ... required` | `packages/db/.env` missing (db scripts read their own dir) | `cp packages/db/.env.example packages/db/.env` |
| `password authentication failed for user "postgres"` | `localhost:8002` is not the ClassroomHub development Postgres or the local env is stale | Run `pnpm setup:env -- --apply-local-defaults`, then `pnpm infra:up` |
| `Failed to resolve entry for package "@cio/*"` | shared packages not built (`dist/` missing) | `pnpm build`, then re-run the dev commands |
| `'rm'/'cp' is not recognized` or `spawn EINVAL` (Windows) | Unix command / `.cmd` spawn in a script | Already fixed in-repo (rimraf, Node copy, `shell:true`). Run `pnpm i` to get latest. |
| `invalid task configuration … N persistent tasks … concurrency` | `pnpm dev` starts the whole monorepo past Turbo's default concurrency | Use `pnpm dev:core` instead |
| `ZodError … REDIS_URL ... expected string, received undefined` | `apps/jobs/.env` missing `REDIS_URL` | Run `pnpm setup:env -- --apply-local-defaults`; it sets `REDIS_URL=redis://localhost:8003` |
| `API target not configured` (502) on login | dashboard SSR proxy has no API target | Set `PRIVATE_SERVER_URL=http://localhost:8001` in `apps/dashboard/.env`, restart dashboard |
| Login `Invalid email or password` | wrong demo password | Use `admin@test.com` / **`123456`** |
| Login still fails after proxy target fix | API auth env empty | Fill `BETTER_AUTH_SECRET`, `TRUSTED_ORIGINS=http://localhost:8000`, `PUBLIC_SERVER_URL` in `apps/api/.env`, restart API |
| Changed a `.env` but nothing changed | env is read at process start | Restart the affected `*:dev` server |
| `Could not resolve` a `*.tedydev.io.vn` hostname on this machine, but a public DNS lookup works | Tailscale split DNS is claiming the zone locally | Run `sudo tailscale set --accept-dns=false`, then retry. This is machine-wide: it stops this device accepting all Tailnet-provided DNS settings, but does not disconnect Tailscale networking. |

> After editing any `.env`, **restart** the relevant dev server.

---

## 6. Known issues (not setup problems)

- **`ffmpegProbeLuma` not exported** — branch bug (commit `78ab13f54`):
  `apps/jobs/src/processors/media/generate-thumbnail.ts` imports `ffmpegProbeLuma`
  but `apps/jobs/src/utils/ffmpeg.ts` doesn't export it. Crashes the two **media**
  workers only; API / dashboard / emails / maintenance are fine. For the
  thumbnail-feature owner.
- **ffmpeg/ffprobe not installed** — media jobs need these binaries on `PATH` (or set
  `FFMPEG_PATH` / `FFPROBE_PATH`). Other workers are unaffected.
  On Ubuntu/Debian install them with `sudo apt-get update && sudo apt-get install -y ffmpeg`.
- **`pnpm dev` concurrency** — full-stack run needs a turbo `--concurrency` bump;
  intentionally not changed. Use the scoped workflow.

## 7. Windows notes

- Use **Git Bash** for interactive commands (`cp`, `rm`, etc.).
- The repo's package scripts were made cross-platform (`rimraf` instead of `rm -rf`,
  a Node postinstall, a Node file-copy, and `shell:true` when scripts spawn pnpm), so
  `pnpm i` / `pnpm build` work in `cmd.exe`/PowerShell too.
