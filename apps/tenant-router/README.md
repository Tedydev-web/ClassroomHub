# @cio/tenant-router

Cloudflare Worker that fronts every browser-facing ClassroomHub host:

- `*.classroom.io.vn/*` — free-tier tenant sites
- `classroom.io.vn/*` — apex (301 → `classroom.io.vn`)
- `hub.classroom.io.vn/*` — admin dashboard
- `embed.classroom.io.vn/*` — public embed widget scripts (R2 `assets` bucket, path-for-path)
- BYOD customer domains via Approximated (their proxy forwards to `cio-api.onrender.com` directly, not through this Worker)

The Worker forwards each request to one of two Render services based on path:

| Host / path   | Upstream                                                                       |
| ------------- | ------------------------------------------------------------------------------ |
| `embed.*`     | R2 `assets` bucket — `/{widget}` maps to internal keys (`src/embed-assets.ts`) |
| `/proxy/*`    | API service (`/proxy` prefix stripped, rest forwarded as-is)                   |
| anything else | Dashboard service                                                              |

The `/proxy` prefix is the same-origin escape hatch the dashboard's
browser code uses so its auth cookies stay host-only while still reaching
the API. Example: a browser request to
`https://hub.classroom.io.vn/proxy/api/auth/sign-in/email` becomes
`/api/auth/sign-in/email` on the API service (where Better Auth lives).

It preserves the original host as `X-Forwarded-Host` so:

- The dashboard's SvelteKit adapter-node reads it via `HOST_HEADER=x-forwarded-host` and `event.url.host` becomes the tenant/admin/BYOD host.
- Better Auth on the API emits session cookies without a `Domain` attribute (see `packages/db/src/auth.ts` — `crossSubDomainCookies: { enabled: false }`), so the browser scopes each session to the exact host it called. Tenants on `acme.classroom.io.vn`, the admin app on `hub.classroom.io.vn`, and BYOD `learn.acme.com` each get host-only sessions.

## Deploy

```bash
pnpm --filter @cio/tenant-router deploy
```

Live tail:

```bash
pnpm --filter @cio/tenant-router tail
```

## Env vars (wrangler.toml `[vars]`)

| Var                       | Value                                                                           |
| ------------------------- | ------------------------------------------------------------------------------- |
| `DASHBOARD_UPSTREAM_HOST` | `.onrender.com` host of the dashboard service (no scheme)                       |
| `API_UPSTREAM_HOST`       | `.onrender.com` host of the API service                                         |
| `APEX_REDIRECT_TARGET`    | URL to redirect `classroom.io.vn` apex to (default `https://classroom.io.vn`) |
| `EMBED_HOST`              | Hostname for public embed widgets (default `embed.classroom.io.vn`)             |
| `API_URL`                 | API origin injected into embed scripts as `window.CIO.apiBaseUrl`               |

Update the values in `wrangler.toml` after looking them up in the Render dashboard.

## Cloudflare DNS expected setup

`classroom.io.vn` zone:

- `*` CNAME → any valid target, **Proxied**
- `@` CNAME → any valid target, **Proxied** (Worker serves the 301)

`classroom.io.vn` zone:

- `app` CNAME → **Proxied** so the route binds
- `embed` CNAME → **Proxied** (serves `embeds/*` from R2 via Worker)
- `api` CNAME → **DNS only** (server-to-server callers and webhooks bypass the Worker)

## BYOD custom domains

Handled by [Approximated](https://approximated.app/), not this Worker. Cloudflare for SaaS can't front a Render origin (Render itself runs on Cloudflare), so we use Approximated's dedicated edge cluster instead. See `apps/api/src/services/org/domain.ts` for the integration. Customers point an A record at the IP Approximated returns; the proxy forwards directly to `cio-api.onrender.com`.
