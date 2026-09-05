-- Additive tenant-scoped persistence for configurable automation workflows.
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger" TEXT NOT NULL,
    "condition" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationExecutionLog" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectKeyHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "conditionMatched" BOOLEAN,
    "actionResults" JSONB,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationExecutionLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerTagAssignment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "sourceExecutionLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerTagAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationVoucherGrant" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerKeyHash" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "claimTokenHash" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "sourceExecutionLogId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "usedOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutomationVoucherGrant_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "StreamUsageLedgerEntry" ADD COLUMN "viewerKeyHash" TEXT;

CREATE UNIQUE INDEX "AutomationRule_vendorId_id_key" ON "AutomationRule"("vendorId", "id");
CREATE INDEX "AutomationRule_vendorId_trigger_isActive_idx" ON "AutomationRule"("vendorId", "trigger", "isActive");
CREATE UNIQUE INDEX "AutomationExecutionLog_vendorId_id_key" ON "AutomationExecutionLog"("vendorId", "id");
CREATE UNIQUE INDEX "AutomationExecutionLog_vendorId_idempotencyKey_key" ON "AutomationExecutionLog"("vendorId", "idempotencyKey");
CREATE INDEX "AutomationExecutionLog_vendorId_ruleId_createdAt_idx" ON "AutomationExecutionLog"("vendorId", "ruleId", "createdAt");
CREATE INDEX "AutomationExecutionLog_vendorId_eventId_idx" ON "AutomationExecutionLog"("vendorId", "eventId");
CREATE INDEX "AutomationExecutionLog_vendorId_status_startedAt_idx" ON "AutomationExecutionLog"("vendorId", "status", "startedAt");
CREATE UNIQUE INDEX "CustomerTagAssignment_vendorId_id_key" ON "CustomerTagAssignment"("vendorId", "id");
CREATE UNIQUE INDEX "CustomerTagAssignment_vendorId_customerKeyHash_tag_key" ON "CustomerTagAssignment"("vendorId", "customerKeyHash", "tag");
CREATE INDEX "CustomerTagAssignment_vendorId_customerKeyHash_idx" ON "CustomerTagAssignment"("vendorId", "customerKeyHash");
CREATE INDEX "CustomerTagAssignment_vendorId_tag_createdAt_idx" ON "CustomerTagAssignment"("vendorId", "tag", "createdAt");
CREATE UNIQUE INDEX "AutomationVoucherGrant_claimTokenHash_key" ON "AutomationVoucherGrant"("claimTokenHash");
CREATE UNIQUE INDEX "AutomationVoucherGrant_vendorId_id_key" ON "AutomationVoucherGrant"("vendorId", "id");
CREATE INDEX "AutomationVoucherGrant_vendorId_customerKeyHash_expiresAt_idx" ON "AutomationVoucherGrant"("vendorId", "customerKeyHash", "expiresAt");
CREATE INDEX "AutomationVoucherGrant_vendorId_productId_expiresAt_idx" ON "AutomationVoucherGrant"("vendorId", "productId", "expiresAt");
CREATE INDEX "AutomationVoucherGrant_usedOrderId_idx" ON "AutomationVoucherGrant"("usedOrderId");
CREATE INDEX "StreamUsageLedgerEntry_liveId_viewerKeyHash_capturedAt_idx" ON "StreamUsageLedgerEntry"("liveId", "viewerKeyHash", "capturedAt");

ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationExecutionLog" ADD CONSTRAINT "AutomationExecutionLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationExecutionLog" ADD CONSTRAINT "AutomationExecutionLog_vendorId_ruleId_fkey" FOREIGN KEY ("vendorId", "ruleId") REFERENCES "AutomationRule"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerTagAssignment" ADD CONSTRAINT "CustomerTagAssignment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerTagAssignment" ADD CONSTRAINT "CustomerTagAssignment_vendorId_sourceExecutionLogId_fkey" FOREIGN KEY ("vendorId", "sourceExecutionLogId") REFERENCES "AutomationExecutionLog"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationVoucherGrant" ADD CONSTRAINT "AutomationVoucherGrant_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutomationVoucherGrant" ADD CONSTRAINT "AutomationVoucherGrant_vendorId_productId_fkey" FOREIGN KEY ("vendorId", "productId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AutomationVoucherGrant" ADD CONSTRAINT "AutomationVoucherGrant_vendorId_sourceExecutionLogId_fkey" FOREIGN KEY ("vendorId", "sourceExecutionLogId") REFERENCES "AutomationExecutionLog"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
