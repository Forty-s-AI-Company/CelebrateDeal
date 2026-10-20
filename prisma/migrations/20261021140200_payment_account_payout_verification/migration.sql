-- F-073 / B04-20: merchant payout bank accounts.
--
-- 1. Merchant self-service changes wait before they can be paid out:
--    "bankAccountChangedAt" records the last change and "payoutEligibleAt"
--    the earliest time a "pending_verification" account may receive a payout
--    (src/lib/payout-account.ts). Nullable, no default: catalog-only.
--
-- 2. The legacy PaymentAccount bank columns may only hold the masked display
--    value; the full account lives exclusively in the encrypted
--    "bankAccountEncrypted" envelope. Run
--    scripts/backfill-bank-account-encryption.ts BEFORE this migration to keep
--    existing accounts payable (it encrypts and masks them). Any row that is
--    still plaintext when this migration runs is masked here instead of
--    blocking the deploy: the full number is dropped, the account becomes
--    ineligible for payouts (masked legacy value without an envelope), and one
--    AuditLog row per account ("payment_account_legacy_plaintext_masked",
--    no account data) tells the platform which merchants must re-enter their
--    payout account. Read-only preflight:
--
--      SELECT count(*) FROM "PaymentAccount"
--       WHERE "bankAccountNumber" IS NOT NULL AND "bankAccountNumber" NOT LIKE '****%';
--
-- 3. CHECK PaymentAccount_bankAccountNumber_masked_check is added NOT VALID
--    (no scan, enforced for every new write) and validated by the separate
--    migration 20261021140300_payment_account_masked_check_validate.
--    '*' is not a LIKE wildcard.
SELECT pg_catalog.set_config('lock_timeout', '5s', true);

ALTER TABLE "PaymentAccount" ADD COLUMN "bankAccountChangedAt" TIMESTAMP(3);
ALTER TABLE "PaymentAccount" ADD COLUMN "payoutEligibleAt" TIMESTAMP(3);

INSERT INTO "AuditLog" ("id", "vendorId", "actorLabel", "action", "targetType", "targetId", "after", "createdAt")
SELECT 'mig_' || replace(gen_random_uuid()::text, '-', ''),
       "vendorId",
       'migration:20261021140200',
       'payment_account_legacy_plaintext_masked',
       'PaymentAccount',
       "id",
       jsonb_build_object('hasEncryptedAccount', "bankAccountEncrypted" IS NOT NULL, 'requiresMerchantReentry', "bankAccountEncrypted" IS NULL),
       CURRENT_TIMESTAMP
  FROM "PaymentAccount"
 WHERE "bankAccountNumber" IS NOT NULL
   AND "bankAccountNumber" NOT LIKE '****%';

UPDATE "PaymentAccount"
   SET "bankAccountNumber" = '****' || right(regexp_replace("bankAccountNumber", '[^0-9A-Za-z]', '', 'g'), 4),
       "bankAccountName" = CASE
         WHEN "bankAccountName" IS NULL OR char_length("bankAccountName") <= 1 THEN "bankAccountName"
         ELSE left("bankAccountName", 1) || repeat('＊', least(char_length("bankAccountName") - 1, 4))
       END,
       "updatedAt" = CURRENT_TIMESTAMP
 WHERE "bankAccountNumber" IS NOT NULL
   AND "bankAccountNumber" NOT LIKE '****%';

ALTER TABLE "PaymentAccount"
  ADD CONSTRAINT "PaymentAccount_bankAccountNumber_masked_check"
  CHECK ("bankAccountNumber" IS NULL OR "bankAccountNumber" LIKE '****%') NOT VALID;
