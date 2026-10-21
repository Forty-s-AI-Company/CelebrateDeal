-- F-073 / B04-20: validate PaymentAccount_bankAccountNumber_masked_check,
-- added NOT VALID by 20261021140200_payment_account_payout_verification after
-- that migration masked every remaining plaintext row.
--
-- Separate migration so the scan runs in its own transaction under SHARE
-- UPDATE EXCLUSIVE only (reads and writes continue). Rows written since the
-- previous migration were already checked on write, so this cannot fail on
-- data.
SELECT pg_catalog.set_config('lock_timeout', '5s', true);

ALTER TABLE "PaymentAccount" VALIDATE CONSTRAINT "PaymentAccount_bankAccountNumber_masked_check";
