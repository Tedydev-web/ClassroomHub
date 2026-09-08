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
2. Zone permissions on the token: **Zone → DNS → Edit** and **Zone → Workers
   Routes → Edit**, with zone resources covering *both* `classroom.io.vn` and
   `classroomhub.io.vn`. An account-scoped token lists the zones but cannot read
   or write a single record in them, which is most of this runbook.

## Sequence

Each step is verified against production before the next one starts.

**1 — DNS. Done.** Seven proxied records on `classroomhub.io.vn`: the apex,
`*`, `hub`, `embed`, `learn` and `play` as CNAMEs to the same Cloudflare Tunnel
the old zone uses, and `assets` to `public.r2.dev`. The wildcard is what serves
tenants, so no record is needed per org.

Universal SSL only begins validating once a zone has proxied records, so the
certificate is issued *after* this step, not before it — the hostnames fail the
TLS handshake outright until it does, which looks like an outage rather than a
wait.

Mail was deliberately not mirrored. The MX, SPF and both DKIM records stay on
`classroom.io.vn`; see below.

**2 — Routes and the Worker's host lists. Done.** Both zones are routed from
the one `[env.production]` block, and `ASSET_HOST`, `EMBED_HOST`,
`APEX_REDIRECT_HOST`, `DIRECT_PASSTHROUGH_HOSTS` and `MARKETING_HOSTS` all name
the hosts on both apexes. `src/host-lists.test.ts` fails if a routed zone is
missing from any of them.

`MARKETING_CANONICAL_HOST` still points at the old apex, so the new one currently
redirects there. That is the intended intermediate state: it proves the routing
without the site advertising a domain its own rendered links do not use.

**How the hosts actually reach an origin**, because it decides what a new zone
needs: the tunnel has ingress rules for only three `classroom.io.vn`
hostnames — `dashboard-origin`, `api-origin` and `api`. The apex, `hub` and every
tenant point at the tunnel in DNS, but the Worker route intercepts them at the
edge and they never reach it. So a second zone needs no tunnel change at all,
except for `api`, which is in `DIRECT_PASSTHROUGH_HOSTS` and therefore does go to
the tunnel: `api.classroomhub.io.vn` was added to the tunnel's ingress. Without
it that host would have fallen through to tenant routing and been served as an
org called `api`.

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
