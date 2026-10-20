-- F-026 / B04-08: restore "every public table has RLS" as defense in depth.
--
-- 20260724150000_harden_supabase_data_api enabled RLS only on the tables that
-- existed at that time, and later migrations enabled it table by table, so
-- roughly 70 public tables (CommerceOrder, SupportCase, EmailDelivery, ...)
-- were created without it. This migration closes that gap for every ordinary
-- and partitioned table in public that still has relrowsecurity = false.
--
-- No policies are created on purpose. CelebrateDeal reads and writes these
-- tables only through server-side Prisma, which connects as the table-owning
-- role and therefore bypasses RLS (FORCE ROW LEVEL SECURITY is not used).
-- For the Supabase Data API roles (anon, authenticated) RLS without a policy
-- is default-deny, which is the second barrier behind the missing grants.
--
-- Default privileges are not repeated here: 20260724150000 already ran
-- ALTER DEFAULT PRIVILEGES ... REVOKE ALL for PUBLIC, anon, authenticated and
-- service_role, and src/lib/rls-catalog.db.test.ts asserts the outcome.
--
-- Safety:
-- * Idempotent. Only tables with relrowsecurity = false are touched, so the
--   statement can be re-run on a database where some or all tables are
--   already enabled (a fully enabled database is a no-op).
-- * ENABLE ROW LEVEL SECURITY is a catalog-only change (no table rewrite or
--   scan), but it needs an ACCESS EXCLUSIVE lock per table. lock_timeout is
--   set transaction-locally so a long-running query cannot make this
--   migration queue every later request on that table; if a lock is not
--   granted in time the whole migration rolls back and can be retried with
--   `prisma migrate resolve --rolled-back 20261020090000_enable_rls_all_tables`
--   followed by `prisma migrate deploy`.
-- * Tables are processed in a stable name order so concurrent runs cannot
--   deadlock each other.
DO $enable_rls_all_tables$
DECLARE
  table_record record;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  FOR table_record IN
    SELECT relation.relname AS table_name
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
      AND NOT relation.relrowsecurity
    ORDER BY relation.relname
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',
      table_record.table_name
    );
  END LOOP;
END
$enable_rls_all_tables$;
