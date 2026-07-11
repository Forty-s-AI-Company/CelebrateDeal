---
name: celebratedeal-release-gate
description: Decide whether CelebrateDeal changes are releasable by evaluating git scope, migrations, secrets, tenant isolation, payment and commission invariants, tests, build, preflight, browser evidence, external service validation, rollback, and unresolved blockers. Use before merge, staging promotion, production deployment, release notes, or go-live decisions.
---

# CelebrateDeal Release Gate

## Workflow

1. Read `AGENTS.md`, `docs/production-go-live-checklist.md`, and [gate-policy.md](references/gate-policy.md).
2. Inspect git status/diff and classify changed surfaces: docs, UI, API, auth, tenant, migration, payment, Cloudflare, email, monitoring.
3. Run required commands for every changed surface; record exact command and result.
4. Check secrets, migrations, rollback, tenant-negative tests, idempotency, audit, reports, and External required evidence.
5. Produce one decision: `READY`, `CONDITIONAL`, or `BLOCKED`.

## Decision rules

- Use `READY` only when all required local and external gates pass.
- Use `CONDITIONAL` only for non-production handoff when local gates pass and explicitly listed external sandbox/dashboard checks remain.
- Use `BLOCKED` for known critical/high exploitable security issues, failing required tests, destructive migration without rollback, missing payment idempotency, secret exposure, or unverified production-critical provider behavior.

## Output format

1. Decision and scope.
2. Passed gates with evidence.
3. Failed gates.
4. External required.
5. Migration and rollback status.
6. Security and finance sign-off.
7. Exact next action and owner.

## Prohibitions

- Do not deploy production, merge critical changes, or approve your own unreviewed security/payment/database patch.
- Do not mark warnings as passes when the production configuration differs from CI.
- Do not omit failed artifacts or rewrite historical results.
- Do not claim the configured model or external service was used unless the environment proves it.

