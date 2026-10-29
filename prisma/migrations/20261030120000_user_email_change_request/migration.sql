-- Login email change from account settings (src/lib/account-email-change.ts).
--
-- A signed-in user asks to change their login email. A single-use change link
-- goes to the new address; completing it sets "User"."email" and
-- "emailVerifiedAt" together. A single-use revert link ("不是我操作，還原
-- Email") goes to the previous address: before completion it cancels the
-- change, afterwards (for seven days) it restores the previous address. This
-- table holds both steps.
--
-- Forward-only and additive: one new table, no existing row changes.
-- Only SHA-256 hashes of the e-mailed tokens are stored ("tokenHash",
-- "revertTokenHash"); the tokens themselves are never stored. Both addresses
-- are stored normalized (trimmed and lowercased, the registration rule)
-- because the confirmation and the revert must write them.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

CREATE TABLE "UserEmailChangeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "previousEmail" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revertTokenHash" TEXT NOT NULL,
    "revertExpiresAt" TIMESTAMP(3) NOT NULL,
    "revertedAt" TIMESTAMP(3),
    "revertRevokedAt" TIMESTAMP(3),
    -- Reference only (no FK): the workspace whose "Vendor"."email" followed the change.
    "syncedVendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEmailChangeRequest_pkey" PRIMARY KEY ("id"),
    -- Same normalization and bound as registration (LOGIN_EMAIL_MAX_LENGTH).
    CONSTRAINT "UserEmailChangeRequest_newEmail_check"
        CHECK ("newEmail" = lower(btrim("newEmail")) AND char_length("newEmail") BETWEEN 3 AND 320),
    CONSTRAINT "UserEmailChangeRequest_previousEmail_check"
        CHECK ("previousEmail" = lower(btrim("previousEmail")) AND char_length("previousEmail") BETWEEN 3 AND 320),
    CONSTRAINT "UserEmailChangeRequest_distinct_emails_check" CHECK ("previousEmail" <> "newEmail"),
    CONSTRAINT "UserEmailChangeRequest_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "UserEmailChangeRequest_revertTokenHash_check" CHECK ("revertTokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "UserEmailChangeRequest_expiresAt_check" CHECK ("expiresAt" > "createdAt"),
    -- A request ends exactly once: completed or revoked, never both.
    CONSTRAINT "UserEmailChangeRequest_single_outcome_check" CHECK ("consumedAt" IS NULL OR "revokedAt" IS NULL),
    -- A revert link ends exactly once: used or superseded, never both.
    CONSTRAINT "UserEmailChangeRequest_single_revert_outcome_check" CHECK ("revertedAt" IS NULL OR "revertRevokedAt" IS NULL)
);

CREATE UNIQUE INDEX "UserEmailChangeRequest_tokenHash_key" ON "UserEmailChangeRequest"("tokenHash");

CREATE UNIQUE INDEX "UserEmailChangeRequest_revertTokenHash_key" ON "UserEmailChangeRequest"("revertTokenHash");

CREATE INDEX "UserEmailChangeRequest_userId_createdAt_idx" ON "UserEmailChangeRequest"("userId", "createdAt");

CREATE INDEX "UserEmailChangeRequest_expiresAt_idx" ON "UserEmailChangeRequest"("expiresAt");

-- Reservation lookups: is this address still restorable by its previous owner?
CREATE INDEX "UserEmailChangeRequest_previousEmail_idx" ON "UserEmailChangeRequest"("previousEmail");

-- Seven-day change lock after a used revert.
CREATE INDEX "UserEmailChangeRequest_userId_revertedAt_idx" ON "UserEmailChangeRequest"("userId", "revertedAt");

-- At most one open (neither completed nor revoked) request per user. A new
-- request revokes the open one in the same transaction, under a row lock on
-- the user. Prisma 6 cannot express partial indexes; asserted by
-- src/lib/prisma-unmanaged-indexes.db.test.ts.
CREATE UNIQUE INDEX "UserEmailChangeRequest_one_open_per_user"
    ON "UserEmailChangeRequest"("userId")
    WHERE "consumedAt" IS NULL AND "revokedAt" IS NULL;

ALTER TABLE "UserEmailChangeRequest" ADD CONSTRAINT "UserEmailChangeRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "UserEmailChangeRequest" ENABLE ROW LEVEL SECURITY;
