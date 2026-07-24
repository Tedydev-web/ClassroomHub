# Super Admin Panel PRD

## Purpose

Build a password-gated super admin panel that lets the ClassroomHub operator manage all users across the database without needing a user account. Use cases:

1. **User management** — view a paginated, searchable table of every user; open individual profile pages with stats
2. **AI chat inspection** — view all AI assistant conversations for any user and copy an entire chat transcript with one click
3. **Credit management** — top up AI credits for any org directly from the panel
4. **Org creation** — create a new organization and assign an existing user as its admin
5. **Impersonation** — "Login as" any user to act on their behalf on `classroom-app.tedydev.io.vn`
6. **AI gateway operations** — monitor and control the shared CCS Codex gateway that every org/tenant runs on: health, quota window, per-org consumption and priority, kill switch, and cross-org run inspection

The panel has no user account of its own. Access is controlled by a single `SUPER_ADMIN_PASSWORD` env var, mirroring the existing `/admin/queues` pattern. It ships as a **separate app** (`apps/admin/`) so it never bloats the user-facing dashboard bundle and can be deployed independently.

---

## Implementation Status

_Last verified 2026-07-24 at the file / route-mount / middleware level. `apps/admin`: `svelte-check` 0 errors, `vitest` 13/13 pass, `build` (adapter-node) succeeds._

| Phase | Scope | Status |
| --- | --- | --- |
| Phase 1 — API layer | env var, `superAdminMiddleware`, admin queries / services / routes, mounted at `/admin` | ✅ Done |
| Phase 2 — `apps/admin` app | scaffold, password gate, users table + profile (chats, credits, impersonate), create-org, dark mode | ✅ Done |
| Phase 3 — AI gateway | `ai_gateway_settings` + `ai_gateway_org_policy` tables, validation, `/admin/ai/*` routes, 3 operator screens + nav | ✅ Core done — gaps below |

### Verified present

- **Auth**: `superAdminMiddleware` (timing-safe `X-Super-Admin-Key`) applied on both `adminRouter` (`/admin/*`) and `adminAiRouter` (`/admin/ai/*`). Gateway secrets returned only through `getRedactedGatewaySettings`.
- **Phase 3 routes**: all 11 endpoints exist and are mounted — `GET /ai/health|quota|settings|orgs|runs`, `PATCH /ai/settings|orgs/:orgId`, `POST /ai/pause|resume|breaker/reset|runs/:runId/cancel`.
- **Phase 3 screens**: `/ai` (health checks + quota windows + kill-switch pause/resume/breaker-reset), `/ai/orgs` (per-org priority-weight edit + block/unblock + limits), `/ai/runs` (list + status-filter tabs + force-cancel). Nav has an "AI Gateway" group with Overview / Organizations / Runs sub-tabs.

### Deferred / not implemented

- **Audit trail** for `pause` / `resume` / `priorityWeight` / `block` — not built. PRD §3e flagged this as an open question in the brainstorm report; there is no `ai_gateway_audit` table, route, or UI. (The `*_invite_audit` tables in the codebase are unrelated — they trail course/org invites.)
- **Live-load panel** on `/ai` (§3d.5: global concurrency in use, active/queued totals) — not surfaced.
- **Run-event expansion** on `/ai/runs` (§3d: expand a row to recent `ai_agent_run_event` for triage) — not implemented. List, status filter, and force-cancel are present.
- **Settings editor UI** — `PATCH /admin/ai/settings` exists on the API, but there is no allowlist / concurrency / window editor screen. Intentionally out of scope this round; operate via curl / `ccs` CLI.
- **Slice-boundary pause messaging** (§3e) — the UI does not yet state that pause takes effect at the next slice boundary rather than mid-tool-call.

### Deviations from the plan (implemented, different shape than "Files to Create")

- Gateway settings + window-consumption logic lives in `@cio/core/services/agent/gateway-settings-store` and `gateway-runtime`, not the PRD-listed `packages/db/src/queries/admin/ai-gateway.ts`. Deliverable met; file path differs.
- `/admin/ai` is mounted directly in `app.ts` with its own `superAdminMiddleware`, kept separate from the aggregate `adminRouter`, rather than nested inside it. Auth is enforced either way.

---

## Confirmed Decisions

