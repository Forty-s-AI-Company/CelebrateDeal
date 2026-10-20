-- F-026 / B04-08: restore "every public table has RLS" as defense in depth.
--
-- 20260724150000_harden_supabase_data_api enabled RLS only on the tables that
-- existed at that time, and later migrations enabled it table by table, so
-- roughly 70 public tables (CommerceOrder, SupportCase, EmailDelivery, ...)
-- were created without it. This migration closes that gap for every ordinary
-- and partitioned table in public that still has relrowsecurity = false,
-- including _prisma_migrations.
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
-- Preconditions and behaviour (see docs/operations/prisma-migration-guards-runbook.md):
-- * ENABLE ROW LEVEL SECURITY requires the privileges of the table owner;
--   BYPASSRLS is not enough. Before changing anything, the block checks every
--   table it would touch and raises one exception listing all tables whose
--   owner's privileges the migration role does not have, so nothing is
--   changed and the error names every blocker at once.
-- * Idempotent. Only tables with relrowsecurity = false are touched, so the
--   migration can be re-run on a database where some or all tables are
--   already enabled (a fully enabled database is a no-op).
-- * ENABLE ROW LEVEL SECURITY is a catalog-only change (no rewrite or scan),
--   but it takes an ACCESS EXCLUSIVE lock per table, and those locks are held
--   until the migration commits. While the block waits for one table, other
--   sessions queue behind the tables already locked. lock_timeout (2s,
--   transaction-local) bounds that wait: if a lock is not granted in time the
--   whole migration rolls back, nothing is changed, and it can be retried in
--   a quieter window with
--   `prisma migrate resolve --rolled-back 20261020090000_enable_rls_all_tables`
--   followed by `prisma migrate deploy`. Deploy outside peak traffic.
DO $enable_rls_all_tables$
DECLARE
  table_record record;
  blocked_tables text;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '2s', true);

  SELECT string_agg(
           format('%I (owner %I)', relation.relname, pg_catalog.pg_get_userbyid(relation.relowner)),
           ', ' ORDER BY relation.relname
         )
    INTO blocked_tables
  FROM pg_catalog.pg_class AS relation
  INNER JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind IN ('r', 'p')
    AND NOT relation.relrowsecurity
    AND NOT pg_catalog.pg_has_role(current_user, relation.relowner, 'USAGE');

  IF blocked_tables IS NOT NULL THEN
    RAISE EXCEPTION 'enable_rls_all_tables: role % lacks owner privileges on: %', current_user, blocked_tables
      USING HINT = 'Run the migration as the owner of these tables (or a role that inherits it), then prisma migrate resolve --rolled-back and deploy again.';
  END IF;

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
