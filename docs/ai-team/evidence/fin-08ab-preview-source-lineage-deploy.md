# FIN-08AB Preview source-lineage deploy

## Scope

One bounded non-Production Preview deploy was attempted from the current
workspace after the fingerprint route was recorded in Git. The command used
Preview defaults, `--yes`, `--skip-domain`, and no production, environment,
alias, database, or PayUni operation.

## Sanitized result

- CLI present: `true`
- linked project metadata present: `true`
- exit code: `1`
- timed out: `false`
- stdout/stderr persisted: `false`
- URL/deployment ID persisted: `false`
- production: `false`
- environment mutation: `false`
- alias mutation: `false`
- database operations: `0`
- PayUni operations: `0`

The non-zero exit is classified as `VERCEL_DEPLOY_NONZERO_EXIT`. Raw stderr was
not retained, so the root cause is intentionally not guessed. The single
authorized deploy attempt is consumed; do not retry the same command without a
new authorization and a materially different diagnostic boundary.

## Acceptance impact

No Preview route artifact or deployment lineage was established. CAT04 and
CAT09 scores remain unchanged; E2E remains deferred.