1. **Separate app**: `apps/admin/` — own SvelteKit app, own `package.json`, own deployment. Zero code shared with `apps/dashboard/` at the bundle level.
2. **Auth pattern**: `X-Super-Admin-Key` request header checked against `SUPER_ADMIN_PASSWORD` env var via timing-safe comparison on the API side. Same approach as `QUEUE_DASHBOARD_PASSWORD` in `apps/api/src/routes/admin/queues.ts`.
3. **Password gate UX**: Custom login form in the admin app. Password stored in `sessionStorage` — survives page refresh, cleared on tab close.
4. **API proxy**: `apps/admin/src/hooks.server.ts` forwards `/api/*` → `PRIVATE_SERVER_URL`. Client code calls `/api/admin/users` etc. No tenant routing complexity needed — this is internal only.
5. **Impersonation**: Reuses `mintLoginLinkToken` from `packages/db/src/auth/login-link.ts`. Admin opens the resulting URL (`https://classroom-app.tedydev.io.vn/api/auth/login-link?token=...&redirect=/home`) in a new tab. TTL: 60 minutes.
6. **AI credits**: `aiCreditBalance` is per-org. The UI shows a user's admin orgs with current credit balance; operator enters an amount to add. Calls existing `upsertCreditBalance` query.
7. **Org creation**: Reuses `createOrganization` + `createOrganizationMember` query pattern, accepting a target `userId` instead of the session user.
8. **AI gateway is platform-scoped, not org-scoped**: the CCS Codex gateway is a singleton backed by one shared ChatGPT subscription. Its health, quota window, and controls belong to the super admin panel — never to org-level admin UI. Org admins cannot act on it, and exposing shared-pool numbers to them would leak cross-tenant consumption.
9. **API-first delivery**: `/admin/ai/*` endpoints ship before the UI so the operator has a kill switch and health signal from day one (curl + `ccs` CLI + existing `/admin/queues`). The admin app screens described in Phase 3 are built afterwards against the same contract.

---

## Architecture

```mermaid
flowchart LR
    subgraph adminApp ["apps/admin/ (standalone SvelteKit)"]
        Gate[Password Gate\nsessionStorage]
        UsersPage[Users Table]
        ProfilePage[User Profile\n+ Chats + Credits]
        NewOrgPage[Create Org Form]
        Proxy["hooks.server.ts\n/api/* → PRIVATE_SERVER_URL"]
    end

    subgraph api ["apps/api/ /admin/*"]
        Middleware[superAdminMiddleware\nX-Super-Admin-Key]
        UsersRouter[/admin/users/**]
        OrgsRouter[/admin/orgs/**]
    end

    subgraph existing [Existing packages]
        LoginLink[mintLoginLinkToken]
        CreditBalance[upsertCreditBalance]
        OrgCreate[createOrganization]
    end

    Gate -->|header via Proxy| Middleware
    Middleware --> UsersRouter
    Middleware --> OrgsRouter
    UsersRouter -->|impersonate| LoginLink
    OrgsRouter -->|credits| CreditBalance
    OrgsRouter -->|create| OrgCreate
```

---

## Phase 1: API Layer

### 1a. Env Config

**`packages/core/src/config/env.ts`** — add alongside `QUEUE_DASHBOARD_PASSWORD`:

```typescript
SUPER_ADMIN_PASSWORD: z.string().optional(),
```

### 1b. Super Admin Middleware

**`apps/api/src/middlewares/super-admin.ts`** (new file)

```typescript
import type { Context, Next } from 'hono';
import { env } from '@cio/core/config/env';

export async function superAdminMiddleware(c: Context, next: Next): Promise<Response | void> {
  const expected = env.SUPER_ADMIN_PASSWORD;

  if (!expected) {
    if (env.NODE_ENV !== 'production') return next();
    return c.json({ success: false, error: 'Super admin not configured' }, 503);
  }

  const key = c.req.header('X-Super-Admin-Key');
  if (!key || !timingSafeEqual(key, expected)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  return next();
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
```

### 1c. DB Queries

**`packages/db/src/queries/admin/users.ts`** (new file)

```typescript
listUsers({ page, limit, search }: { page: number; limit: number; search?: string })
  → Promise<{ users: AdminUserRow[]; total: number }>
```
- LEFT JOIN `user` + `profile` on `profile.id = user.id`
- Subquery count of `organizationmember` per user → `orgCount`
- Subquery count of `groupmember` per profile → `courseCount`
- WHERE `user.name ILIKE '%search%' OR user.email ILIKE '%search%'` when search provided
- ORDER BY `user.createdAt DESC`, LIMIT / OFFSET for pagination

