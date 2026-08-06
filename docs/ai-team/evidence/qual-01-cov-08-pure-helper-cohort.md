# QUAL-01 / COV-08 pure-helper cohort evidence

## Status

- work package: `QUAL-01-COV-08`
- classification: `COVERAGE_THRESHOLD_FAIL_REMAINING_SOURCE_INVENTORY`
- source changes: `NO`
- modified test ownership: append-only existing untracked tests for WP129, WP135 and WP139
- production, database, Docker, PayUni and external access: `NO`

## Deterministic verification

- targeted Node TAP cohort: `30/30 passed`
- complete Node TAP contracts after cohort: `499/499 passed`
- ESLint for cohort tests: `0 errors`
- full lint: `0 errors`, `2 existing warnings`
- typecheck: `PASS`
- strict-index typecheck: `PASS`
- `git diff --check`: `PASS`

## Coverage attribution

Fresh combined coverage before the cohort:

- statements `36.07%`
- branches `41.33%`
- functions `41.89%`
- lines `53.37%`

Fresh combined coverage after the cohort:

- statements `36.25%` (`9420/25981`)
- branches `41.58%` (`8733/21001`)
- functions `42.23%` (`1706/4039`)
- lines `53.58%` (`8265/15424`)

The existing thresholds remain `63/57/60/65`; all four global checks still fail. No threshold, exclude, inventory, assertion or skip was changed. E2E was not run because coverage did not pass.

## Scope and rollback

The cohort added deterministic assertions for mirror classification/sanitization, route export and generated-inventory parsing, route ownership classification, isolated-build path safety, metadata and boundary helpers. It never calls runner `main()` or server/Docker/DB paths.

Rollback removes only the named `COV-08` blocks from:

- `scripts/wp129-public-partner-server-diagnostic-runner.test.mjs`
- `scripts/wp135-temp-route-lineage-runner.test.mjs`
- `scripts/wp139-isolated-next-build-runner.test.mjs`

All prior user and WP ownership remains preserved. No destructive Git operation was used.
