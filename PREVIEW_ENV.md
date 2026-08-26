# Railway Staging & PR Preview Environments

ClassroomHub's fork production SaaS runs on Coolify + Cloudflare — **not** Railway. This
setup adds a **separate, internal Railway project** with a base `staging` environment and
short-lived preview environments for testing a trusted branch in this repository of the full stack (api, dashboard,
jobs, Postgres, Redis, MinIO) before it merges to `main`.

Real users are never routed here; it's a team-only sandbox.

## Staging base environment

The preview workflow duplicates the configured `staging` base environment. Its deployment
policy is managed outside these preview workflows; this document makes no automatic-deploy claim.

## How to deploy a branch to a preview environment

Preview environments are opt-in. `railway-preview.yml` runs only through
`workflow_dispatch`; choose a trusted branch in this repository and whether to deploy or destroy it from
the **Actions** tab. `railway-preview-teardown.yml` is also `workflow_dispatch` only, so
previews are never created or torn down automatically on pull-request events.

## GitHub Environment protection

Create a GitHub Environment named `railway-preview`. Store `RAILWAY_API_TOKEN` and
`RAILWAY_PROJECT_ID` **only** as secrets in that environment; never add either as a
repository or organization secret. Configure that environment to allow deployments only
from the repository default branch. Both workflows also fail closed unless the dispatched
workflow itself runs from that default branch.

> A service that deploys from a **fixed Docker Hub image tag can never get a PR preview** —
> an image tag has no branch. That's why the Railway app services build **from the repo**
> via `docker/Dockerfile.*`, not from `docker-compose.images.yaml`.

### Using the manual workflow

> 🎥 Demo video: TODO

**Actions → "Railway Preview Environment" → Run workflow:**
- `branch` — a trusted branch in this repository to deploy; pull refs, forks, SHAs, and remote syntax are rejected.
- `action` — `deploy` (create/update) or `destroy` (delete).
- `seed` — also load the full demo dataset (`admin@test.com` etc.); migrations + essential
  seed always run on api boot regardless.

The run prints the preview **Dashboard URL** in its job **summary**. The env is named
`pr-<branch-slug>-<hash>` — an 8-character hash of the branch name is appended because the
slug alone is lossy (e.g. `foo/bar` and `foo_bar` both slug to `foo-bar`).

The deploy step starts the three app-service builds **in parallel** (each `railway up --ci`
streams its build logs and blocks until that service passes its deploy/healthcheck), then
waits for all of them — so the printed URL is live the moment the run finishes, and a failed
healthcheck fails the run rather than reporting a broken preview.

## MinIO Storage

- **Single Domain:** Railway allows only **one Railway-provided domain per service**, so the
  workflow pins `cio-minio`'s generated domain to **port 9000 (S3 API)** — used for backend
  uploads (`OBJECT_STORAGE_ENDPOINT`) and browser presigned uploads.
- **Web Console:** the console listens on port 9001 but gets **no automatic public domain**
  in previews. To browse buckets, add a custom domain targeting 9001 on `cio-minio` →
  **Settings → Networking**, then set `MINIO_BROWSER_REDIRECT_URL=https://<that-domain>` on
  the service. Locally, the console is simply at `http://localhost:9001`.
- **CORS & CSP:** Previews set `MINIO_API_CORS_ALLOW_ORIGIN=*` on `cio-minio` and append the
  MinIO API domain to `ALLOWED_EXTERNAL_DOMAINS` on `cio-dashboard` so browser uploads and
  video playback pass Content Security Policy checks. Variable updates are retried and fail
  the run instead of leaving the preview misconfigured.
- **Persistence:** Ensure a Railway Volume is mounted to `/data` under `cio-minio` -> **Volumes** so uploaded files and buckets survive service redeploys.

## Database behavior

- Each environment has its **own isolated Postgres** — previews start fresh.
- `cio-api` **self-migrates on boot** (`docker/entrypoint-api.sh` → `pnpm --filter @cio/db
  db:setup` → `drizzle-kit migrate` + essential seed). No manual migrate step needed.
- **The branch must include a committed Drizzle migration** (`pnpm --filter @cio/db
  db:generate`) — the boot path runs committed migrations only, not schema `push`.

## Verify before relying on it (spike, do on a throwaway env)

Railway's docs are thin on a couple of points the workflow depends on — confirm these once:

1. **`railway environment new --duplicate <env>` copies service config *and* variables.**
   If your CLI version lacks `--duplicate`, use the GraphQL
   `environmentCreate(sourceEnvironmentId)` mutation instead.
2. **A duplicated env's Postgres starts empty** (so boot migration builds a clean schema).
3. **The demo-seed step's DB reachability.** `railway run` executes on the GitHub runner, so
   it needs a DB URL reachable from CI (Railway's public TCP proxy `DATABASE_PUBLIC_URL`),
   not the private `railway.internal` one. If unreachable, drop the seed step and rely on the
   boot-time essential seed. These caveats are marked `# SPIKE:` in `railway-preview.yml`.

## Cost

Every environment (staging + each preview) runs the full 6 services incl. a MinIO volume, so
previews are not free while alive. Destroy them promptly with the preview workflow's
`action = destroy` or by running the teardown workflow for the branch.