```typescript
getUserWithStats(userId: string) → Promise<AdminUserWithStats | null>
```
- Same joins plus: admin org count (`roleId = 1`), total org count, total course enrollments
- Include each admin org's `aiCreditBalance` (for the credits section)

**`packages/db/src/queries/admin/chats.ts`** (new file)

```typescript
listUserChats(userId: string) → Promise<ChatSummary[]>
// SELECT id, title, course_id, updated_at, jsonb_array_length(messages) as message_count
// FROM ai_chat_conversation WHERE user_id = userId ORDER BY updated_at DESC

getUserChat(conversationId: string, userId: string) → Promise<ChatConversation | null>
// Full row including messages JSONB WHERE id = conversationId AND user_id = userId
```

**`packages/db/src/queries/admin/orgs.ts`** (new file)

```typescript
createOrgWithAdmin({ name, siteName, profileId })
  → Promise<{ org: Organization; member: OrganizationMember }>
// Transaction: createOrganization + createOrganizationMember(roleId = ROLE.ADMIN, verified = true)
// Same pattern as apps/api/src/services/organization.ts
```

### 1d. Validation

**`packages/utils/src/validation/admin/admin.ts`** (new file)

```typescript
export const ZListUsersQuery = z.object({
  page: z.string().transform(Number).pipe(z.number().min(1)).default('1'),
  limit: z.string().transform(Number).pipe(z.number().min(1).max(100)).default('20'),
  search: z.string().optional()
});

export const ZAddCredits = z.object({ amount: z.number().int().positive() });

export const ZCreateAdminOrg = z.object({
  name: z.string().min(5),
  siteName: z.string().min(5),
  ownerUserId: z.string().uuid()
});
```

### 1e. Services

**`apps/api/src/services/admin/users.ts`** (new file)
- `listAdminUsers(params)` — calls `listUsers` query
- `getAdminUserStats(userId)` — calls `getUserWithStats`; throws `AppError` 404 if not found
- `listAdminUserChats(userId)` — calls `listUserChats`
- `getAdminUserChat(conversationId, userId)` — calls `getUserChat`; throws 404 if not found
- `impersonateUser(userId)` — fetches `user.email` from DB, calls `mintLoginLinkToken({ userId, email, ttlMinutes: 60 })`, returns `{ loginUrl }`

**`apps/api/src/services/admin/orgs.ts`** (new file)
- `addOrgCredits(orgId, amount)` — calls `upsertCreditBalance(orgId, amount)` from `packages/db/src/queries/agent/token-usage.ts`
- `createOrgForUser(data)` — resolves `ownerUserId` → `profileId`, checks siteName uniqueness (409 if taken), calls `createOrgWithAdmin`

### 1f. Routes

**`apps/api/src/routes/admin/users.ts`** (new file)
```
GET  /users                        listAdminUsers (ZListUsersQuery)
GET  /users/:userId                getAdminUserStats
POST /users/:userId/impersonate    impersonateUser → { loginUrl }
GET  /users/:userId/chats          listAdminUserChats
GET  /users/:userId/chats/:chatId  getAdminUserChat
```

**`apps/api/src/routes/admin/orgs.ts`** (new file)
```
POST /orgs                 createOrgForUser (ZCreateAdminOrg)
POST /orgs/:orgId/credits  addOrgCredits (ZAddCredits)
```

**`apps/api/src/routes/admin/index.ts`** (new file)
```typescript
import { Hono } from '@api/utils/hono';
import { superAdminMiddleware } from '@api/middlewares/super-admin';
import { adminUsersRouter } from './users';
import { adminOrgsRouter } from './orgs';

export const adminRouter = new Hono()
  .use('/*', superAdminMiddleware)
  .route('/', adminUsersRouter)
  .route('/', adminOrgsRouter);
```

### 1g. Register in app.ts

```typescript
import { adminRouter } from '@api/routes/admin';
// in the RPC chain:
.route('/admin', adminRouter)
```

`mountQueueDashboard(app)` stays untouched — its `/admin/queues/*` paths don't conflict.

### 1h. Build

```bash
pnpm --filter @cio/api build
```

---

## Phase 2: apps/admin — Standalone SvelteKit App

### 2a. App scaffold

**`apps/admin/`** — new workspace package

