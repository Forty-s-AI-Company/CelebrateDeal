-- WP-13 is forward-only. This migration deliberately fails before contract if
-- an active legacy source-less commission cannot be mapped to a trusted token.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AffiliateCommission"
    WHERE btrim("sourceType") = ''
  ) THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: blank sourceType exists';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "AffiliateCommission"
    WHERE "status" NOT IN ('pending', 'approved', 'locked', 'paid', 'void')
  ) THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: unknown status exists';
  END IF;

  -- A non-terminal row without a provider source can still be replayed. It
  -- cannot be safely guessed from amounts, dates, order numbers or referral codes.
  IF EXISTS (
    SELECT 1 FROM "AffiliateCommission"
    WHERE "sourceId" IS NULL
      AND "status" IN ('pending', 'approved', 'locked')
  ) THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: active NULL sourceId needs manual idempotency mapping';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "AffiliateCommission"
    WHERE ("sourceType" = 'refund_adjustment'
      AND NOT ("orderAmountCents" <= "commissionAmountCents" AND "commissionAmountCents" <= 0))
      OR ("sourceType" <> 'refund_adjustment'
        AND NOT ("orderAmountCents" >= 0 AND "commissionAmountCents" >= 0
          AND "commissionAmountCents" <= "orderAmountCents"))
  ) THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: legacy amount constraints fail';
  END IF;
END $$;

ALTER TABLE "AffiliateCommission" ADD COLUMN "deduplicationKey" TEXT;

DO $migration$
DECLARE
  pgcrypto_schema TEXT;
BEGIN
  -- pgcrypto may already live outside the schema selected by DATABASE_URL.
  -- Resolve it from PostgreSQL metadata instead of relying on search_path.
  SELECT namespace.nspname
    INTO pgcrypto_schema
  FROM pg_extension extension
  JOIN pg_namespace namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pgcrypto';

  IF pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: pgcrypto is unavailable';
  END IF;

  EXECUTE format($update$
    UPDATE "AffiliateCommission"
    SET "deduplicationKey" = CASE
      WHEN "sourceId" IS NULL THEN 'commission:v1|legacy:' || "id"
      ELSE 'commission:v1|sha256:' || encode(%I.digest(
        'commission:v1|beneficiary:' ||
          CASE WHEN "affiliateId" IS NULL THEN 'unassigned' ELSE 'affiliate:' || "affiliateId" END ||
          '|type:' || regexp_replace(lower(btrim("sourceType")), '\s+', '_', 'g') ||
          '|source:' || btrim("sourceId"),
        'sha256'), 'hex')
    END
  $update$, pgcrypto_schema);
END $migration$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "AffiliateCommission"
    GROUP BY "vendorId", "deduplicationKey"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'AffiliateCommission migration blocked: canonical deduplication collision needs manual resolution';
  END IF;
END $$;

ALTER TABLE "AffiliateCommission"
  ALTER COLUMN "deduplicationKey" SET NOT NULL;

ALTER TABLE "AffiliateCommission"
  DROP CONSTRAINT IF EXISTS "AffiliateCommission_deduplicationKey_nonblank",
  ADD CONSTRAINT "AffiliateCommission_deduplicationKey_nonblank"
    CHECK (btrim("deduplicationKey") <> ''),
  DROP CONSTRAINT IF EXISTS "AffiliateCommission_sourceType_nonblank",
  ADD CONSTRAINT "AffiliateCommission_sourceType_nonblank"
    CHECK (btrim("sourceType") <> ''),
  DROP CONSTRAINT IF EXISTS "AffiliateCommission_amount_by_sourceType",
  ADD CONSTRAINT "AffiliateCommission_amount_by_sourceType"
    CHECK (
      ("sourceType" = 'refund_adjustment'
        AND "orderAmountCents" <= "commissionAmountCents"
        AND "commissionAmountCents" <= 0)
      OR
      ("sourceType" <> 'refund_adjustment'
        AND "orderAmountCents" >= 0
        AND "commissionAmountCents" >= 0
        AND "commissionAmountCents" <= "orderAmountCents")
    );

CREATE TYPE "AffiliateCommissionStatus" AS ENUM ('pending', 'approved', 'locked', 'paid', 'void');
ALTER TABLE "AffiliateCommission" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "AffiliateCommission"
  ALTER COLUMN "status" TYPE "AffiliateCommissionStatus"
  USING "status"::"AffiliateCommissionStatus";
ALTER TABLE "AffiliateCommission"
  ALTER COLUMN "status" SET DEFAULT 'pending'::"AffiliateCommissionStatus";

DROP INDEX IF EXISTS "AffiliateCommission_vendorId_sourceType_sourceId_key";
CREATE UNIQUE INDEX "AffiliateCommission_vendorId_deduplicationKey_key"
  ON "AffiliateCommission"("vendorId", "deduplicationKey");
