# FIN-08W Preview marker recovery

## Scope

FIN-08W is a zero-deployment, read-only successor to the terminal FIN-08V
attempt. It may issue at most one bounded Preview metadata query. Only a
unique READY Preview candidate inside the FIN-08V sanitized identity window
can authorize one marker GET and one marker HEAD. No deployment, alias,
environment, database, PayUni, health or Playwright operation is permitted.

The runner never reads dotenv files, credentials or raw FIN-08V CLI output.
URLs and deployment identifiers remain in process memory only and are reduced
to SHA-256 digests in the receipt.

## Fail-closed prerequisite

The FIN-08V receipt records `deploymentAttempts=1` but has no persisted
deployment identity digest or bounded time window. Therefore a successor
cannot safely identify the one Preview deployment without guessing. FIN-08W
must stop before its metadata query with `FIN08W_TERMINAL_NO_GO_PRECHECK` and
`metadataQueries=0` unless a future sanitized evidence packet supplies one of
those exact identity gates.

Machine-readable marker for the post-run cleanup performed after FIN-08V:

`FIN08V_POST_RUN_CLEANUP_VERIFIED=true`

## Score and safety

`scoreApplied=false`; CAT04 remains 6/10. A no-go result does not prove
PayUni Sandbox readiness and does not authorize E2E, production, database or
external payment work.

## Execution result

- Deterministic tests: 6/6; marker route contract: 5/5; Node TAP contracts:
  534/534; typecheck, strict-index and diff check passed.
- The sole recovery run returned `FIN08W_TERMINAL_NO_GO_PRECHECK` with
  `deployments=0`, `metadataQueries=0`, `candidateCount=0`, `markerGets=0`,
  `markerHeads=0`, and strict receipt readback true.
- The FIN-08V sanitized receipt has no deployment identity digest or bounded
  creation window. The runner therefore stopped before any external metadata
  query rather than guessing which Preview deployment was created.