```
apps/admin/
  package.json
  svelte.config.js
  vite.config.ts
  tsconfig.json
  .env.example
  src/
    app.html
    hooks.server.ts          ← forwards /api/* to PRIVATE_SERVER_URL
    routes/
      +layout.svelte         ← password gate + nav
      +layout.ts             ← ssr: false
      +page.svelte           ← redirect to /users
      users/
        +page.svelte         ← paginated users table
        [userId]/
          +page.svelte       ← user profile
      orgs/
        new/
          +page.svelte       ← create org form
    lib/
      api.svelte.ts          ← AdminApi class
      types.ts               ← plain TS types (no RPC inference — standalone app)
```

**`package.json`**:
```json
{
  "name": "@cio/admin",
  "version": "0.0.1",
  "scripts": {
    "dev": "vite dev --port 5174",
    "build": "vite build",
    "preview": "vite preview",
    "start": "node build/index.js"
  },
  "dependencies": {
    "@sveltejs/kit": "...",
    "@sveltejs/adapter-node": "...",
    "svelte": "..."
  }
}
```

**`svelte.config.js`**: adapter-node, no CSP complexity, alias `$lib` → `./src/lib`

**`.env.example`**:
```
PRIVATE_SERVER_URL=http://localhost:3002
PUBLIC_APP_URL=https://classroom-app.tedydev.io.vn
```

### 2b. API proxy

**`src/hooks.server.ts`**

```typescript
import type { Handle } from '@sveltejs/kit';

const API_PREFIX = '/api';

export const handle: Handle = async ({ event, resolve }) => {
  if (event.url.pathname.startsWith(API_PREFIX)) {
    const upstream = process.env.PRIVATE_SERVER_URL;
    if (!upstream) return new Response('API not configured', { status: 502 });

    const upstreamUrl = new URL(
      event.url.pathname.slice(API_PREFIX.length) + event.url.search,
      upstream
    );

    const headers = new Headers(event.request.headers);
    headers.set('host', upstreamUrl.host);

    return fetch(upstreamUrl, {
      method: event.request.method,
      headers,
      body: event.request.method !== 'GET' ? event.request.body : undefined,
      // @ts-ignore
      duplex: 'half'
    });
  }

  return resolve(event);
};
```

### 2c. API class

**`src/lib/api.svelte.ts`**

`AdminApi` class — stores `password: string`, appends `'X-Super-Admin-Key': password` header to every fetch.

Methods:
- `listUsers(page, search?)` → `GET /api/admin/users`
- `getUser(userId)` → `GET /api/admin/users/:userId`
- `loginAsUser(userId)` → `POST /api/admin/users/:userId/impersonate` → `window.open(data.loginUrl, '_blank')`
- `listChats(userId)` → `GET /api/admin/users/:userId/chats`
- `getChat(userId, chatId)` → `GET /api/admin/users/:userId/chats/:chatId`
- `addCredits(orgId, amount)` → `POST /api/admin/orgs/:orgId/credits`
- `createOrg(data)` → `POST /api/admin/orgs`

Uses plain `fetch` (no Hono RPC client — standalone app has no `@cio/api` dep). Types defined locally in `src/lib/types.ts`.

### 2d. Password gate layout

**`src/routes/+layout.ts`**: `export const ssr = false;`

**`src/routes/+layout.svelte`**:
- On mount: read `sessionStorage.getItem('super-admin-pw')`
- If absent: render centered password form (input + submit button)
- On submit: `GET /api/admin/users?limit=1` with `X-Super-Admin-Key` header
  - 401 → show inline error
  - 200 → store in sessionStorage, show children
- Pass password to all child pages via Svelte context (`setContext`)
- Top nav: "ClassroomHub Admin" | Users | Create Org | Sign out (clears sessionStorage + reloads)

### 2e. Pages

**`/` (+page.svelte)**: redirect to `/users`

**`/users` (+page.svelte)** — Users table

DataTable columns: Avatar | Name | Email | Joined | Orgs | Courses | Verified | Banned | Actions

- Search input (debounced 300 ms), pagination controls
- Row actions: "View" → `/users/[id]`; "Login as" inline button

**`/users/[userId]` (+page.svelte)** — User profile

1. **Header**: avatar, full name, email, joined date, verified/banned badges + "Login as user" button
2. **Stats grid** (4 tiles): Orgs (member), Orgs (admin), Courses enrolled, Account status
3. **AI Chats**: conversation list → click to expand inline messages → "Copy chat" button formats as plain text and calls `navigator.clipboard.writeText`
4. **Orgs & Credits**: table of admin orgs with current credit balance + "Add credits" per row (inline number input → confirm)

