-- Login email change from account settings (src/lib/account-email-change.ts).
--
-- A signed-in user asks to change their login email; a single-use link goes
-- to the new address and completing it sets "User"."email" and
-- "emailVerifiedAt" together. This table holds the pending request between
-- the two steps.
--
-- Forward-only and additive: one new table, no existing row changes.
-- Only the SHA-256 of the e-mailed token is stored ("tokenHash"); the token
-- itself is never stored. "newEmail" is stored normalized (trimmed and
-- lowercased, the registration rule) because the confirmation must write it.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

CREATE TABLE "UserEmailChangeRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEmailChangeRequest_pkey" PRIMARY KEY ("id"),
    -- Same normalization and bound as registration (LOGIN_EMAIL_MAX_LENGTH).
    CONSTRAINT "UserEmailChangeRequest_newEmail_check"
        CHECK ("newEmail" = lower(btrim("newEmail")) AND char_length("newEmail") BETWEEN 3 AND 320),
    CONSTRAINT "UserEmailChangeRequest_tokenHash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "UserEmailChangeRequest_expiresAt_check" CHECK ("expiresAt" > "createdAt"),
    -- A request ends exactly once: completed or revoked, never both.
    CONSTRAINT "UserEmailChangeRequest_single_outcome_check" CHECK ("consumedAt" IS NULL OR "revokedAt" IS NULL)
);

CREATE UNIQUE INDEX "UserEmailChangeRequest_tokenHash_key" ON "UserEmailChangeRequest"("tokenHash");

CREATE INDEX "UserEmailChangeRequest_userId_createdAt_idx" ON "UserEmailChangeRequest"("userId", "createdAt");

CREATE INDEX "UserEmailChangeRequest_expiresAt_idx" ON "UserEmailChangeRequest"("expiresAt");

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
