# Upstream synchronization

The fork keeps two remotes:

- `origin`: `Tedydev-web/classroomhub`, the independently operated product repository.
- `upstream`: `classroomhub/classroomhub`, fetch-only reference source.

Only sync commits merged into `upstream/main`. Upstream feature branches are unreviewed inputs and must not be merged directly into the product branch.

## Automated proposal

`.github/workflows/upstream-sync.yml` checks upstream daily and creates or updates `automation/upstream-sync`. It never merges or deploys the result. A maintainer reviews the pull request and merges it only after required quality and runtime checks pass.

If the workflow reports conflicts, resolve them locally instead of force-merging:

```bash
git fetch origin
git fetch upstream main
git switch -c sync/upstream-YYYY-MM-DD origin/main
git merge --no-commit upstream/main
```

Resolve each conflict according to current product behavior. Keep local infrastructure, branding, licensing, domain, storage, and deployment decisions unless the upstream change deliberately replaces them. Then run the full regression gate, commit, push the branch, and open a pull request into `main`.

## Safety rules

1. Start from a clean, committed worktree.
2. Never sync directly on a production server process branch.
3. Review database migrations before running them; back up production data first.
4. Never use `git reset --hard` to make the fork resemble upstream.
5. Prefer a merge commit for upstream syncs. It records provenance and makes rollback auditable.
6. Do not auto-merge the sync pull request or bypass required checks.
7. Tag or record the deployed commit before rollout.

To roll back code, revert the upstream merge commit in a new pull request. Database rollback requires a migration-specific plan and must not be inferred from the Git revert alone.

Branch naming, merge strategy, and AI-agent isolation are defined in [git-workflow.md](./git-workflow.md).
