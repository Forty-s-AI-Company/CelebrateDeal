# Fixed staging migration apply gate

This gate is **not executable yet**. Current prerequisite receipts have no per-run database identity. The new workflow remains `BLOCKED` before any database command until the three trusted producers publish the versions below, for the same fixed staging database and source commit. Do not dispatch it merely because a 58/79 status or isolated replay succeeded.

The only permitted source is `9193326824b8b6bf774bdfa28e4783a1a1b8f304`. The apply workflow is manual, runs only from protected `master`, and uses GitHub Environment `Preview – celebrate-deal-staging`. It verifies a successful non-Production Preview deployment for that source and exact hostname, plus the protected run provenance of all prerequisite artifacts. It neither merges, pushes nor deploys an application.

## Producer contract required before dispatch

All three producer receipts need `sourceCommit` equal to the fixed SHA, `projectRef`, `deploymentHost`, and `databaseIdentitySha256`. The digest is SHA-256 over UTF-8 bytes of exactly:

```text
<lowercase database hostname>\n<port>\n/postgres\n<decoded database username>\npublic
```

There is no final newline. Do not hash or print the password. The URL may contain only an optional `schema=public` query. The project ref must equal the protected `STAGING_PROJECT_REF`, the Supabase API hostname prefix, and the direct DB hostname or pooler username suffix. The known Production project ref is explicitly denied. Protected `STAGING_DATABASE_IDENTITY_SHA256` must equal the digest. Changing the database binding between producer runs changes the digest and blocks apply.

Required receipt upgrades:

| Producer | Required schema and fields beyond the common binding |
| --- | --- |
| `Staging isolated migration replay` | `celebratedeal-staging-isolated-migration-replay/v2`; `result=PASS`, `stage=ISOLATED_SQL_REPLAY_COMPLETE`, `beforeCount=58`, `afterCount=79`, `replayedCount=21`, `sourceAggregateMatched=true`, `postReplaySchemaVerified=true`, `postReplayHistoryUnchanged=true`, `databaseWrites=0`. The digest must describe the *source* DB that was read for this replay. |
| `Secure staging validation`, task `wp2-readonly-restore` | `celebratedeal-secure-staging-wp2/v3`; `result=PASS`, `retention.status=ENCRYPTED`, `retention.retained=true`, `archiveDigest` as 64 lowercase hex digits, `backupRunId` equal to the producing run ID, `migrationAuthorization=BLOCKED`. The current v2 backup receipt alone remains insufficient. |
| `Staging encrypted backup recovery drill` | `celebratedeal-staging-encrypted-backup-recovery/v2`; `result=PASS`, `restoreResult=PASS`, `isolated=true`, `backupRunId` equal to the backup run ID, `recoveryRunId` equal to its producing run ID, `archiveDigest` equal to the retained encrypted archive digest. The common DB digest identifies the source of that archive, not the isolated restore target. |

All three artifacts must come from completed successful `workflow_dispatch` runs on `master`, with the exact producer workflow paths in `scripts/staging-migration-apply.mjs`. Each producing workflow commit must be an ancestor of the apply workflow's protected `master` HEAD; the receipts themselves bind to the fixed app source SHA. The trusted workflow separately checks PR #277 head and the non-Production GitHub deployment at that exact SHA. It checks out PR #277 head only as migration SQL data; the executable runner and Prisma schema come from protected `master`. Squash merge means the app source commit does not need to be a `master` ancestor. The replay and recovery workflows and artifact names must be added or confirmed when their producer implementations land. A receipt's self-asserted result cannot replace GitHub run provenance. All artifact files must be sanitized and below 64 KiB; the apply receipt contains only status, counts, digest and normalized failure code.

Once the producer contracts exist, the runner checks that trusted `master` contains exactly the source's 79 migration files, that the live fixed DB has the first 58 active migrations and no unresolved failures, and that `Vendor.enabledFeatureModules` is absent. It suppresses raw Prisma/psql output. After a migration attempt it checks all 79 active migrations and the column. Any failed or ambiguous postcheck is `FAILED` and needs manual recovery analysis; the runner never retries automatically.

The current prerequisite receipts lack the common DB digest and run bindings. No key or disposable-data confirmation has been configured for this work. The local tests only exercise the gate with synthetic values; they do not connect to staging or prove the 21 SQL files safe.
