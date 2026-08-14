-- FIN-2026-08-07-38: one platform referral commission per new subscription.
-- Renewals on the same subscription must not create a second referral sale.
-- This unique index is the race-safe database backstop; existing duplicates
-- fail the migration rather than being silently deleted or merged.
CREATE UNIQUE INDEX "PlatformReferralCommission_subscriptionId_key"
  ON "PlatformReferralCommission"("subscriptionId");