**`/orgs/new` (+page.svelte)** — Create org

Fields: Org name, Site name, Owner user ID. On submit → success state with "Login as owner" shortcut.

---

## Phase 3: AI Gateway Operations

Design source: [`plans/reports/brainstorm-260723-1633-GH-2026-ccs-codex-shared-gateway-architecture.md`](../../plans/reports/brainstorm-260723-1633-GH-2026-ccs-codex-shared-gateway-architecture.md)

### Why this lives in super admin

Every org/tenant runs on **one shared ChatGPT subscription** through a CCS/CLIProxy Codex sidecar. That gateway is a platform singleton:

- Its quota is finite, time-windowed, and shared — one org's burn reduces everyone else's headroom.
- Org admins cannot fix an expired OAuth session, a tripped breaker, or an exhausted quota window.
- Showing "shared quota 87%" inside an org dashboard leaks cross-tenant consumption and implies capacity the org does not own.

Split the surfaces:

| Plane | Audience | Shows |
| --- | --- | --- |
| Control plane (this phase) | Super admin | health, quota window, per-org consumption + priority, pause, allowlist, run inspection |
| Status signal (org UI, separate work) | Teachers / org admins | abstracted state only — "AI is busy, you are #3 in queue", "AI paused, try later" |

### 3a. Backing tables

Two new tables (full column list in the brainstorm report):

- **`ai_gateway_settings`** — single row. `enabled`, `pausedAt` / `pauseReason` / `pausedBy`, `modelAllowlist` (jsonb: `modelId`, `label`, `quotaWeight`, `role`), `defaultModelId`, `lightModelId`, `globalConcurrency`, `sliceRounds`, `chatConcurrencyPerOrg`, per-org defaults, `windowStartsAt` / `windowDurationMinutes`, breaker state (`circuitState`, `circuitResumeAfter`, `consecutiveFailures`).
- **`ai_gateway_org_policy`** — one row per org, created lazily. `priorityWeight`, `maxActiveRuns`, `maxQueuedRuns`, `windowBudgetUnits`, `isBlocked`, `blockReason`.

Consumption is **derived**, not duplicated — sum `cost_units` from the existing `ai_token_usage` filtered by gateway models and `windowStartsAt`.

Secrets (`AI_GATEWAY_BASE_URL`, `AI_GATEWAY_AUTH_TOKEN`, optional `CCS_MANAGEMENT_SECRET`) stay in env and are never returned by any endpoint.

### 3b. API routes

**`apps/api/src/routes/admin/ai.ts`** (new file), mounted under the existing `superAdminMiddleware`:

```
GET   /ai/health               gateway reachability, auth state, model probe, breaker state
GET   /ai/quota                window accounting + optional CCS snapshot
GET   /ai/settings             current config (secrets redacted)
PATCH /ai/settings             allowlist, concurrency, sliceRounds, budgets, window
POST  /ai/pause                kill switch — `reason` required
POST  /ai/resume               clear pause
POST  /ai/breaker/reset        manual breaker reset
GET   /ai/orgs                 per-org consumption, policy, active/queued counts
PATCH /ai/orgs/:orgId          priorityWeight, limits, block/unblock
GET   /ai/runs                 cross-org run list, filter by status
POST  /ai/runs/:runId/cancel   force-cancel any org's run
```

Health probe is layered, cheapest first:

1. `GET {baseURL}/v1/models` with the gateway key → reachability + key validity.
2. Tiny completion probe against the light model → real Codex OAuth availability.
3. CCS management API read when `CCS_MANAGEMENT_SECRET` is set → quota snapshot.

Layer 3 is **best-effort**. CCS itself warns that its quota view omits live in-proxy 429 cooldowns, so treat it as advisory; the authoritative signal is an actual 429.

> ⚠️ Do not build the model picker from `GET /v1/models`. CLIProxy advertises its full static catalog (including Claude models) even when only Codex is authenticated. The DB `modelAllowlist` is the only source of truth.

### 3c. Validation

**`packages/utils/src/validation/admin/ai-gateway.ts`** (new file)

