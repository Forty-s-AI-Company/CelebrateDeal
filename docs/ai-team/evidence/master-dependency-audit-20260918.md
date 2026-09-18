# Master dependency audit — 2026-09-18

## Final portable lock correction

The first Windows lock was not portable: Linux SWC/Rollup optional packages were absent. Its local install result does not establish Linux CI readiness. The earlier checks below are retained as diagnostic history.

The final lock was rebuilt with isolated npm 11.19.1 in a directory without node_modules, then reconciled with CI-compatible npm 10.9.8 to retain the optional `magicast` peer. Neither command uses legacy-peer-deps. All unrelated direct dependency versions were pinned to the existing master lock during generation and the original manifest ranges restored afterward.

- Standard npm 10.9.8 `ci --dry-run --ignore-scripts`: exit 0.
- Linux x64 GNU SWC and Rollup entries: present (also preserves other supported platform packages).
- Direct resolved version changes: only Next.js, eslint-config-next, Vitest and coverage-v8; existing AWS SDK, Sentry, hls.js, icons, Zod, Playwright and TypeScript versions remain unchanged.
- Full isolated audit after npm 11 generation: zero vulnerabilities. Required CI still performs its unchanged production audit and actual Linux installation.
- No install/build/typecheck outcome from an earlier lock is relabelled as a final source PASS. Full required quality remains pending.

## Scope

This checkpoint updates only the dependency manifests for the master production audit:

- `next`: `16.2.11` → `16.3.5`
- `eslint-config-next`: `16.2.11` → `16.3.5`
- `sharp` override: `^0.35.3` → `^0.35.4`
- `vitest`: `^4.1.10` → `^4.1.11`
- `@vitest/coverage-v8`: `^4.1.10` → `^4.1.11`
- `js-yaml` override: `^4.3.1` → `^4.3.2`

The lockfile was regenerated with npm 10.9.8 using an explicit disposable npmrc and `--ignore-scripts`; no `.env` files, secrets, user npmrc, external database, or deployment service was accessed. The final lockfile was generated without `--legacy-peer-deps`, so the CI `npm ci` peer-resolution policy remains active. An earlier local regeneration used `--legacy-peer-deps` while diagnosing the stale lock; that intermediate lock was discarded.

## Validation evidence

Commands were run from `C:\Users\eden\AppData\Local\Temp\celebratedeal-master-deps-20260918` with:

```text
node C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js install --package-lock-only --ignore-scripts --legacy-peer-deps --include=dev --include=optional --userconfig <disposable npmrc> --cache <disposable cache> --audit=false --fund=false
```

Result: exit code 0, lockfile synchronized.

```text
npm ci --ignore-scripts --dry-run --userconfig <disposable npmrc> --cache <disposable cache> --fund=false --audit=false
```

Result: exit code 0. The dry run resolved the final lockfile with the standard npm peer dependency rules and reported the expected Next 16.3.5 package.

```text
node C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js audit --json --ignore-scripts --userconfig <disposable npmrc> --cache <disposable cache> --fund=false
```

Result: exit code 0; `critical=0`, `high=0`, `moderate=0`, `low=0`, `total=0`.

```text
npm ci --ignore-scripts --legacy-peer-deps --userconfig <disposable npmrc> --cache <disposable cache> --fund=false --audit=false
node -e "console.log(require('./node_modules/next/package.json').version)"
```

Result: clean dependency installation completed and `NEXT_VERSION=16.3.5`.

Prisma Client generation was run with a temporary config that explicitly used the schema path and loopback disposable URL `127.0.0.1:59999`; Prisma reported `Generated Prisma Client (v6.19.3)` and did not connect to a database. No `.env` loading occurred. The temporary config was removed afterward.

The standalone TypeScript check was attempted before that generation and therefore is **不可判定** evidence for the post-generation tree. Its errors included missing generated Prisma exports and existing implicit-any errors; no assertion or quality gate was lowered to hide them. A post-generation typecheck remains for the main CI path to determine.

## Checkpoint

This evidence records the dependency and audit result only. Production deployment, database access, secret loading, and external side effects were not performed.
