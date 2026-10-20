-- F-073 / B04-20: the legacy PaymentAccount bank columns may only hold the
-- masked display value. The full account lives exclusively in the encrypted
-- "bankAccountEncrypted" envelope written by saveVendorPayoutAccount
-- (src/lib/vendor-payout-account.ts) or by
-- scripts/backfill-bank-account-encryption.ts. This stops manual SQL from
-- putting a plaintext account number into the table and its backups.
--
-- Preflight: refuse to add the constraint while plaintext rows exist. The
-- exception only reports a count. Run the backfill first (it encrypts the row
-- and rewrites the legacy columns with masked values), mark this migration
-- rolled back, and deploy again. Read-only preflight query:
--
--   SELECT count(*) FROM "PaymentAccount"
--    WHERE "bankAccountNumber" IS NOT NULL AND "bankAccountNumber" NOT LIKE '****%';
--
-- The constraint is added NOT VALID (no table scan under the ACCESS EXCLUSIVE
-- lock) and then validated, which only takes SHARE UPDATE EXCLUSIVE and does
-- not block reads or writes. '*' is not a LIKE wildcard.
DO $$
DECLARE
  plaintext_rows bigint;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
  SELECT count(*) INTO plaintext_rows
    FROM "PaymentAccount"
   WHERE "bankAccountNumber" IS NOT NULL
     AND "bankAccountNumber" NOT LIKE '****%';
  IF plaintext_rows > 0 THEN
    RAISE EXCEPTION 'PaymentAccount has % rows with an unmasked legacy bankAccountNumber; run scripts/backfill-bank-account-encryption.ts before adding PaymentAccount_bankAccountNumber_masked_check', plaintext_rows;
  END IF;
END $$;

ALTER TABLE "PaymentAccount"
  ADD CONSTRAINT "PaymentAccount_bankAccountNumber_masked_check"
  CHECK ("bankAccountNumber" IS NULL OR "bankAccountNumber" LIKE '****%') NOT VALID;

ALTER TABLE "PaymentAccount"
  VALIDATE CONSTRAINT "PaymentAccount_bankAccountNumber_masked_check";
