-- Private conversations never reuse the public chat table or plaintext body.
CREATE TABLE "LivePrivateChatMessage" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "liveId" TEXT NOT NULL,
  "formSubmissionId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "authorMemberId" TEXT,
  "bodyEncrypted" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LivePrivateChatMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LivePrivateChatMessage_id_check" CHECK ("id" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "LivePrivateChatMessage_author_check" CHECK (
    ("source" = 'viewer' AND "authorMemberId" IS NULL)
    OR ("source" = 'instructor' AND "authorMemberId" IS NOT NULL)
  ),
  CONSTRAINT "LivePrivateChatMessage_envelope_check" CHECK (
    char_length("bodyEncrypted") <= 8192
    AND "bodyEncrypted" ~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$'
  ),
  CONSTRAINT "LivePrivateChatMessage_vendor_fkey" FOREIGN KEY ("vendorId")
    REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LivePrivateChatMessage_live_fkey" FOREIGN KEY ("vendorId", "liveId")
    REFERENCES "Live"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LivePrivateChatMessage_submission_fkey" FOREIGN KEY ("liveId", "formSubmissionId")
    REFERENCES "FormSubmission"("liveId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LivePrivateChatMessage_author_fkey" FOREIGN KEY ("vendorId", "authorMemberId")
    REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LivePrivateChatMessage_conversation_idx"
  ON "LivePrivateChatMessage"("vendorId", "liveId", "formSubmissionId", "createdAt", "id");
