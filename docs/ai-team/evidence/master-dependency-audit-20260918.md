# Master dependency audit — 2026-09-18

## Scope

This checkpoint updates only the dependency manifests for the master production audit:

- `next`: `16.2.11` → `16.3.5`
- `eslint-config-next`: `16.2.11` → `16.3.5`
- `sharp` override: `^0.35.3` → `^0.35.4`
- `vitest`: `^4.1.10` → `^4.1.11`
- `@vitest/coverage-v8`: `^4.1.10` → `^4.1.11`
- `js-yaml` override: `^4.3.1` → `^4.3.2`

The lockfile was regenerated with npm 10.9.8 using an explicit disposable npmrc and `--ignore-scripts`; no `.env` files, secrets, user npmrc, external database, or deployment service was accessed.

## Validation evidence

Commands were run from `C:\Users\eden\AppData\Local\Temp\celebratedeal-master-deps-20260918` with:

```text
node C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js install --package-lock-only --ignore-scripts --legacy-peer-deps --include=dev --include=optional --userconfig <disposable npmrc> --cache <disposable cache> --audit=false --fund=false
```

Result: exit code 0, lockfile synchronized.

```text
node C:\nvm4w\nodejs\node_modules\npm\bin\npm-cli.js audit --json --ignore-scripts --userconfig <disposable npmrc> --cache <disposable cache> --fund=false
```

Result: exit code 0; `critical=0`, `high=0`, `moderate=0`, `low=0`, `total=0`.

```text
npm ci --ignore-scripts --legacy-peer-deps --userconfig <disposable npmrc> --cache <disposable cache> --fund=false --audit=false
node -e "console.log(require('./node_modules/next/package.json').version)"
```

Result: clean dependency installation completed and `NEXT_VERSION=16.3.5`.

The standalone TypeScript check was also attempted after `npm ci --ignore-scripts`. It is not a dependency-audit pass: it fails because this script intentionally skips Prisma generation and the existing checkout has baseline type errors, including missing generated Prisma exports and existing implicit-any errors. No assertion or quality gate was lowered to hide those errors.

## Checkpoint

This evidence records the dependency and audit result only. Production deployment, database access, secret loading, and external side effects were not performed.
