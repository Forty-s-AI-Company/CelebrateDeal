-- Merchant email verification (owner decision 2026-10-25, required before
-- public registration). `emailVerifiedAt` is set only when the platform itself
-- e-mailed a link to the account's address and that link was opened:
-- the merchant verification link (src/lib/merchant-email-verification.ts),
-- an accepted vendor member invitation, or a completed password reset.
-- Registration invites are bearer links handed out by an administrator, so
-- they do not count.
--
-- Forward-only and additive: a nullable column without a default is a
-- metadata-only change. No backfill: existing accounts stay NULL ("legacy,
-- verification requested"); login and existing pages are unaffected, and only
-- new independent audience publishes require a verified owner.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
