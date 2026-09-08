# Domain migration — the complete surface

Everything that knows this deployment's hostname, grouped by what it takes to
change it. Compiled by scanning the repository, the production environment file,
the production database and the Cloudflare account on 8 Sep 2026 — not from
memory. The sequence for executing the move is in
[domain-migration-runbook.md](domain-migration-runbook.md); this file is the
inventory that sequence has to cover.

## 0. Blocked on a token

The account token now in CI carries account-level Workers permissions and can
deploy `cio-docs`, `cio-help` and `cio-web` — verified by deploying `cio-docs`
from this machine. It carries **no zone permissions at all**: `dns_records`,
`workers/routes`, `settings` and `ssl/certificate_packs` each return an
authentication error on *both* zones.

Needed to proceed past section 2: **Zone → DNS → Edit** and **Zone → Workers
Routes → Edit**, with zone resources including both `classroom.io.vn` and
`classroomhub.io.vn`.

Both tokens supplied so far were pasted into a chat transcript and must be
revoked once a scoped replacement is in place.

**Set the token on the `production` environment, not only on the repository.**
Every deploy job in `deploy-docs.yml` declares `environment: production`, and an
environment secret shadows the repository secret of the same name. The
environment's `CLOUDFLARE_API_TOKEN` had been sitting at its 24 Jul value; a
repository-level update changed nothing and the deploy kept failing with
`Invalid access token [code: 9109]` against a token that worked from a laptop.

## 1. Follows the constant — no edit needed

175 references across `apps/` and `packages/` read `PRODUCT_ROOT_DOMAIN`,
`BRAND_ROOT_DOMAIN`, `TENANT_ROOT_DOMAIN`, `PRODUCT_HOSTS` or `PRODUCT_URLS`.
These move when the constant moves. The acceptance sites — API CORS, Better Auth
trusted origins, the BYOD rejection, tenant resolution from a hostname, the
dashboard's custom-domain check — read `ACCEPTED_ROOT_DOMAINS` /
`isPlatformHost()` and therefore keep answering on the old apex as well.

## 2. Cloudflare — the infrastructure

| Thing | State today |
|---|---|
| Zone `classroom.io.vn` | active, NS `brady`/`vida.ns.cloudflare.com` |
| Zone `classroomhub.io.vn` | active, same NS pair, **zero DNS records** |
| Worker `classroom-tenant-router-production` | serves `classroom.io.vn/*` and `*.classroom.io.vn/*` |
| Worker `classroom-tenant-router` | still deployed with `*.tedydev.io.vn` routes — to delete |
| Workers `cio-web`, `cio-docs`, `cio-help` | no zone routes; reached through the tenant router and the `DOCS` service binding |
| Tunnel `tedydev.io.vn` | healthy, carries the dashboard and API origins |

Work: create the records on the new zone mirroring the old one's proxied flags;
add both zones' routes to `[env.production].routes` in one environment block;
delete the alias Worker and the alias tunnel hostnames.

## 3. Production environment file

Seven keys on the host hold the domain. `DASHBOARD_ORIGIN`, `PUBLIC_SERVER_URL`
and `PRIVATE_APP_HOST` move with the brand. `OBJECT_STORAGE_MEDIA_PUBLIC_BASE_URL`
moves only after `assets.` answers on the new apex, and the old host must keep
serving because it is the base for URLs already handed out.

`SMTP_HOST`, `SMTP_USER` and `SMTP_SENDER` **do not move in this project.** DKIM
is established for `classroom.io.vn`; a new sending domain needs its own SPF,
DKIM and DMARC plus warm-up, and until that is done invites land in spam.

Cookies are host-scoped, so changing `DASHBOARD_ORIGIN` signs every session out.
Schedule it and say so in advance.

## 4. Hardcoded literals the constant does not reach

These are real emit sites, not comments or fixtures. Each needs a hand edit or a
switch to the constant:

- `apps/admin/src/routes/orgs/new/+page.svelte` — the tenant URL preview and the
  link to the created org, twice plus a placeholder.
- `apps/admin/src/routes/users/[userId]/+page.svelte:193` — the org's site host.
- `apps/course-app/src/lib/components/navigation/navigation.svelte:19` — the
  "powered by" link.
- `packages/course-app/src/template/src/lib/components/{bootcamp,classic,examprep,minimal,posthog,webflow}/Footer.svelte`
  — seven links across six templates.
- `packages/course-app/src/template/src/lib/data/pages.json` — `url`, `appUrl`
  and three nav links. Two point at `/blog`, which no longer exists.
- `apps/api/scripts/upload-openapi-spec.ts:151` — the API server URL in the
  published OpenAPI document.

**`apps/jobs/.../notify-session-update.ts` and `session-reminder-scan.ts` build
iCalendar UIDs as `session-<id>@classroom.io.vn`. Leave them alone.** A UID is
the identity a calendar client uses to recognise an update to an event it
already has; changing the domain in it turns every future reminder into a
duplicate event rather than an update to the existing one.

## 5. Third-party consoles — outside this repository

Nothing here can be changed by deploying. Each needs a visit to its console, and
each is a silent failure if missed:

- **Google OAuth** (`GOOGLE_CLIENT_ID`) — authorised redirect URIs and JavaScript
  origins must list the new host before the dashboard moves, or sign-in breaks.
- **Polar** — checkout success/cancel URLs and the webhook endpoint.
- **Approximated** — the BYOD vhost provider the API talks to for customer
  domains.
- **PostHog / Sentry** — allowed origins, so events are not dropped.
- **Search Console / analytics** — add the new property, and submit a change of
  address once the 301s are live.

## 6. Not domain work, still open

Carried from earlier sessions so they are not lost:

- The dashboard CSP fix is committed but reaches production only on the next
  build of the dashboard image.
- `brand.cdn.clsrio.com` — upstream's CDN — still serves two images in the Help
  Center. Replacing them needs screenshots of this deployment.
- Two exercises with zero submissions are unresolved: `MOCK TEST 1` (`b68c4385`)
  and `Test 01` (`0ab21b09`).

## What the old domain is actually holding

From the production database: **no stored URL points at `tedydev.io.vn`**, and
only four rows in the entire schema contain `classroom.io.vn` — three avatars
and one verification value — plus analytics referrer hosts. Media is stored as
object keys. Two certificates have been issued and neither stores a hostname.

So the old apex is held by links people already have, not by stored data. Keep
it answering indefinitely; there is no cutover to schedule.
