-- F-036 (B02-14): a platform administrator can suspend a whole tenant.
--
-- While "suspendedAt" is set, every back-office user of the vendor only sees
-- the "商家已暫停" page (getCurrentAuth returns no vendor context), public
-- pages answer 404, scheduled jobs skip the vendor's email and LINE delivery,
-- and paid provider callbacks are still recorded but do not grant access.
-- Only the platform admin actions in /admin/vendor-features write these
-- columns (recent MFA step-up + AuditLog); the reason is internal.
--
-- Forward-only and additive: two nullable columns without defaults are a
-- metadata-only change. No backfill: every existing vendor stays active.
-- Every existing row satisfies the CHECK (both columns NULL); its validation
-- scan only reads the small Vendor table.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Vendor"
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedReason" TEXT;

-- A reason exists only on a suspended vendor, is trimmed, and is 1-500
-- characters (VENDOR_SUSPENSION_REASON_MAX_LENGTH in src/lib/vendor-suspension.ts).
ALTER TABLE "Vendor"
  ADD CONSTRAINT "Vendor_suspension_check" CHECK (
    ("suspendedAt" IS NULL AND "suspendedReason" IS NULL)
    OR (
      "suspendedAt" IS NOT NULL
      AND "suspendedReason" IS NOT NULL
      AND "suspendedReason" = btrim("suspendedReason")
      AND char_length("suspendedReason") BETWEEN 1 AND 500
    )
  );
