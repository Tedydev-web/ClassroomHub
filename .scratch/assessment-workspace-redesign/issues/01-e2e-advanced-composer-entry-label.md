# Advanced composer E2E container locator drifts after workspace extraction

Type: task
Status: resolved

## Evidence

The Chromium composer test opens the advanced composer, then scopes its assertions through the nearest `section` ancestor of the Question title field. After workspace extraction, this now resolves to a field-level section and cannot find the Add choice toolbar action.

## Impact

The test cannot exercise the canonical composer after it opens.

## Acceptance criteria

- The test scopes the workspace through a stable workspace-root control.
- Rich-text title and prompt assertions target their semantic `role="group"` wrapper and `contenteditable` editor.
- The existing Chromium composer test reaches the composer toolbar and validation flow.

## Comments

- Observed during local Chromium verification on 2026-07-30. Fixture was deleted successfully after each failed test.
- Resolved on 2026-07-30: the test now scopes from the workspace save action and uses the group/contenteditable contract for canonical rich-text fields. Chromium passed in 19.5 seconds; the local fixture was deleted with HTTP 200.
