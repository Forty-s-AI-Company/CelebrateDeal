-- F-050 / B04-06 / DB-I01: one payment transaction per provider order number.
--
-- PayUni's real UPP callback does not carry a vendor id, so the webhook
-- resolves the tenant by ("providerName", "orderNumber"). Without a unique
-- key a collision made the paid callback ambiguous (never settled) and every
-- lookup scanned the whole table. Order numbers are now generated from
-- crypto.randomBytes (70 bits) and creators regenerate once on P2002.
--
-- Rows with a NULL "orderNumber" are unaffected: PostgreSQL unique indexes
-- treat NULLs as distinct, so this full index enforces exactly the same rule
-- as `... WHERE "orderNumber" IS NOT NULL` while staying expressible as
-- @@unique(..., map: ...) in schema.prisma (no drift-allowlist entry).
--
-- Preflight: refuse to build the index while duplicates exist. The exception
-- lists only counts, never order numbers or tenant ids. Resolve duplicates
-- manually (see docs/codex-goal/PRISMA_INVARIANTS.md DB-I01), mark this
-- migration rolled back, and deploy again.
DO $$
DECLARE
  duplicate_groups bigint;
  duplicate_rows bigint;
BEGIN
  -- Transaction-scoped: also bounds the CREATE INDEX lock wait below.
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  SELECT count(*), coalesce(sum(group_rows), 0)
    INTO duplicate_groups, duplicate_rows
    FROM (
      SELECT count(*) AS group_rows
        FROM "PaymentTransaction"
       WHERE "orderNumber" IS NOT NULL
       GROUP BY "providerName", "orderNumber"
      HAVING count(*) > 1
    ) duplicates;
  IF duplicate_groups > 0 THEN
    RAISE EXCEPTION 'PaymentTransaction has % duplicated (providerName, orderNumber) groups covering % rows; resolve them before adding PaymentTransaction_providerName_orderNumber_key', duplicate_groups, duplicate_rows;
  END IF;
END $$;

CREATE UNIQUE INDEX "PaymentTransaction_providerName_orderNumber_key"
  ON "PaymentTransaction"("providerName", "orderNumber");
