<a href="https://classroom.tedydev.io.vn/">
  <img alt="ClassroomHub is a no-code tool that allows you build and scale your online bootcamp with ease." src="apps/website/static/classroomhub-opengraph-image.jpg" />
  <h1 align="center">ClassroomHub</h1>
  <p align="center">
    The Open Source Learning Management System for Companies
    <br />
    <a href="https://classroom.tedydev.io.vn">Website</a>  |  <a href="https://github.com/Tedydev-web/classroomhub/issues">Support</a>
  </p>
</a>

## ✨ About ClassroomHub

<img alt="ClassroomHub Courses page" src="/assets/assets/www/home/ai-course-builder.jpeg" />

ClassroomHub is an open source LMS for companies. Run compliance/employee training, customer education, and partner certification cohorts — all from one platform. Self-host it on your own infrastructure or use the cloud version.

### Who It's For

| Use Case | What You Get |
|---|---|
| **Compliance Training** | Deadline tracking, renewals & retake intervals, grace periods, waivers, certificates with custom IDs |
| **Customer Education** | Branded academy portal, cohorts (cohorts with goals), AI lesson tutor, multilingual content |
| **Partner Training** | Partner workspaces, branded certificates, custom domains, embeddable widgets, multilingual support |

### Key Features

**Course & Content**
- **Course management** — unlimited courses, lessons, exercises, grading, and certificates
- **Cohorts** — group courses into cohorts with goals, team management, and progress tracking
- **AI Course Builder** — generate outlines, lesson content, and assignments with Google, Moonshot, OpenAI, or Anthropic models
- **AI Lesson Tutor** — in-lesson AI assistant that helps learners as they study

**Compliance & Certification**
- **Compliance tracking** — status, deadlines, grace periods, renewals, and waivers
- **Certificates** — issue branded certificates with custom IDs

**Learner & Org Experience**
- **Multi-org & multi-teacher** — invite teachers, assign courses, manage multiple organizations
- **Student dashboard** — learners access all courses, assignments, and progress in one place
- **Multilingual** — deliver content in 10+ languages

**Integrations & Developer Tools**
- **REST API + Webhooks** — enroll users, trigger automations, receive events (`certificate.issued`, `enrollment.completed`, and more)
- **MCP server** — `@tedydev/classroom-mcp` on npm for AI-native integrations
- **Embeddable widget** — embed your course catalog on any website

**Platform**
- **Fully open source** — self-host the entire stack on your own servers

For what's coming next, see the [public roadmap](https://classroom.tedydev.io.vn/roadmap).

## Built With

