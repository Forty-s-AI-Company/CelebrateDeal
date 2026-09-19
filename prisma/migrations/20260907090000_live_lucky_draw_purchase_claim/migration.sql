-- Server-owned purchase identity and non-reversible lucky-draw claim material.
ALTER TABLE "LiveInteractionResponse"
  ADD COLUMN "formSubmissionId" TEXT,
  ADD COLUMN "winnerClaimCodeEncryptedEnvelope" TEXT,
  ADD COLUMN "winnerClaimedAt" TIMESTAMP(3);

CREATE INDEX "LiveInteractionResponse_vendorId_liveId_formSubmissionId_idx"
  ON "LiveInteractionResponse"("vendorId", "liveId", "formSubmissionId");

ALTER TABLE "LiveInteractionResponse"
  ADD CONSTRAINT "LiveInteractionResponse_formSubmissionId_fkey"
  FOREIGN KEY ("formSubmissionId") REFERENCES "FormSubmission"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
