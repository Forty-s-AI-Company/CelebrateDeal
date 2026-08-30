# FIN-08X Preview deployment identity attestation

## Scope

FIN-08X is a zero-deployment, zero-marker, read-only metadata attestation.
It may issue at most one exact-project Preview inventory query. It excludes
protected historical identity digests and requires an explicit, verifiable
creation-time lower bound plus monotonic descending inventory order. A
candidate is accepted only when exactly one READY non-Production Preview row
remains.

The runner does not read dotenv files, credentials or raw CLI output. It
persists only a namespace-separated identity SHA-256 digest, a UTC minute
bucket, booleans, enums and counters.

## Fail-closed prerequisite

FIN-08T and FIN-08R provide a protected old identity digest, but neither
sanitized artifact contains a trusted creation timestamp or ordering lower
bound. FIN-08V has one deployment attempt but no identity digest or time
window; FIN-08W intentionally performed zero queries. Therefore FIN-08X must
stop before its single metadata query with
`FIN08X_TERMINAL_NO_GO_PRECHECK` rather than infer a deployment lineage.

## Score and safety

`scoreApplied=false`; CAT04 remains 6/10. No marker, health, database, PayUni,
environment, alias, deployment or Playwright operation is authorized by this
work package.

## Execution result

- Deterministic tests: 6/6; Node TAP contracts: 540/540; typecheck,
  strict-index and diff check passed.
- The sole attestation run returned `FIN08X_TERMINAL_NO_GO_PRECHECK` with
  `deployments=0`, `metadataInventoryQueries=0`, `candidateCount=0`, and
  `markerRequests=0`; strict receipt readback passed.
- The runner found an old identity digest but no trusted creation-time lower
  bound in the preserved sanitized artifacts, so it did not query Vercel or
  infer a new deployment identity.