- [SvelteKit](https://kit.svelte.dev/?ref=classroom.tedydev.io.vn)
- [Hono](https://hono.dev/)
- [PostgreSQL](https://www.postgresql.org/)
- [Better Auth](https://www.better-auth.com/)
- [TailwindCSS](https://tailwindcss.com/?ref=classroom.tedydev.io.vn)

## Get a Demo

You can book a quick 15 min demo to see if ClassroomHub is a good fit for you

Contact [hieudat2310.bh@gmail.com](mailto:hieudat2310.bh@gmail.com) to schedule a demo.

<!-- GETTING STARTED -->

## Getting Started

To get a local copy up and running, please follow these simple steps.

### Prerequisites

Here is what you need to be able to run ClassroomHub

- **[Node.js](https://nodejs.org/)** (Version: `22.23.1`, pinned by `.nvmrc`) — _required_
- **[pnpm](https://pnpm.io/installation)** (v10) — _required_; the package scripts call `pnpm` directly, so npm/yarn are not substitutes
- **[Docker](https://docs.docker.com/engine/install/)** — _required_; runs Postgres + Redis (no local install of those needed)

### Project Structure

This repo is a monorepo that consists of these primary apps:

1. `website`: The landing page of ClassroomHub hosted [here](https://classroom.tedydev.io.vn)
2. `api`: The api service that handles PDF, video processing, Emailing and Notifications.
3. `dashboard`: The web application that runs the learning management system hosted [here](https://classroom-app.tedydev.io.vn).
4. `docs`: Official documentation of ClassroomHub hosted [here](https://classroom.tedydev.io.vn/docs)

The repository also contains shared packages under `packages/` (for example `packages/db`, `packages/utils`, and `packages/ui`).

### Developer Access

| Resource | Local | LAN | Public |
|----------|-------|-----|--------|
| Dashboard | [http://localhost:8000](http://localhost:8000) | [http://192.168.1.234:8000](http://192.168.1.234:8000) | [https://classroom-app.tedydev.io.vn](https://classroom-app.tedydev.io.vn) |
| API | [http://localhost:8001](http://localhost:8001) | [http://192.168.1.234:8001](http://192.168.1.234:8001) | [https://classroom-api.tedydev.io.vn](https://classroom-api.tedydev.io.vn) |
| Object storage | [http://localhost:8004](http://localhost:8004) | Loopback only | [https://classroom-assets.tedydev.io.vn](https://classroom-assets.tedydev.io.vn) |
| MinIO console | [http://localhost:8005](http://localhost:8005) | Loopback only | Not exposed |
| Mailpit | [http://localhost:8007](http://localhost:8007) | Loopback only | Not exposed |

Default seeded admin: `admin@test.com` / `123456`. This is development data only.

See [`DEV_SETUP_NOTES.md`](DEV_SETUP_NOTES.md) for the complete account matrix, tenant names,
port map, service credentials, environment-file inventory, Cloudflare routing, startup commands,
health checks, Git remotes, and known runtime caveats. Real API keys, Cloudflare credentials,
auth secrets, and private server keys are intentionally never stored in documentation.

## Development

### Local Setup

> **Before you start:** make sure **pnpm** and **Docker** are installed (see
> [Prerequisites](#prerequisites)). New to the project? Read
> [`DEV_SETUP_NOTES.md`](DEV_SETUP_NOTES.md) first — it's a full step-by-step
> walkthrough with a troubleshooting reference for the errors you're likely to hit.

1. Fork the repo, then clone it:

   ```bash
   git clone https://github.com/Tedydev-web/classroomhub.git
   ```

2. Go to project folder:

   ```bash
   cd classroomhub
   ```

3. Set up Node (using `nvm`):

   ```bash
   nvm use
   ```

   You first might need to install the specific version and then use it:

   ```bash
   nvm install && nvm use
   ```

   You can install nvm from [here](https://github.com/nvm-sh/nvm).

4. Install dependencies:

   ```bash
   pnpm i
   ```

5. Set up your `.env` files:

   Each app reads its **own** `.env`. In `apps/api`, `apps/jobs` and `apps/dashboard`, duplicate
   `.env.example` to `.env` and fill the values below (host ports). The secret values are
   placeholders — **generate each one** with `openssl rand -hex 32` rather than copying
   the example text. The two `PRIVATE_SERVER_KEY` values **must match** — they
   authenticate the dashboard's server-to-server calls to the API, so generate it once
   and paste the same value into both files.

   - `apps/api/.env`:

     ```bash
     PORT=8001
     DATABASE_URL="postgresql://postgres:postgres@localhost:8002/classroomhub"
     REDIS_URL="redis://localhost:8003"
     PUBLIC_SERVER_URL="http://localhost:8001"
     TRUSTED_ORIGINS="http://localhost:8000"        # the dashboard dev origin
     BETTER_AUTH_SECRET="<generate-with-openssl-rand-hex-32>"
     PRIVATE_SERVER_KEY="<generate-with-openssl-rand-hex-32>"   # generate once; use the SAME value in the dashboard
     DASHBOARD_ORIGIN="http://localhost:8000"        # optional; used for invite/email links back to the dashboard
     ```

   - `apps/jobs/.env`:
      The jobs service handles background tasks (emails, media processing, analytics rollups, etc.).

      **Recommended setup** (simplest):

      ```bash
      cd apps/jobs
      ln -s ../../apps/api/.env .env  
     ```

   - `apps/dashboard/.env`:

     ```bash
     PUBLIC_SERVER_URL="http://localhost:8001"
     PRIVATE_SERVER_URL="http://localhost:8001"      # used by the SSR auth proxy — required, or login returns "API target not configured"
     PRIVATE_SERVER_KEY="<generate-with-openssl-rand-hex-32>"   # must match the API (paste the value generated above)
     PUBLIC_IS_SELFHOSTED=false
     PUBLIC_IS_SELF_OWNED=true
     ```

   - Running the background workers? Also create `apps/jobs/.env` (e.g. `cp apps/api/.env apps/jobs/.env`); it needs `REDIS_URL`. The `packages/db/.env` used by the DB scripts is set up in step 6.
   - `PUBLIC_IS_SELFHOSTED` controls tenant topology. Keep it `false` for multi-tenant organizations and custom domains; set it to `true` only for a single-organization installation.
   - `PUBLIC_IS_SELF_OWNED=true` grants the deployment all product entitlements and disables upstream billing and product telemetry. SSO, token-auth, no-tracking, and other deployment capabilities do not require an external license service.
   - Optional upload size limits: set matching `UPLOAD_MAX_*_MB` values in **both** `apps/api/.env` and `apps/dashboard/.env` (see `apps/api/.env.example`). Defaults are 5 MB documents, 2 MB assignment files, 800 MB videos.

6. Start local infrastructure for API (Postgres + Redis) and seed the DB:

   ```bash
   pnpm setup:env -- --apply-local-defaults
   pnpm infra:up
   pnpm --filter @cio/db db:setup:seed
   ```

   - Connect with `DATABASE_URL=postgresql://postgres:postgres@localhost:8002/classroomhub`
   - Connect with `REDIS_URL=redis://localhost:8003`
   - `db:setup:seed` creates the schema and seeds demo data once Postgres is up. The db scripts run with their own working directory, so they read `DATABASE_URL` from `packages/db/.env` (not `apps/api/.env`).
   - `db:setup` runs migrations and the post-migration assessment finalizer. If an operator runs `db:migrate` directly, also run `pnpm --filter @cio/db db:finalize-assessment-schema` before starting the API.
   - To validate the full migration chain without touching the configured database, run `pnpm --filter @cio/db db:rehearse-assessment-migration`. The command requires permission to create a temporary database and always removes it afterward.

7. (Optional) Start MinIO locally for object storage (media/documents):

   ```bash
   pnpm infra:up
   ```

   - Console: http://localhost:8005 (development credentials are managed by `docker-compose.dev.yaml`)
   - S3 endpoint: http://localhost:8004
   - Buckets created by `minio-init`: `videos`, `documents`, `media`
   - Add to `apps/api/.env` when using MinIO locally:
     - `OBJECT_STORAGE_ENDPOINT=http://localhost:8004`
     - `OBJECT_STORAGE_PUBLIC_ENDPOINT=http://localhost:8004`
     - `OBJECT_STORAGE_ACCESS_KEY_ID=classroomhub`
     - `OBJECT_STORAGE_SECRET_ACCESS_KEY=classroomhub-dev-only`
     - `OBJECT_STORAGE_FORCE_PATH_STYLE=true`
     - `OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL=http://localhost:8004/media`

8. Run the core app services and source watchers:

   ```bash
   pnpm dev:core
   ```

   - If you see `Failed to resolve entry for package "@cio/..."`, the shared workspace packages haven't been built yet (their `dist/` is missing). Build them once with `pnpm build`, then re-run the dev commands.

### Daily local development (Linux/macOS)

After the one-time setup above, use one foreground command for the local API,
dashboard, jobs worker, source watchers, and Docker infrastructure:

```bash
pnpm dev:local
```

The command selects the Node version from `.nvmrc`, runs preflight validation,
starts the local Compose services, and keeps the auto-reload process in the
terminal. `Ctrl+C` stops the watchers; stop the Docker services separately with
`pnpm dev:local:stop`.

Useful checks:

```bash
pnpm dev:local:status
pnpm dev:local:tunnel
```

`status` checks the local services, ports, and cloudflared service. To add an
end-to-end public tunnel probe without placing a URL in repository files, run
`DEV_TUNNEL_URL=https://your-dev-host pnpm dev:local:tunnel`.

9. Default local URLs:

   - `api`: [http://localhost:8001](http://localhost:8001)
   - `dashboard`: [http://localhost:8000](http://localhost:8000)
   - `MinIO S3`: [http://localhost:8004](http://localhost:8004)
   - `MinIO console`: [http://localhost:8005](http://localhost:8005)
   - `Mailpit`: [http://localhost:8007](http://localhost:8007)

10. Optional: run other apps:

   - **website** (`8008`): `pnpm website:dev`
   - **docs** (`8009`): `pnpm docs:dev`
   - **Storybook** (`8010`): `pnpm storybook:dev`
   - **embeds** (`8011`): `pnpm embeds:dev`

11. Login into `dashboard`:

    - Visit [http://localhost:8000/login](http://localhost:8000/login)
    - Enter email: `admin@test.com`
    - Enter password: `123456`

    To learn more about how to login with a dummy account, [go here.](https://classroom.tedydev.io.vn/docs/contributor-guides/demo-accounts)

### Enabling the AI Course Assistant

The in-course AI chat (course authoring, plan generation, lesson edits) is **disabled by default**. Enable it by setting at least one provider API key in `apps/api/.env` (or the root `.env` for the Docker stack):

```bash
# Pick one or more. The picker exposes Gemini 2.5 Flash Lite, Kimi K2.6,
# GPT-5.4 Mini, and Claude Sonnet 4.6.
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AIza...
ANTHROPIC_API_KEY=sk-ant-...
MOONSHOT_API_KEY=...
```

Notes:
- The `GET /agent/status` endpoint flips to `enabled: true` as soon as any of those keys is set, which is what the dashboard checks before showing the AI button on a course.
- Each chat request sends the user-selected `model` (persisted in `localStorage` as `classroomhub-ai-chat-model`). The API resolves the provider for that model (`packages/utils/src/agent-models`) and returns 503 `AI_NOT_CONFIGURED` if that provider's key is missing.
- Optional Tinybird observability: set `TINYBIRD_TOKEN` (and optionally `TINYBIRD_BASE_URL`) in `apps/api/.env`. Events are silently skipped when the token is absent.
- More detail on architecture, tools, and routes lives in [`prd/ai-course-assistant [DONE]/README.md`](prd/ai-course-assistant%20[DONE]/README.md).

### Docker Compose (Full Stack)

```bash
cp .env.example .env   # copy env template, edit for your domain
./run-docker-full-stack.sh --provision-only # harden .env without starting containers
./run-docker-full-stack.sh
```

The script reads root `.env` via `docker compose --env-file .env` and auto-generates secure `PRIVATE_SERVER_KEY`, `BETTER_AUTH_SECRET`, and `WEBHOOK_ENCRYPTION_KEY` values when missing. The `--provision-only` mode also randomizes first-run MinIO credentials, then exits before pulling images or starting services.

Published dashboard images target self-owned multi-tenant mode because public Svelte environment variables are fixed at build time. Set `PUBLIC_IS_SELFHOSTED=true` only when building a single-organization installation. Keep `PUBLIC_IS_SELF_OWNED=true` to use local entitlements without an external license or billing service.

See [`.env.example`](.env.example) for the full list of environment variables with required/optional grouping, and [`docker/docs/SELF_HOST.md`](docker/docs/SELF_HOST.md) for the complete Docker self-hosting guide. To raise upload caps (documents, videos, assignment files), set the `UPLOAD_MAX_*_MB` vars in `.env` — see the [docs](https://docs.classroom.tedydev.io.vn/docs/self-hosted/docker#optional--upload-file-size-limits).

## Publishing

When cutting releases for hosted assets or the npm MCP package, run:

- **Storybook** — `pnpm --filter @cio/storybook storybook:publish`
- **Course widget embed** — `pnpm --filter @cio/embeds embeds:publish`
- **Question type picker** — `pnpm --filter @cio/embeds embeds:publish` (same script builds and uploads both embeds)
- **MCP (`@tedydev/classroom-mcp`)** — bump the version in `packages/mcp/package.json`, then `pnpm mcp:build` and `pnpm --filter @tedydev/classroom-mcp publish`
