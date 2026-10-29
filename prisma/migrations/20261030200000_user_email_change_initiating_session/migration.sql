-- Login email change: remember which session requested the change
-- (src/lib/account-email-change.ts).
--
-- A revert removes an MFA factor enrolled since the requester's session
-- began, so signing in, enrolling a factor and only then requesting the
-- change no longer keeps that factor. "initiatingSessionCreatedAt" is copied
-- from "UserSession"."createdAt" when the request is stored, so the cutoff
-- survives the session being revoked or deleted. "initiatingSessionId" is a
-- reference only (no FK: sessions are revoked and may be cleaned up).
--
-- Forward-only and additive: two nullable columns and one CHECK. Rows stored
-- before this migration keep NULL in both; the revert then falls back to
-- request "createdAt" minus 24 hours (ACCOUNT_EMAIL_REVERT_LEGACY_FACTOR_WINDOW_MS).
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "UserEmailChangeRequest"
    ADD COLUMN "initiatingSessionId" TEXT,
    ADD COLUMN "initiatingSessionCreatedAt" TIMESTAMP(3);

-- Both or neither. No ordering against "createdAt": the session time comes
-- from the database default and the request time from the application
-- clock, which may differ slightly; the revert takes the earlier of the two.
ALTER TABLE "UserEmailChangeRequest"
    ADD CONSTRAINT "UserEmailChangeRequest_initiating_session_check"
    CHECK (("initiatingSessionId" IS NULL) = ("initiatingSessionCreatedAt" IS NULL));