# Autonomous Git Policy

CelebrateDeal development automation may create isolated worktrees, branches and scoped commits. Automatic merge remains disabled until branch protection and required-review evidence are machine-verifiable; a commit is never treated as approval.

## Allowed

- Create task branches and isolated worktrees.
- Stage only files owned by the active task.
- Commit and amend automation-owned commits.
- Prepare low-risk documentation, tests, UI and ordinary application branches for merge after all required gates pass.
- Preserve a hash inventory of the primary dirty worktree as a protected baseline.

## Always blocked

- `git reset --hard`, `git clean -fd`, `git checkout --` and force push.
- Staging or deleting pre-existing user changes outside the active task.
- Automatic production deployment or production database mutation.
- Automatic merge of auth boundaries, tenant isolation, payment, billing, payout, webhook or destructive migration changes.
- Committing secrets, provider quota output containing credentials, cookies or raw production payloads.

An empty task scope cannot authorize a commit. A task marked `manual_merge_required` may be implemented and tested in isolation, but merge remains blocked.
