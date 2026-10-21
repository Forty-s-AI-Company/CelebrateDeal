-- F-028 / B02-05: account-level rate limits that do not depend on
-- RATE_LIMIT_PROVIDER.
--
-- With RATE_LIMIT_PROVIDER=cloudflare_waf every in-app limit was skipped,
-- including the per-account limits on TOTP verification and recovery-code
-- regeneration. A WAF only counts per source IP, so a stolen password plus a
-- spread of IPs had no per-account ceiling. Account limits now count in this
-- table; the provider only covers the IP layer.
--
-- Forward-only and additive: one new table, no existing row changes.
-- keyHash is SHA-256(scope, subject) so no e-mail address is stored in clear.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

CREATE TABLE "AccountRateLimitBucket" (
    "keyHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountRateLimitBucket_pkey" PRIMARY KEY ("keyHash"),
    CONSTRAINT "AccountRateLimitBucket_keyHash_check" CHECK ("keyHash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "AccountRateLimitBucket_count_check" CHECK ("count" >= 1)
);

CREATE INDEX "AccountRateLimitBucket_updatedAt_idx" ON "AccountRateLimitBucket"("updatedAt");

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "AccountRateLimitBucket" ENABLE ROW LEVEL SECURITY;
