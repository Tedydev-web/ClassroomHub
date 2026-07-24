# Git workflow

This fork uses a lightweight trunk-based workflow. `main` is the only long-lived product branch and must remain deployable.

## Repository topology

- `origin`: the product repository, `Tedydev-web/classroomhub`.
- `upstream`: the fetch-only source repository, `classroomhub/classroomhub`.
- `main`: the protected integration and release branch.

Never push to `upstream`. Never develop directly on `main`.

## Branches

Create short-lived branches from the latest `origin/main`:

- `feat/<scope>` for product behavior.
- `fix/<scope>` for defects and regressions.
- `infra/<scope>` for deployment, local runtime, and operations.
- `refactor/<scope>` for behavior-preserving restructuring.
- `sync/upstream-YYYY-MM-DD` for a manually resolved upstream update.
- `agent/<scope>` for temporary AI-agent work that is not yet a normal feature branch.

Use lowercase kebab-case after the prefix. One branch owns one coherent change. Delete it after merge.

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c feat/descriptive-scope
```

## Daily development

Commit focused changes using Conventional Commits. Before opening a pull request, update the branch without creating an accidental merge commit:

```bash
git fetch origin
git rebase origin/main
pnpm format:changed
pnpm quality
git push --force-with-lease
```

Use `--force-with-lease` only for a short-lived branch you own. Never force-push `main`, a shared branch, or an upstream-sync branch under review.

Open every product change as a pull request into `main`, including solo work. Use squash merge for feature, fix, refactor, and infrastructure pull requests. The resulting commit on `main` must follow Conventional Commits.

## AI-agent isolation

Each concurrent agent gets its own branch and worktree. Agents must not share a writable worktree or edit the same file concurrently.

```bash
git fetch origin
git worktree add ..\classroomhub-worktrees\agent-scope -b agent/scope origin/main
```

The agent commits only its owned files. Review and integrate that commit through a normal feature branch or pull request. Remove the worktree only after its changes are committed or deliberately discarded:

```bash
git worktree remove ..\classroomhub-worktrees\agent-scope
git branch -d agent/scope
```

Never use a shared stash as an agent handoff mechanism. A commit is the handoff artifact.

## Upstream synchronization

Upstream changes use a merge commit so ancestry and rollback remain auditable. Do not squash or rebase an upstream sync.

The scheduled workflow proposes `automation/upstream-sync`. If it merges cleanly, review its pull request and run the normal quality gate. If it conflicts, close the automation pull request and resolve locally:

```bash
git fetch origin
git fetch upstream main
git switch -c sync/upstream-YYYY-MM-DD origin/main
git merge --no-commit upstream/main
```

Resolve conflicts in favor of current product decisions for infrastructure, branding, billing, licensing, storage, domains, and deployment unless an upstream change is intentionally adopted. Review migrations separately and test them on a temporary database before merging.

Push the resolved branch and merge its pull request with a merge commit:

```bash
git commit -m "merge: sync upstream classroomhub"
git push -u origin sync/upstream-YYYY-MM-DD
```

Detailed sync and rollback rules are in [upstream-sync.md](./upstream-sync.md).

## Main branch policy

`main` requires:

- a pull request before merge;
- the `Quality / static-and-unit` and `Quality / selective-assignment-integration` checks;
- resolved review conversations;
- no force pushes or branch deletion;
- linear history for normal product work, except explicit upstream merge commits.

After merge, verify the remote `main` commit and the deployment target. Tag production releases before rollout when a rollback reference is needed.

## Recovery rules

- Revert a faulty product change with a new pull request; do not rewrite `main`.
- Revert an upstream sync by reverting its merge commit in a new pull request.
- Treat database rollback as a separate migration plan. A Git revert does not undo applied schema or data changes.
- Keep an uncommitted dirty worktree in place until its changes are classified. Do not use `reset --hard` or broad checkout commands to clean it.
