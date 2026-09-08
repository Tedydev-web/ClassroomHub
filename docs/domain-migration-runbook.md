# Domain migration runbook — moving the brand to `classroomhub.io.vn`

`classroom.io.vn` is where this deployment lives today. The brand is moving to
`classroomhub.io.vn`, and the old apex must keep answering for everyone who
already holds a link to it. This is the sequence for doing that without an
outage, and the reasoning behind each ordering constraint.

## The shape of the change

Two ideas do all the work:

- **One canonical apex, several accepted ones.** Every place that *emits* a URL
  uses the canonical domain, so visitors migrate on their own. Every place that
  *accepts* a hostname — CORS, trusted origins, tenant resolution, the check
  that stops a customer claiming a platform domain — accepts the whole list, so
  the old apex never stops working. `packages/utils/src/constants/domains.ts`
  holds both: `BRAND_ROOT_DOMAIN` plus `LEGACY_ROOT_DOMAINS`, with
  `isPlatformHost()` and `getTenantSiteNameFromHost()` as the only two things
  the acceptance sites call.
- **One Worker, two zones.** `apps/tenant-router` already terminates the whole
  zone and picks its upstream by request path. A second zone is added by
  extending `[env.production].routes` — not by a redirect layer and not by a
  second Worker. `wrangler deploy` reconciles routes against the environment it
  is given, so both zones must be listed in the same environment block or the
  deploy strips the one it did not name.

## What is *not* moving, and why

- **Tenant sites stay on `classroom.io.vn`.** `TENANT_ROOT_DOMAIN` is a separate
  constant for this reason. `msna.classroom.io.vn` is a live school; its address
  is in students' hands. Existing tenants keep the hostname they were given, and
  only new ones are created under the new apex.
- **Email does not move with the brand.** Mail is DKIM-signed for
  `classroom.io.vn` through `mail.classroom.io.vn`, and `support@classroom.io.vn`
  is a real mailbox. A new sending domain needs its own SPF, DKIM and DMARC plus
  reputation warm-up; until that is done, invites land in spam. Moving the
  sending domain is a separate project with its own verification.
- **`api.` and `assets.` are never redirected.** A 301 on a POST can drop the
  request body, and a redirect on an asset costs a round trip on every load.
  Both hosts answer directly on both apexes for as long as they are used.

## Preconditions

1. A Cloudflare API token with **Workers Scripts: Edit**. The current token in
   CI is R2-only, so nothing deploys today — the marketing site, docs and Help
   Center have not published since 27 Aug. Fix this first: everything below
   depends on being able to deploy.
2. `classroomhub.io.vn` added as a zone on the same Cloudflare account, with
   its nameservers live. It has no DNS records at all right now.

## Sequence

Each step is verified against production before the next one starts.

**1 — Zone and DNS.** Add the zone. Create the proxied records mirroring
`classroom.io.vn`: apex, `hub`, `api`, `play`, `embed`, `assets`. Verify each
resolves and Universal SSL has issued.

**2 — Routes, before any code changes.** Add to `[env.production].routes` in
`apps/tenant-router/wrangler.toml`:

```toml
{ pattern = "classroomhub.io.vn/*", zone_name = "classroomhub.io.vn" },
{ pattern = "*.classroomhub.io.vn/*", zone_name = "classroomhub.io.vn" }
```

and extend `DIRECT_PASSTHROUGH_HOSTS` and `MARKETING_HOSTS` with the new
hostnames. Deploy. Verify `https://classroomhub.io.vn` and
`https://hub.classroomhub.io.vn` both answer 200 while the old hosts still do.
Nothing in the application has changed yet, so this step is reversible by
deleting the routes.

**3 — Flip the constants.** Two lines in
`packages/utils/src/constants/domains.ts`:

```ts
export const BRAND_ROOT_DOMAIN = 'classroomhub.io.vn';
export const LEGACY_ROOT_DOMAINS: readonly string[] = ['classroom.io.vn'];
```

`TENANT_ROOT_DOMAIN` stays pointed at `'classroom.io.vn'` as its own literal.
Changing `BRAND_ROOT_DOMAIN` without adding the old apex to `LEGACY_ROOT_DOMAINS`
is what breaks the old domain — the two go together. `packages/utils/scripts/domains.test.ts`
covers the acceptance behaviour on every listed apex.

Also update, in the same change:

- `apps/dashboard/src/lib/utils/csp-domains.js` — hosts are literals there,
  because the module is loaded by `svelte-kit sync` during `pnpm install`,
  before any workspace package is built. Add the new hosts and keep the old ones
  while the old apex still serves. `csp.test.ts` compares them against
  `PRODUCT_HOSTS`.
- `apps/tenant-router` vars — `MARKETING_CANONICAL_HOST`, `APEX_REDIRECT_TARGET`.

**4 — Environment.** `DASHBOARD_ORIGIN`, `PUBLIC_SERVER_URL` and the tunnel
origins move to the new hostnames in the host environment file. Cookies are
host-scoped, so changing the dashboard origin signs everyone out — do it at a
low-traffic hour and say so in advance.

**5 — Redirect the brand hosts, not the service hosts.** Once the new hosts are
proven, 301 `classroom.io.vn` and `hub.classroom.io.vn` to their new
equivalents. Leave `api.`, `assets.`, `embed.` and every tenant subdomain
answering directly.

**6 — Retire the alias zone.** The `classroom-tenant-router` Worker (the
non-production one) still holds `*.tedydev.io.vn` routes on Cloudflare. The
config no longer describes it, but deleting the deployed Worker and its routes
is a dashboard action and needs a token with Workers Scripts: Edit.

## What the old domain is holding

Checked against the production database:

- **No stored absolute URL points at `tedydev.io.vn`.** A scan of every text
  column in `public` returned zero rows.
- **Media is stored as object keys, not absolute URLs.** Only four rows in the
  whole database contain `classroom.io.vn` — three avatar URLs and one
  verification value — plus analytics referrer hosts. A domain change does not
  strand uploaded media.
- **Two certificates have been issued**, and `course_certificate_issue.file_url`
  carries no hostname. The constraint is the URL printed on the rendered PDF,
  not a database row.

So the old apex is held by links people already have, not by stored data. That
is a reason to keep it answering indefinitely — it costs nothing — rather than a
reason to schedule a cutover.
