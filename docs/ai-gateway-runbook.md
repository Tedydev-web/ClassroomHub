# AI Gateway Runbook

Operating the shared CCS/CLIProxy Codex gateway that backs ClassroomIO's AI features.

## What this is

Every organization's AI traffic prefers a single OpenAI-compatible proxy fronting the platform
owner's ChatGPT/Codex subscription. When that subscription cannot serve, traffic automatically
falls back to the official OpenAI API. When neither can serve, teachers see the existing
token-limit message.

```text
Teacher (any org)
  → ClassroomIO API
  → gateway route decision
      ├─ CCS/CLIProxy :8317 → Codex OAuth → ChatGPT subscription
      └─ api.openai.com (fallback, billed per token)
```

**Output quality is never reduced to save quota.** The route changes; the requested model does
not.

## Deployment posture

This is an operator-selected, policy-sensitive architecture. Consumer subscription terms do not
clearly authorise serving multiple tenants from one account, and the provider may enforce that
without notice. The platform owner accepted this trade-off; see
`plans/reports/research-260723-1540-GH-2026-subscription-backed-ai-provider-strategy.md`.

Nothing in this system attempts account farming, quota circumvention, or detection evasion.

## First-time setup

### 1. Generate the proxy key

The gateway authenticates callers with its own API key — **not** an OAuth token. Generate one,
store it in the deployment `.env` as `AI_GATEWAY_AUTH_TOKEN`, and never commit it.

Set `AI_GATEWAY_BASE_URL` to the plain host — `http://ccs:8317` for the compose sidecar, or
`http://127.0.0.1:8317` when pointing at a proxy already running on the host. The transport
appends `/v1` itself, and tolerates a base URL that already includes it. Without that
normalization the SDK would append only the endpoint path and every call would fail with a bare
`Not Found`, which says nothing about the cause.

### 2. Start the sidecar

```bash
docker compose up -d ccs
docker compose ps ccs        # wait for healthy
```

The service has no `ports:` mapping. It is reachable at `http://ccs:8317` from `api` and `jobs`,
and unreachable from the host or internet. Verify both:

```bash
docker compose exec api curl -fsS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $AI_GATEWAY_AUTH_TOKEN" http://ccs:8317/v1/models   # expect 200
docker compose exec api curl -s -o /dev/null -w '%{http_code}\n' http://ccs:8317/v1/models  # expect 401
curl -s -m 3 -o /dev/null -w '%{http_code}\n' http://localhost:8317/v1/models   # expect failure
```

### 3. Authenticate Codex

Either authenticate inside the container, or migrate an existing host session into the volume.

**Migrating an existing session** — stop the proxy first; Codex writes `auth.json` with
truncate-then-write, so copying during a token refresh can capture a corrupt file:

```bash
docker compose stop ccs
docker cp <auth-file>.json cio-ccs:/root/.ccs/cliproxy/auth/
docker compose start ccs
docker compose logs ccs | grep -i "client load"    # confirm the client count
```

Copy **only** the Codex auth file. `~/.ccs/cliproxy/auth/` may also hold Claude credentials; this
deployment is Codex-only, and copying unrelated credentials into the container widens exposure
for no benefit.

Confirm the load by client count, never by reading the file:

```bash
docker exec cio-ccs sh -c 'tail -n 30 /var/log/ccs/cliproxy.log' | grep "full client load"
# expect: full client load complete - 1 clients (1 auth files + ...)
```

Never `cat` the credential file, and never paste its contents anywhere.

The container generates its own per-install proxy API key at
`/root/.ccs/cliproxy/config.yaml`. That key — not the host proxy's — is what
`AI_GATEWAY_AUTH_TOKEN` must be set to when the app talks to the sidecar.

### 4. Configure the gateway

The kill switch, model allowlist, and limits live in the database so they can change during an
incident without a redeploy. Set `SUPER_ADMIN_PASSWORD`, then:

```bash
curl -X PATCH https://<api-host>/admin/ai/settings \
  -H "X-Super-Admin-Key: $SUPER_ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' \
  -d '{
    "enabled": true,
    "defaultModelId": "gpt-5.4",
    "lightModelId": "gpt-5.4-mini",
    "modelAllowlist": [
      { "modelId": "gpt-5.4",      "label": "GPT-5.4", "quotaWeight": 3, "role": "default" },
      { "modelId": "gpt-5.4-mini", "label": "Mini",    "quotaWeight": 1, "role": "light" }
    ],
    "windows": [
      { "id": "weekly", "durationMinutes": 10080, "capUnits": 400000000 }
    ],
    "defaultOrgWindowBudgetUnits": 40000000
  }'
```

