-- A-2 05 (#664 review): the pending-payment reconciler's scan
-- (src/lib/payment-pending-reconciliation.ts):
--   FROM "PaymentTransaction" t
--   WHERE t."providerName" = 'payuni' AND t."status" IN ('pending', 'expired')
--     AND t."createdAt" BETWEEN now() - 3 days AND now() - 15 minutes ...
-- runs every 5 minutes. The existing (status, occurredAt) index reads every
-- pending/expired payment of every provider and filters createdAt row by row.
-- This partial index holds only PayUni payments without a provider decision,
-- ordered by createdAt, so the scan reads just its window.
--
-- Forward-only and additive: one partial b-tree index, no column, constraint
-- or data change. The predicate must match the scan word for word.
--
-- PaymentTransaction is a hot table (docs/production-database-runbook.md
-- §5.3), so the index is built CONCURRENTLY: checkouts and payment callbacks
-- keep writing while it builds. CONCURRENTLY cannot run inside a transaction,
-- and Prisma sends a migration file as one batch, which PostgreSQL runs as one
-- implicit transaction when it holds more than one statement; so this file
-- holds this single statement and nothing else (no DO block, no set_config),
-- same as 20261119090000. lock_timeout therefore comes from the deploy session.
-- IF NOT EXISTS makes a retry a no-op only once the index is valid: a failed or
-- cancelled build leaves an INVALID index of this name, which must be dropped
-- first (runbook §5.2, step 3:
-- DROP INDEX CONCURRENTLY IF EXISTS "PaymentTransaction_payuni_reconcilable_createdAt_idx";)
-- before `migrate resolve --rolled-back` and the retry.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PaymentTransaction_payuni_reconcilable_createdAt_idx"
  ON "PaymentTransaction" ("createdAt")
  WHERE "providerName" = 'payuni' AND "status" IN ('pending', 'expired');
