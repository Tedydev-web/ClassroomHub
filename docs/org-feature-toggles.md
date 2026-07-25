# Per-org sidebar feature toggles

Switch individual dashboard capabilities off for one tenant, so its sidebar
reflects how that org actually works instead of the full product catalogue.

## Where

Super-admin panel (`apps/admin`) → **Organizations**. Every org is listed with a
checkbox per capability, grouped the way the sidebar groups them.

The panel is gated by `SUPER_ADMIN_PASSWORD` (sent as `X-Super-Admin-Key`).
Without that variable set, the admin API returns 503 in production and is open
in development.

## Default: everything is on

A flag is only stored when it deviates from the default. An org with no stored
flags has every capability — which is why existing orgs were unaffected when
this shipped, and why a newly created org starts with the full product rather
than an empty sidebar someone has to fill in.

Turning a capability back on removes the flag rather than storing `true`, so
reading `organization.settings.features` shows exactly what an operator changed.

## What a switched-off capability does

1. Its entry disappears from that org's sidebar.
2. Its routes redirect to the org home. A direct URL or a stale bookmark cannot
   land on the page.

**It is not an authorisation boundary.** The API still serves the underlying
endpoints, so this hides a capability from the dashboard — it does not revoke
access for API keys, MCP or webhooks. That matches how role-based nav filtering
already behaves in this app. If a capability must be genuinely unavailable to a
tenant, it needs an API-side check as well.

## Switchable capabilities

`dashboard`, `stats` (Analytics + Compliance), `setup`, `courses`, `cohorts`,
`media`, `scorm`, `tags`, `widgets`, `community`, `audience`, `mcp`, `api`,
`zapier`, `webhooks`.

**Home** and **Settings** are deliberately not switchable: an org without either
would have no landing page and no way back to its own configuration.

## Where it lives

| Concern | File |
| --- | --- |
| Key list, labels, default rule | `packages/utils/src/constants/org-features.ts` |
| Storage | `organization.settings.features` (jsonb) |
| Read/write | `packages/db/src/queries/admin/orgs.ts` |
| API | `GET /admin/orgs/features`, `PATCH /admin/orgs/:orgId/features` |
| Sidebar filtering + route guard | `apps/dashboard/src/lib/features/ui/navigation/org-navigation.ts` |

The key list has one home. The admin panel receives the catalog in the API
response rather than declaring its own copy, because that app intentionally has
no workspace dependencies.

## Adding a capability

1. Add the key to `ORG_FEATURE_KEYS` and give it a label in
   `ORG_FEATURE_LABELS` and a group in `ORG_FEATURE_GROUPS`.
2. Set `featureKey` on the matching entry in `baseNavConfig`.

Route gating comes for free: the guard reuses each nav entry's `matchPattern`,
the same expression that decides whether the item renders as active, so
navigation and access cannot disagree about which routes an item covers.
