-- Add an application-encrypted envelope without rewriting existing bank data.
-- Existing plaintext columns remain only as rollout compatibility fields; new
-- application writes store masked display values there. A separately approved
-- backfill must encrypt legacy rows before those compatibility columns can be
-- made non-sensitive or removed.
ALTER TABLE "PaymentAccount"
ADD COLUMN "bankAccountEncrypted" TEXT;

ALTER TABLE "PayoutItem"
ADD COLUMN "bankAccountEncrypted" TEXT;