```typescript
export const ZGatewayPause = z.object({ reason: z.string().min(3).max(500) });

export const ZGatewaySettingsPatch = z.object({
  enabled: z.boolean().optional(),
  defaultModelId: z.string().optional(),
  lightModelId: z.string().optional(),
  modelAllowlist: z.array(z.object({
    modelId: z.string().min(1),
    label: z.string().min(1),
    quotaWeight: z.number().positive(),
    role: z.enum(['default', 'light', 'optional'])
  })).optional(),
  globalConcurrency: z.number().int().min(1).max(8).optional(),
  sliceRounds: z.number().int().min(1).max(12).optional(),
  chatConcurrencyPerOrg: z.number().int().min(1).max(10).optional(),
  defaultOrgActiveLimit: z.number().int().min(1).max(10).optional(),
  defaultOrgQueuedLimit: z.number().int().min(1).max(50).optional(),
  defaultOrgWindowBudget: z.number().int().positive().nullable().optional(),
  windowDurationMinutes: z.number().int().min(30).max(10_080).optional()
}).refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });

export const ZGatewayOrgPolicyPatch = z.object({
  priorityWeight: z.number().int().min(1).max(100).optional(),
  maxActiveRuns: z.number().int().min(1).max(10).nullable().optional(),
  maxQueuedRuns: z.number().int().min(1).max(50).nullable().optional(),
  windowBudgetUnits: z.number().int().positive().nullable().optional(),
  isBlocked: z.boolean().optional(),
  blockReason: z.string().max(500).nullable().optional()
}).refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
```

### 3d. Admin app screens

**`/ai` (+page.svelte)** — Gateway overview

1. **Status banner**: green healthy / amber cooling / red paused-or-down. Shows breaker state and `resumeAfter` countdown when tripped.
2. **Kill switch**: prominent Pause button with a required reason field; Resume when paused. Displays who paused it and when.
3. **Quota window**: window start, elapsed/remaining, consumed cost units vs soft cap, and the CCS snapshot when available (clearly labelled advisory).
4. **Health checks**: three-row list (reachability, auth probe, model probe) with last-checked timestamp and a Re-check button.
5. **Live load**: global concurrency in use, total active runs, total queued runs.

**`/ai/orgs` (+page.svelte)** — Per-org consumption and policy

Table columns: Org | Consumed units (window) | Share % | Priority weight | Active | Queued | Status | Actions

- Sorted by consumption desc so the heaviest tenant is obvious.
- Inline edit for `priorityWeight` (the weighted-fair-queue knob), active/queued limits, and window budget.
- Block/unblock with reason.
- Empty-state note explaining that a missing row means org defaults apply.

**`/ai/runs` (+page.svelte)** — Cross-org run inspection

Table columns: Run | Org | Course | Status | Phase | Rounds used | Updated | Actions

- Status filter chips: running, queued, quota_exhausted, paused, failed, completed.
- Force-cancel action with confirmation.
- Row expands to the run's recent `ai_agent_run_event` entries for triage.

Nav gains an "AI Gateway" group with the three pages above.

### 3e. Operational guardrails

- Pause takes effect at the next slice boundary, not mid-tool-call — the UI must say so rather than implying instant abort.
- `pause` / `resume` / `priorityWeight` / `block` changes should be written to an audit trail (open question in the brainstorm report).
- Never render `AI_GATEWAY_AUTH_TOKEN`, `CCS_MANAGEMENT_SECRET`, or any OAuth token in the UI or API responses.
- The `ccs-auth` Docker volume holds OAuth access + refresh tokens; it is a secret store and must never be mounted into the API or admin containers.

---

## Files to Create

### API (apps/api)
| File | Purpose |
| --- | --- |
| `packages/core/src/config/env.ts` | +1 line: `SUPER_ADMIN_PASSWORD` |
| `packages/db/src/queries/admin/users.ts` | `listUsers`, `getUserWithStats` |
| `packages/db/src/queries/admin/chats.ts` | `listUserChats`, `getUserChat` |
| `packages/db/src/queries/admin/orgs.ts` | `createOrgWithAdmin` |
| `packages/utils/src/validation/admin/admin.ts` | `ZListUsersQuery`, `ZAddCredits`, `ZCreateAdminOrg` |
| `apps/api/src/middlewares/super-admin.ts` | `superAdminMiddleware` |
| `apps/api/src/services/admin/users.ts` | User + chat + impersonation services |
| `apps/api/src/services/admin/orgs.ts` | Credits + org creation services |
| `apps/api/src/routes/admin/users.ts` | User/chat/impersonate routes |
| `apps/api/src/routes/admin/orgs.ts` | Org/credits routes |
| `apps/api/src/routes/admin/index.ts` | Aggregate admin router |