> **One window, not two.** ChatGPT dropped the 5-hour limit; only the weekly one remains. CCS still
> labels its bar `5h usage limit`, but the reset it reports is days away — the label is vestigial.
> Configuring a `short` window would reject work against a limit that no longer exists.

> **Do not build the allowlist from `GET /v1/models`.** The proxy advertises its full static
> catalog, including Claude models, even when no Claude account is authenticated. Requesting one
> fails at runtime. The stored allowlist is the only source of truth.

### Models offered to teachers

The picker is Codex-only while the gateway is serving. Gemini appears **only** when it is not —
offering it during normal operation would quietly route work around the subscription.

| Model | Weight | Role |
| --- | ---: | --- |
| `gpt-5.4-mini` | 4 | light tasks |
| `gpt-5.4` | 12 | **default** |
| `gpt-5.6-luna` | 8 | optional |
| `gpt-5.6-terra` | 20 | optional |
| `gpt-5.6-sol` | 30 | optional |
| `gemini-2.5-flash-lite` | — | fallback only; hidden while the gateway is up |

Verified live on 2026-07-23: those five Codex models serve. `gpt-5.3-codex` and `gpt-5.2` appear
in the proxy catalog but answer `unknown provider` — never add them.

**Three lists must agree** when adding a model, or it gets offered and then fails:

1. `AGENT_MODELS` in `packages/utils/src/agent-models/index.ts` — what the picker shows
2. `model_allowlist` in `ai_gateway_settings` — what the resolver permits
3. `MODEL_COST_MULTIPLIER` in `packages/core/src/services/agent/usage.ts` — what budgets count

`agent-model-registry.test.ts` guards (1). Keeping (2) and (3) in step is an operator
responsibility until the weights are unified.

> **Known gap:** the course-creator picker on the org onboarding page does not read gateway
> state, so it always lists Codex models. If the gateway is down, a model chosen there fails
> instead of falling back in the UI. The chat picker switches correctly.

### Sizing `capUnits`

Measured on 2026-07-23 against real course-generation rounds through the gateway:

| Workload | Tokens | Cost units (`gpt-5.4-mini`, ×4) |
| --- | ---: | ---: |
| Trivial request (`say ok`) | ~310 | ~1,240 |
| One tool-calling request | ~450 | ~1,800 |
| **One generation round** (sections + lessons + exercises) | **~34,000** | **~136,000** |

A round is roughly 75× a single tool call: the context carries the plan, the run state, and the
conversation, and it grows as the run proceeds. Budget from rounds, not from requests.

Rough sizing, `gpt-5.4-mini`:

- One full course (up to 24 rounds): **~3.3M cost units**
- `gpt-5.4` is 3× the multiplier (12 vs 4), so the same course costs **~10M**

Current sizing, per weekly window:

| Setting | Value | Buys roughly |
| --- | ---: | --- |
| `windows[weekly].capUnits` (shared pool) | 400,000,000 | ~120 mini courses, ~40 on `gpt-5.4` |
| `defaultOrgWindowBudgetUnits` (per org) | 40,000,000 | ~12 mini courses, ~4 on `gpt-5.4` |

Ten orgs at full budget exactly fill the pool. Both numbers are starting points calibrated from the
table above, not from the subscription's real ceiling — the account sat at 34% after ~515k cost
units of test traffic, which is too small a sample to extrapolate from. Re-tune once real traffic
shows the mix.

### The org budget is what teachers see

`defaultOrgWindowBudgetUnits` is the denominator of the capacity meter in the AI chat header. Setting
it does two things at once:

- **Enforcement** — `evaluateGatewayAdmission` rejects runs past it with `org_budget_exceeded`.
- **Display** — the meter renders `used / budget` against the *tightest* configured window.

Both read the window through `selectBudgetWindow`, so the number shown is always the number
enforced. Leaving the budget `null` disables both: admission stops checking it, and the header falls
back to a bare consumption count with no bar, because there is no honest denominator to draw one
against. Never show the shared pool total to a tenant — it moves when *other* tenants work.

Override one org with `PATCH /admin/ai/orgs/:orgId`.

> The fixed harness overhead is real but small: ~309 prompt tokens per call. It matters for
> chat-style traffic, not for generation rounds.

