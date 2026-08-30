# FIN-08V Preview marker deployment verification

## Authorization

The user authorized exactly one non-Production Preview deployment from the
current workspace. Production deployment, alias mutation, environment-variable
commands, database access, PayUni access and retries remain forbidden.

## Scope

The runner creates an OS-temp allowlist mirror, excludes dotenv files,
workspace metadata, receipts, evidence, credentials and test artifacts, then
performs exactly one Preview deploy. After deployment it performs one metadata
inspect, one marker GET and one marker HEAD against the direct Preview identity.
Raw CLI output, URL, headers and response body are never persisted.

FIN-08U route, route test, API registry and evidence are preserve-only inputs;
FIN-08 through FIN-08T, WP-196 and WP-197 remain immutable.

## Acceptance fields

- `deploymentAttempts=1`
- `productionDeployments=0`
- `aliasMutations=0`
- `environmentCommands=0`
- `metadataReads=1`
- `markerGets=1`
- `markerHeads=1`
- `databaseOperations=0`
- `payuniOperations=0`
- `retryCount=0`
- v2 exact payload, WP-187 base lineage and FIN-08U remediation identity
- GET／HEAD 200, no redirect, `no-store`, `nosniff`, empty HEAD body

The receipt is written with exclusive creation before the first Vercel
process. Any crash, timeout, deployment failure or verification failure is a
terminal no-go and cannot be retried.

## Execution result

- `deploymentAttempts=1`; the single authorized Preview deploy did not produce
  an accepted deployment identity.
- `metadataReads=0`, `markerGets=0`, and `markerHeads=0`; no remote marker or
  database/PayUni operation was attempted after the deploy no-go.
- The runner receipt is `FIN08V_TERMINAL_NO_GO_CLEANUP` with strict sanitized
  readback. The runner's temporary mirror was subsequently verified as the
  exact marker-owned OS-temp leaf and removed; no other temporary path was
  touched.
- `FIN08V_POST_RUN_CLEANUP_VERIFIED=true`
- AGY Fast: two `FIRST_OUTPUT_TIMEOUT`; AGY Deep: two
  `FIRST_OUTPUT_TIMEOUT`; Luna executable unavailable. QA classification:
  `TOOL_BLOCKED`.
- `scoreImpact.applied=false`; CAT04 remains 6/10. No E2E or coverage run was
  authorized by this work package.
