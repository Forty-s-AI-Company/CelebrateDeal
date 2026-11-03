-- F-031 ②③: accept DATA_ENCRYPTION_KEYRING envelopes ("v2.<kid>.<iv>.<tag>.<data>")
-- next to the original root-key envelopes ("v1.<iv>.<tag>.<data>") in the two
-- columns whose CHECK constraints pinned the "v1." prefix. Without this, a
-- keyring with a non-legacy active key could not store private chat messages
-- or registration retry drafts, and scripts/reencrypt-sensitive-data.ts
-- could not move existing rows.
--
-- It also lets SupportRefundHandoff."reasonEncryptedEnvelope" be re-encrypted:
-- the handoff trigger kept it immutable, so a re-encryption run could never
-- move it off a retired kid. Only a transaction that sets
-- celebratedeal.sensitive_data_reencrypt = on (the re-encrypt script) may
-- change it, and only to another well-formed envelope; every other column and
-- every other rule of the trigger is unchanged (copied from
-- 20260809050000_g7_26_split_refund_handoff).
--
-- Forward-only. Each table drops and re-adds its CHECK in one ALTER TABLE
-- (one short ACCESS EXCLUSIVE lock per table). Every existing row is a v1
-- envelope, which the new constraints still accept, so validation cannot
-- fail. The patterns match src/lib/sensitive-data.ts
-- (isWellFormedSensitiveEnvelope): kid 1–32 of [a-z0-9_-] starting with a
-- letter or digit, 12-byte IV (16 base64url chars), 16-byte tag (22 chars).
SELECT pg_catalog.set_config('lock_timeout', '5s', true);

ALTER TABLE "LivePrivateChatMessage"
  DROP CONSTRAINT "LivePrivateChatMessage_envelope_check",
  ADD CONSTRAINT "LivePrivateChatMessage_envelope_check" CHECK (
    char_length("bodyEncrypted") <= 8192
    AND (
      "bodyEncrypted" ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
      OR "bodyEncrypted" ~ '^v2\.[a-z0-9][a-z0-9_-]{0,31}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
    )
  );

-- The bound grows by the longest v2 header (76 characters: "v2." + 32-char
-- kid + "." + IV + "." + tag + "."); src/lib/registration-form-retry.ts
-- (envelopeChars) keeps an 80-character margin and the same maximum, 533416.
ALTER TABLE "RegistrationFormRetryDraft"
  DROP CONSTRAINT "RegistrationFormRetryDraft_payload_check",
  ADD CONSTRAINT "RegistrationFormRetryDraft_payload_check" CHECK (
    "encryptedPayload" ~ '^v[12]\.' AND char_length("encryptedPayload") <= 533416
  );

CREATE OR REPLACE FUNCTION enforce_support_refund_handoff_order() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  order_payment_id TEXT;
  order_status "CommerceOrderStatus";
  order_paid INTEGER;
  order_refunded INTEGER;
  completion_link_count INTEGER;
  completion_amount INTEGER;
  invalid_completion_count INTEGER;
BEGIN
  SELECT "primaryPaymentTransactionId", "status", "paidAmountCents", "refundedAmountCents"
  INTO order_payment_id, order_status, order_paid, order_refunded
  FROM "CommerceOrder"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderId";

  IF NOT FOUND
    OR order_payment_id IS DISTINCT FROM NEW."paymentTransactionId"
    OR order_status NOT IN ('paid', 'partially_refunded', 'refunded')
  THEN
    RAISE EXCEPTION 'Support refund handoff does not match a refundable canonical order.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_order_check';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."supportCaseId" IS DISTINCT FROM OLD."supportCaseId"
    OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
    OR NEW."paymentTransactionId" IS DISTINCT FROM OLD."paymentTransactionId"
    OR NEW."requestedByMemberId" IS DISTINCT FROM OLD."requestedByMemberId"
    OR NEW."requestedAmountCents" IS DISTINCT FROM OLD."requestedAmountCents"
    -- F-031: the reason may change only as a re-encryption run, which sets the
    -- transaction-local flag (scripts/reencrypt-sensitive-data.ts), and only
    -- into another well-formed sensitive-data envelope. The script writes it
    -- after decrypting the old value and checking the new one decrypts to the
    -- same plaintext; application code never sets the flag.
    OR (
      NEW."reasonEncryptedEnvelope" IS DISTINCT FROM OLD."reasonEncryptedEnvelope"
      AND NOT (
        COALESCE(current_setting('celebratedeal.sensitive_data_reencrypt', true), '') = 'on'
        AND (
          NEW."reasonEncryptedEnvelope" ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
          OR NEW."reasonEncryptedEnvelope" ~ '^v2\.[a-z0-9][a-z0-9_-]{0,31}\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
        )
      )
    )
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Support refund handoff commercial identity is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_immutable_check';
  END IF;

  IF TG_OP = 'INSERT' AND NEW."requestedAmountCents" > order_paid - order_refunded THEN
    RAISE EXCEPTION 'Support refund handoff exceeds the remaining refundable amount.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_remaining_check';
  END IF;

  IF NEW."status" = 'completed' THEN
    SELECT
      COUNT(*)::INTEGER,
      COALESCE(SUM(link."amountCentsSnapshot"), 0)::INTEGER,
      COUNT(*) FILTER (
        WHERE refund."id" IS NULL
          OR refund."status" IS DISTINCT FROM 'processed'
          OR refund."paymentTransactionId" IS DISTINCT FROM NEW."paymentTransactionId"
          OR refund."amountCents" IS DISTINCT FROM link."amountCentsSnapshot"
      )::INTEGER
    INTO completion_link_count, completion_amount, invalid_completion_count
    FROM "SupportRefundHandoffRefund" AS link
    LEFT JOIN "CommerceOrderRefund" AS refund
      ON refund."vendorId" = link."vendorId"
      AND refund."orderId" = link."orderId"
      AND refund."id" = link."refundId"
    WHERE link."vendorId" = NEW."vendorId"
      AND link."handoffId" = NEW."id"
      AND link."orderId" = NEW."orderId";

    IF completion_link_count < 1
      OR completion_amount <> NEW."requestedAmountCents"
      OR invalid_completion_count > 0
      OR NOT EXISTS (
        SELECT 1
        FROM "SupportRefundHandoffRefund" AS anchor
        WHERE anchor."vendorId" = NEW."vendorId"
          AND anchor."handoffId" = NEW."id"
          AND anchor."refundId" = NEW."completedRefundId"
      )
    THEN
      RAISE EXCEPTION 'Support refund completion requires exact processed canonical refund links.'
        USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_completion_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