### AI Gateway (Phase 3)
| File | Purpose |
| --- | --- |
| `packages/db/src/schema.ts` | +2 tables: `ai_gateway_settings`, `ai_gateway_org_policy` |
| `packages/db/src/queries/admin/ai-gateway.ts` | Settings read/update, org policy upsert, window consumption aggregate |
| `packages/utils/src/validation/admin/ai-gateway.ts` | `ZGatewayPause`, `ZGatewaySettingsPatch`, `ZGatewayOrgPolicyPatch` |
| `apps/api/src/services/admin/ai-gateway.ts` | Health probe, quota view, pause/resume, breaker reset, run cancel |
| `apps/api/src/routes/admin/ai.ts` | `/admin/ai/*` routes |
| `apps/admin/src/routes/ai/+page.svelte` | Gateway overview + kill switch |
| `apps/admin/src/routes/ai/orgs/+page.svelte` | Per-org consumption + priority weights |
| `apps/admin/src/routes/ai/runs/+page.svelte` | Cross-org run inspection |

### API (modified)
| File | Change |
| --- | --- |
| `apps/api/src/app.ts` | Add `import { adminRouter }` + `.route('/admin', adminRouter)` |

### apps/admin (all new)
| File | Purpose |
| --- | --- |
| `apps/admin/package.json` | Package config (`@cio/admin`) |
| `apps/admin/svelte.config.js` | adapter-node, `$lib` alias |
| `apps/admin/vite.config.ts` | Vite + SvelteKit |
| `apps/admin/tsconfig.json` | TypeScript config |
| `apps/admin/.env.example` | `PRIVATE_SERVER_URL`, `PUBLIC_APP_URL` |
| `apps/admin/src/app.html` | HTML shell |
| `apps/admin/src/hooks.server.ts` | `/api/*` → `PRIVATE_SERVER_URL` proxy |
| `apps/admin/src/lib/api.svelte.ts` | `AdminApi` class |
| `apps/admin/src/lib/types.ts` | Request/response types |
| `apps/admin/src/routes/+layout.ts` | `ssr = false` |
| `apps/admin/src/routes/+layout.svelte` | Password gate + nav |
| `apps/admin/src/routes/+page.svelte` | Redirect to /users |
| `apps/admin/src/routes/users/+page.svelte` | Users table |
| `apps/admin/src/routes/users/[userId]/+page.svelte` | User profile |
| `apps/admin/src/routes/orgs/new/+page.svelte` | Create org |

---

## Verification

1. `cd apps/admin && pnpm dev` — app starts on port 5174
2. Navigate to `localhost:5174` — password gate form appears
3. Wrong password → inline error; correct password → land on `/users`
4. User table loads with search and pagination
5. Open a user profile → stats, chats, and orgs sections load
6. Expand an AI chat → messages render; "Copy chat" copies plain-text transcript
7. Add credits to an org → balance refreshes
8. Create an org via `/orgs/new` → verify row in DB
9. "Login as user" → new tab opens at `classroom-app.tedydev.io.vn` as that user
10. `pnpm build` in `apps/admin/` — builds independently with no dashboard code in the bundle

### AI Gateway (Phase 3)

11. `GET /admin/ai/health` without the super admin key → 401
12. With the key → reachability, auth, and model-probe rows resolve; breaker state reported
13. `POST /admin/ai/pause` without `reason` → 400; with reason → gateway rejects new AI work within one slice, no redeploy
14. Paused state surfaces to teachers as an abstract "AI unavailable" message — never as a shared-quota percentage
15. `POST /admin/ai/resume` → queued runs resume from their existing checkpoints, no duplicated sections/lessons
16. `PATCH /admin/ai/orgs/:orgId` with `priorityWeight: 3` → that org receives roughly 3× the scheduling turns of a weight-1 org under contention
17. Org exceeding its window budget is blocked at admission while other orgs keep running
18. `/admin/ai/runs` lists runs across every org; force-cancel stops the run cleanly at a slice boundary
19. Simulated 429 → breaker opens, affected run reports `quota_exhausted` rather than `failed`
20. No response body or UI view contains the gateway token, CCS management secret, or any OAuth token
