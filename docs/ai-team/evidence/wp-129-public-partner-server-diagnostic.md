# WP-129 Local Next Dev-Server Boundary Diagnostic

## Result

- Classification: `EXISTING_APP_OR_NEXT_BOUNDARY`.
- The new temp-mirror runner proved mirror completeness (required inputs present; dotenv/database/certificate files excluded), a stable `node_modules` junction, and resolution of Next, React and React DOM.
- An ephemeral loopback port was allocated. The child process spawned successfully but exited with code 1 before the fixed `/login` readiness probe; raw stdout/stderr were kept only in memory and reduced to a fingerprint.
- Because all new-runner predicates passed and the Next process still exited before readiness, the failure is outside the WP-129 runner ownership boundary. No existing app, Next configuration, package metadata or lockfile was changed.

## Deterministic evidence

- WP-129 self-tests: 6/6 PASS.
- Scoped ESLint and TypeScript no-emit, non-incremental check: PASS.
- Temp mirror cleanup and child-process cleanup: PASS; staged index empty; workspace preserved.
- No environment-file content, raw log, source snippet, credential, cookie, token or external request was persisted.
- WP-128 artifacts were read-only; no browser rerun was attempted after the outside-ownership classification.

## Acceptance boundary

The result does not prove the browser unavailable-state contract and cannot increase CAT06. CAT06 remains `7.0/10`, total `70.5/100`. Remediation now requires the owner of the existing Next/application boundary to provide an isolated build/start environment or an explicit, separately scoped fix; the generated artifacts and all existing dirty files remain `PRESERVE_ONLY`.

## Rollback and stop

Rollback removes only WP-129 contract, diagnostic runner, tests, receipt and evidence. No application or configuration rollback is authorized. No further retry of the same temp-mirror startup boundary is allowed without a new owner-approved scope.
