-- 「更換場次」 links for 指定場次 (src/lib/live-session-switch.ts).
--
-- The already-registered notice carries a signed, 24-hour link bound to the
-- registration and the session it holds. Redeeming it (a POST from the
-- confirmation page, never the GET a mail scanner makes) inserts one row
-- here; the primary key is the SHA-256 of the token's nonce, so the same link
-- can never be redeemed twice.
--
-- Forward-only and additive: one new table, no existing row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- CreateTable
CREATE TABLE "LiveSessionSwitchRedemption" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "formSubmissionId" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveSessionSwitchRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveSessionSwitchRedemption_formSubmissionId_idx" ON "LiveSessionSwitchRedemption"("formSubmissionId");

-- CreateIndex
CREATE INDEX "LiveSessionSwitchRedemption_vendorId_liveSessionId_idx" ON "LiveSessionSwitchRedemption"("vendorId", "liveSessionId");

-- AddForeignKey
ALTER TABLE "LiveSessionSwitchRedemption" ADD CONSTRAINT "LiveSessionSwitchRedemption_formSubmissionId_fkey" FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- The session's own (vendorId, id) key: a row can only name a session of the vendor it records.
ALTER TABLE "LiveSessionSwitchRedemption" ADD CONSTRAINT "LiveSessionSwitchRedemption_vendorId_liveSessionId_fkey" FOREIGN KEY ("vendorId", "liveSessionId") REFERENCES "LiveSession"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "LiveSessionSwitchRedemption" ENABLE ROW LEVEL SECURITY;
