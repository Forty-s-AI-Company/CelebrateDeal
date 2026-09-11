-- Extend the existing chat contract atomically. Legacy rows are never rewritten.
BEGIN;
ALTER TABLE "LiveChatMessage"
  DROP CONSTRAINT "LiveChatMessage_source_check",
  DROP CONSTRAINT "LiveChatMessage_identity_check",
  ADD CONSTRAINT "LiveChatMessage_source_check"
    CHECK ("source" IN ('viewer', 'scheduled', 'staff', 'private_viewer', 'private_instructor')),
  ADD CONSTRAINT "LiveChatMessage_identity_check"
    CHECK (
      ("source" = 'viewer' AND "formSubmissionId" IS NOT NULL AND "roleId" IS NULL)
      OR ("source" IN ('scheduled', 'staff') AND "roleId" IS NOT NULL)
      OR ("source" IN ('private_viewer', 'private_instructor')
          AND "formSubmissionId" IS NOT NULL AND "roleId" IS NULL AND "isSimulated" = false)
    );
-- Both polling and historical pagination always constrain this conversation scope.
CREATE INDEX "LiveChatMessage_private_conversation_idx"
  ON "LiveChatMessage" ("vendorId", "liveId", "formSubmissionId", "createdAt", "id");
COMMIT;
