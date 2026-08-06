# FIN-08U Preview marker contract remediation

## Scope

FIN-08U adds a small, deterministic App Route Handler for the Preview
deployment lineage marker. It does not modify health checks, middleware,
rewrites, Prisma, PayUni, deployment settings, or any previous FIN-08,
FIN-08R, FIN-08S, FIN-08T, WP-196, or WP-197 artifact.

## Contract

- Route: `/__celebratedeal_wp187_fingerprint.json`
- Schema: `celebratedeal-preview-lineage/v2`
- Base lineage: `WP-187`
- Remediation work package: `FIN-08U`
- Digest semantics: `wp187_base_lineage`
- GET and HEAD: status `200`
- Headers: `Cache-Control: no-store, max-age=0` and
  `X-Content-Type-Options: nosniff`
- Payload is a compile-time constant; no environment, filesystem, database,
  authentication, request metadata, or external-service access occurs.
- The legacy `{ workPackage, sourceDigest }` shape is rejected by the local
  validator; the v2 names make the base-lineage semantics explicit.

## Deterministic verification

- Route test: exact payload keys, digest format, GET／HEAD status and headers,
  empty HEAD body, legacy/tamper rejection, source-boundary scan and repeated
  byte-stable responses.
- Targeted route Vitest: `5/5 passed`.
- Full Vitest: `166 files / 1,238 tests; 1 failed`. The existing
  `scripts/api-contract-registry.test.ts` correctly stopped because the new
  route has no static API registry entry yet:
  `/__celebratedeal_wp187_fingerprint.json has no statically inventoried method`.
- This is an approved-scope boundary: adding the required registry entry would
  modify `docs/codex-goal/API_CONTRACT_REGISTRY.md` and its inventory test is
  outside FIN-08U's three-file scope. No registry or threshold weakening was
  performed.
- The minimal one-file scope expansion was then applied to
  `docs/codex-goal/API_CONTRACT_REGISTRY.md`; the existing inventory test was
  not changed or weakened. The route is now registered as public GET／HEAD
  with the fixed v2 payload and no-store/nosniff headers.
- Registry plus route targeted tests: `6/6 passed`.
- Full Vitest after registry completion: `167 files / 1,239 tests passed`.
- Node TAP contracts: `521/521 passed`.
- TypeScript, strict-index typecheck, scoped ESLint and `git diff --check`:
  `PASS`.
- External operations: `0`
- Database operations: `0`
- PayUni operations: `0`
- Environment value reads: `0`

Remote Preview deployment and HTTP verification are intentionally deferred to
a separate, newly authorized work package after Sol acceptance.
