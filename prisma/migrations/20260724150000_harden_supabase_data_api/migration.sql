-- CelebrateDeal accesses application tables through server-side Prisma only.
-- Keep the Supabase Data API default-deny: API roles receive no direct object
-- privileges, and every existing public table gets RLS as defense in depth.
-- Plain PostgreSQL used by local/CI does not define Supabase API roles, so
-- revoke those roles conditionally while always revoking ambient PUBLIC access.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

DO $data_api_roles$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
        api_role
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
        api_role
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$data_api_roles$;

DO $data_api_hardening$
DECLARE
  table_record record;
BEGIN
  FOR table_record IN
    SELECT namespace.nspname AS schema_name, relation.relname AS table_name
    FROM pg_catalog.pg_class AS relation
    INNER JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p')
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      table_record.schema_name,
      table_record.table_name
    );
  END LOOP;
END
$data_api_hardening$;

-- Apply default privileges to whichever dedicated role executes migrations.
-- This is postgres on Supabase and remains portable to isolated/CI databases
-- that use a differently named migration owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES
  FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM PUBLIC;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS
  FROM PUBLIC;

DO $data_api_default_roles$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
        'REVOKE ALL PRIVILEGES ON TABLES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
        'REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
        api_role
      );
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
        'REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$data_api_default_roles$;

-- No Data API policies are created intentionally. Browser clients do not use
-- these tables; server-side Prisma continues to use the table-owning role.