> **`quotaWeight` is currently advisory.** Window budgets sum `cost_units`, which comes from
> `MODEL_COST_MULTIPLIER` in `packages/core/src/services/agent/usage.ts` — not from the
> allowlist. Keep the two in step when adding a model, or its configured weight and its measured
> consumption will disagree. Unifying them is open work.

## Daily operations

| Task | Command |
| --- | --- |
| Health | `GET /admin/ai/health` |
| Health without spending quota | `GET /admin/ai/health?skipProbe=true` |
| Quota and heaviest orgs | `GET /admin/ai/quota` |
| Current settings | `GET /admin/ai/settings` |
| Per-org policy and consumption | `GET /admin/ai/orgs` |

All require `X-Super-Admin-Key`.

The health endpoint reports three distinct things, because they fail differently:

1. **Reachable** — the proxy answers and accepts the key. Costs no model tokens.
2. **Can serve** — the upstream subscription actually responded. Cached for 60s; without that
   cache, polling a dashboard would slowly drain the subscription it reports on.
3. **Breaker state** — whether ClassroomIO is currently routing away from the gateway.

## Incident response

### Pause everything

```bash
curl -X POST https://<api-host>/admin/ai/pause \
  -H "X-Super-Admin-Key: $SUPER_ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' \
  -d '{"reason": "investigating quota burn", "pausedBy": "ops"}'
```

Takes effect at the next slice boundary — a round already in flight finishes rather than being
cut mid-tool-call. A reason is required: an unexplained pause is impossible to triage later.

Resume with `POST /admin/ai/resume`. Queued runs continue from their checkpoints.

### One org is burning capacity

Lower its share rather than blocking it outright:

```bash
curl -X PATCH https://<api-host>/admin/ai/orgs/<org-uuid> \
  -H "X-Super-Admin-Key: $SUPER_ADMIN_PASSWORD" \
  -H 'Content-Type: application/json' \
  -d '{"windowBudgetUnits": 50000, "maxQueuedRuns": 1}'
```

`priorityWeight` is the fair-share knob: weight 3 earns roughly three times the scheduling turns
of weight 1 at equal consumption. Blocking (`isBlocked: true`) is absolute and stops chat too.

### Quota exhausted

Expected behavior, not an outage:

1. The gateway returns 429.
2. The breaker opens with an escalating cooldown (60s → 5m → 15m → 60m).
3. Traffic routes to the official OpenAI API.
4. Course generation in flight continues on the official provider for the rest of that run.

Nothing to do unless fallback is also unavailable. Watch `fallbackMonthlyCapUnits` — with
`PUBLIC_IS_SELF_OWNED=true` the per-org plan allowance is unlimited, so that cap is the only
guard against unbounded API spend.

### Auth expired

A 401 opens the breaker with a one-hour cooldown and reports `auth_expired`. This cannot heal on
its own — re-authenticate Codex in the sidecar, then:

```bash
curl -X POST https://<api-host>/admin/ai/breaker/reset -H "X-Super-Admin-Key: $SUPER_ADMIN_PASSWORD"
```

## Constraints to respect

### Do not scale `apps/jobs` beyond one replica

`global_concurrency` is enforced by the BullMQ worker's own concurrency setting, which is
per-process. Two replicas means two slots and double the quota burn, with no signal that it
happened.

`docker-compose.yaml` pins `container_name: cio-jobs`, which Compose refuses to scale — that is
load-bearing, not incidental. Supporting multiple replicas requires a Redis slot lease
(`SET key token NX PX ttl` plus a Lua compare-and-delete release, heartbeat at roughly a third of
the TTL). Single-instance lease is sufficient; Redlock is not needed. Until that exists, one
replica.

### Treat `ccs-auth` as a secret store

It holds OAuth access and refresh tokens. Never mount it into `api` or `jobs`. Encrypt any
backup. Rotate on suspected exposure.

### The proxy's quota view is advisory

CCS states plainly that its quota display omits live in-proxy 429 cooldowns. Real 429s and the
breaker state are authoritative; the quota snapshot is a hint.

## What teachers see

Nothing about the shared pool. They keep the existing token meter and the existing exhaustion
message. Shared-capacity numbers stay inside the operator API: an org admin cannot act on them,
and showing them would leak cross-tenant consumption.

The one new user-visible rejection is an operator block, which surfaces as
"AI generation is disabled for this organization."
