# Upstream sync — 18 commits, 2026-09-21

Merged `upstream/main` (`ce6e9976b..8f2a06f92`, 18 commits, 412 files) into the fork as one merge
commit. 63 files conflicted. Gates after resolution: API `tsc` 0 errors, API 948 tests pass,
dashboard 486 tests pass, `svelte-check` 337 errors (unchanged baseline).

## Adopted from upstream

| Commit | What it brings |
|---|---|
| `176155fc5` #978 | Roster access restricted to org admins. Re-applied by hand to the fork's extracted `audienceRouter`: `/audience`, `/audience/export`, `/audience/import`, `/audience/assign-courses` now use `orgAdminMiddleware`. Search excludes audience for non-admins (auto-merged). |
| `05fad3efd` #1059 | Contiguous, non-null order for sections, lessons and exercises. Migration `0018_enforce_content_order.sql` arrived **but has not been applied to production** (see Pending). The dead `POST /lesson/reorder` route and its dashboard client were dropped. |
| `c8048e92f` #1004 | New image upload experience in the editor: `ImageUploadModal`, `onImageUpload`, `onSearchUnsplash`, resize handles. Unioned with the fork's editor variants + smart-paste. `upload-widget.svelte` now renders upstream's modal. |
| `dc262b4aa` #915 | Public-course "copy page as markdown" export (API, queries, UI components). The teacher-facing toggle lives in upstream's restyled settings page, which is deferred — see below. |
| `520d69685` #1136, `9c739ae13` #1142, `73954d083` #1143 | Course card overlay outside the link wrapper, wider dialogs by default, org sidebar counts via `Sidebar.MenuBadge`. |
| `f2259ece4` #1140 | `PGBOUNCER_DATABASE_URL` support (prepared statements disabled for PgBouncer). |
| `bdbe03e02` #1085 | Dashboard vitest config work. The fork keeps its own config (node env, icon stubs); added `$mail` and targeted `@cio/ui/custom/org-landing-page/*` source aliases so upstream's new suites resolve. Restored the `validations.generic.custom` branch in `mapZodErrorsToTranslations` that upstream's new tests assert. |
| others | `84d279007` nav anchor links, public-course rail/share/outline components, `4bb9faec3` PRD doc, agent and AI-assistant copy. |

## Deliberately kept the fork's version

| Upstream commit | Why |
|---|---|
| `8f2a06f92` #1096 content-created success interface | Rewrites `content-create-modal` and all three steppers around a success phase. The fork's modal carries the exam-import path; merging both is UI work, not sync work. Reverted the whole commit's dashboard file set so the modal and its steppers stay consistent. `open-content-create.ts` and `keyboard.ts` (new upstream helpers) were dropped with it. |
| `3e7b118ad` #1139 settings card restyle | 1023 changed lines that delete fork-only settings sections (tags, ordering, content grouping, completion deadline, threshold). Dropped with its `settings-card.svelte` and `settings-separator.svelte` helpers. |
| `61aa8c290` #991 non-auto-gradable connections | Turns the conversion error into an in-page resolution flow (banner, settings card, store, `public-conversion-utils`). The fork instead keeps the loud error: `getPublicConversionOffenders` throws `PUBLIC_COURSE_CONVERSION_BLOCKED` (error code re-added after upstream removed it), so `updateCourse`'s `conversionOffenders` path never fires and the fork's settings page stays correct. |
| `511078811` #1146 brand-system skill, `ae47b7e64` #1128 help nav | `apps/help`, `apps/docs` and `skills/` stay fork-owned (`.gitattributes merge=ours`); the fork's `create-thumbnail`, `add-docs-image` and `write-docs` skills target `apps/docs`, not upstream's help centre. |
| `.github/workflows` | Fork owns CI. `docs-label.yml` and `package-build-check.yml` stay deleted; `deploy-storybook.yml` keeps the fork's version. |

## Fixes the merge forced

- `order` is now required on `exercise` and `course_section` inserts: added a real value in
  `exam-container.ts` (0 — a container sits outside any course) and in the exam-import publish path
  (`max(order) + 1` for the course, read inside the publish transaction), plus 15 test fixtures.
- `packages/ui` public-course buttons: `props.class` typed as `string | undefined` for `cn()`.
- The fork's analytics `getBucketSize` replaced by upstream's, because upstream's merged test
  asserts the new bucket widths.
- Dashboard translations merged three-way: 30 upstream keys added per locale, 1 value updated where
  fork equalled base, 0 fork keys lost (en 4983 → 5049, vi 4996 → 5062).

## Pending — needs the owner

1. **Migration `0018_enforce_content_order.sql` is not applied to production.** It backfills NULL
   `order` values, then sets `NOT NULL` on `course_section`, `lesson` and `exercise`. Deploy does not
   run migrations, so the code ships without it; runtime stays safe because every insert now supplies
   `order`. Apply it after a database backup.
2. **Markdown export has no teacher-facing toggle** — `allowMarkdownExport` flows through API, DB and
   the public course UI, but the switch lives in upstream's deferred settings restyle.
3. The three deferred commits above are the input list for the Courses/Exam/Exercise refactor phase.
