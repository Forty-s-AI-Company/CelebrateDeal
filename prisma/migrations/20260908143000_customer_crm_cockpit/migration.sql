CREATE TYPE "CustomerConsultationStatus" AS ENUM ('following_up', 'closed_won', 'closed_lost', 'no_show');

ALTER TABLE "FormSubmission" ADD COLUMN "customerKeyHash" TEXT;
ALTER TABLE "FormSubmission" ADD COLUMN "attribution" JSONB;
ALTER TABLE "ConsultationBooking" ADD COLUMN "customerKeyHash" TEXT;
ALTER TABLE "StreamUsageLedgerEntry" ADD COLUMN "customerKeyHash" TEXT;
CREATE INDEX "FormSubmission_formId_customerKeyHash_createdAt_idx" ON "FormSubmission"("formId", "customerKeyHash", "createdAt");
CREATE INDEX "ConsultationBooking_vendorId_customerKeyHash_startTime_idx" ON "ConsultationBooking"("vendorId", "customerKeyHash", "startTime");
CREATE INDEX "StreamUsageLedgerEntry_vendorId_customerKeyHash_capturedAt_idx" ON "StreamUsageLedgerEntry"("vendorId", "customerKeyHash", "capturedAt");

CREATE TABLE "CustomerCrmRecord" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "customerKeyHash" TEXT NOT NULL,
  "consultationStatus" "CustomerConsultationStatus" NOT NULL DEFAULT 'following_up',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerCrmRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsultantNote" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "customerRecordId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorLabel" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsultantNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerCrmRecord_vendorId_id_key" ON "CustomerCrmRecord"("vendorId", "id");
CREATE UNIQUE INDEX "CustomerCrmRecord_vendorId_customerKeyHash_key" ON "CustomerCrmRecord"("vendorId", "customerKeyHash");
CREATE INDEX "CustomerCrmRecord_vendorId_consultationStatus_updatedAt_idx" ON "CustomerCrmRecord"("vendorId", "consultationStatus", "updatedAt");
CREATE UNIQUE INDEX "ConsultantNote_vendorId_id_key" ON "ConsultantNote"("vendorId", "id");
CREATE INDEX "ConsultantNote_vendorId_customerRecordId_createdAt_idx" ON "ConsultantNote"("vendorId", "customerRecordId", "createdAt");
ALTER TABLE "CustomerCrmRecord" ADD CONSTRAINT "CustomerCrmRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultantNote" ADD CONSTRAINT "ConsultantNote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsultantNote" ADD CONSTRAINT "ConsultantNote_vendorId_customerRecordId_fkey" FOREIGN KEY ("vendorId", "customerRecordId") REFERENCES "CustomerCrmRecord"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
