-- G8.01: additive domain foundation for the one-stop webinar flow.
-- Existing columns and indexes are intentionally preserved so this migration
-- can be applied without rewriting or deleting prelaunch data.

ALTER TABLE "Live"
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "replayAvailableUntil" TIMESTAMP(3),
  ADD CONSTRAINT "Live_lifecycle_check"
    CHECK ("endedAt" IS NULL OR "startedAt" IS NULL OR "endedAt" >= "startedAt"),
  ADD CONSTRAINT "Live_replay_lifecycle_check"
    CHECK (
      "replayAvailableUntil" IS NULL
      OR "endedAt" IS NULL
      OR "replayAvailableUntil" >= "endedAt"
    );

ALTER TABLE "RegistrationForm"
  ADD COLUMN "heroImageUrl" TEXT,
  ADD COLUMN "heroImageAssetId" TEXT,
  ADD COLUMN "backgroundImageUrl" TEXT,
  ADD COLUMN "backgroundImageAssetId" TEXT,
  ADD COLUMN "promoVideoId" TEXT,
  ADD COLUMN "themeColor" TEXT,
  ADD COLUMN "countdownMinutes" INTEGER,
  ADD COLUMN "stickyText" TEXT,
  ADD COLUMN "bodyContent" TEXT,
  ADD COLUMN "notice" TEXT,
  ADD COLUMN "seoTitle" TEXT,
  ADD COLUMN "seoDescription" TEXT,
  ADD COLUMN "maxVisibleSessions" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hideExpiredSessions" BOOLEAN NOT NULL DEFAULT true,
  ADD CONSTRAINT "RegistrationForm_countdownMinutes_check"
    CHECK ("countdownMinutes" IS NULL OR "countdownMinutes" BETWEEN 0 AND 10080),
  ADD CONSTRAINT "RegistrationForm_maxVisibleSessions_check"
    CHECK ("maxVisibleSessions" BETWEEN 0 AND 99);

ALTER TABLE "LiveProduct"
  ADD COLUMN "offerPriceCents" INTEGER,
  ADD COLUMN "isVisible" BOOLEAN NOT NULL DEFAULT true,
  ADD CONSTRAINT "LiveProduct_offerPriceCents_check"
    CHECK ("offerPriceCents" IS NULL OR "offerPriceCents" >= 0);

ALTER TABLE "InteractionRole"
  ADD COLUMN "isSimulated" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "InteractionEvent"
  ADD COLUMN "isSimulated" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "FormSubmission_liveId_id_key"
  ON "FormSubmission"("liveId", "id");

CREATE UNIQUE INDEX "InteractionRole_vendorId_id_key"
  ON "InteractionRole"("vendorId", "id");

ALTER TABLE "RegistrationForm"
  ADD CONSTRAINT "RegistrationForm_vendorId_heroImageAssetId_fkey"
    FOREIGN KEY ("vendorId", "heroImageAssetId")
    REFERENCES "ImageAsset"("vendorId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RegistrationForm_vendorId_backgroundImageAssetId_fkey"
    FOREIGN KEY ("vendorId", "backgroundImageAssetId")
    REFERENCES "ImageAsset"("vendorId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "RegistrationForm_vendorId_promoVideoId_fkey"
    FOREIGN KEY ("vendorId", "promoVideoId")
    REFERENCES "Video"("vendorId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Live_vendorId_status_replayAvailableUntil_idx"
  ON "Live"("vendorId", "status", "replayAvailableUntil");

CREATE INDEX "LiveProduct_vendorId_liveId_isVisible_sortOrder_idx"
  ON "LiveProduct"("vendorId", "liveId", "isVisible", "sortOrder");

CREATE TABLE "LiveChatMessage" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "liveId" TEXT NOT NULL,
  "formSubmissionId" TEXT,
  "roleId" TEXT,
  "authorName" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'viewer',
  "status" TEXT NOT NULL DEFAULT 'visible',
  "isSimulated" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LiveChatMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LiveChatMessage_source_check"
    CHECK ("source" IN ('viewer', 'scheduled', 'staff')),
  CONSTRAINT "LiveChatMessage_status_check"
    CHECK ("status" IN ('visible', 'hidden')),
  CONSTRAINT "LiveChatMessage_body_check"
    CHECK (char_length(btrim("body")) BETWEEN 1 AND 1000),
  CONSTRAINT "LiveChatMessage_identity_check"
    CHECK (
      ("source" = 'viewer' AND "formSubmissionId" IS NOT NULL AND "roleId" IS NULL)
      OR ("source" IN ('scheduled', 'staff') AND "roleId" IS NOT NULL)
    ),
  CONSTRAINT "LiveChatMessage_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LiveChatMessage_vendorId_liveId_fkey"
    FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LiveChatMessage_liveId_formSubmissionId_fkey"
    FOREIGN KEY ("liveId", "formSubmissionId")
    REFERENCES "FormSubmission"("liveId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LiveChatMessage_vendorId_roleId_fkey"
    FOREIGN KEY ("vendorId", "roleId") REFERENCES "InteractionRole"("vendorId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "LiveChatMessage_vendorId_liveId_createdAt_idx"
  ON "LiveChatMessage"("vendorId", "liveId", "createdAt");

CREATE INDEX "LiveChatMessage_liveId_createdAt_idx"
  ON "LiveChatMessage"("liveId", "createdAt");

CREATE INDEX "LiveChatMessage_vendorId_formSubmissionId_createdAt_idx"
  ON "LiveChatMessage"("vendorId", "formSubmissionId", "createdAt");

CREATE TABLE "LiveNotificationRule" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "liveId" TEXT NOT NULL,
  "messageTemplateId" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LiveNotificationRule_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LiveNotificationRule_trigger_check"
    CHECK ("trigger" IN ('before_live', 'during_live', 'post_live_followup')),
  CONSTRAINT "LiveNotificationRule_offsetMinutes_check"
    CHECK ("offsetMinutes" BETWEEN 0 AND 10080),
  CONSTRAINT "LiveNotificationRule_sortOrder_check"
    CHECK ("sortOrder" BETWEEN 0 AND 7),
  CONSTRAINT "LiveNotificationRule_vendorId_fkey"
    FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LiveNotificationRule_vendorId_liveId_fkey"
    FOREIGN KEY ("vendorId", "liveId") REFERENCES "Live"("vendorId", "id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LiveNotificationRule_vendorId_messageTemplateId_fkey"
    FOREIGN KEY ("vendorId", "messageTemplateId")
    REFERENCES "MessageTemplate"("vendorId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "LiveNotificationRule_vendorId_liveId_trigger_offsetMinutes_sortOrder_key"
  ON "LiveNotificationRule"("vendorId", "liveId", "trigger", "offsetMinutes", "sortOrder");

CREATE INDEX "LiveNotificationRule_vendorId_liveId_trigger_isActive_idx"
  ON "LiveNotificationRule"("vendorId", "liveId", "trigger", "isActive");
