ALTER TABLE "CommerceOrder"
  ADD COLUMN "invoiceType" TEXT,
  ADD COLUMN "invoiceBuyerDisplay" TEXT,
  ADD COLUMN "invoiceRequestEncryptedEnvelope" TEXT;

CREATE TYPE "ElectronicInvoiceStatus" AS ENUM ('queued', 'issued', 'allowance', 'voided');

CREATE TABLE "ElectronicInvoice" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "invoiceNumber" TEXT,
  "randomCode" TEXT,
  "invoiceType" TEXT NOT NULL,
  "buyerDisplay" TEXT NOT NULL,
  "requestEncryptedEnvelope" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'TWD',
  "amountCents" INTEGER NOT NULL,
  "pretaxAmountCents" INTEGER NOT NULL,
  "taxAmountCents" INTEGER NOT NULL,
  "status" "ElectronicInvoiceStatus" NOT NULL DEFAULT 'queued',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "processingStartedAt" TIMESTAMP(3),
  "issuedAt" TIMESTAMP(3),
  "voidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ElectronicInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ElectronicInvoiceAllowance" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "electronicInvoiceId" TEXT NOT NULL,
  "commerceRefundId" TEXT NOT NULL,
  "allowanceNumber" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "pretaxAmountCents" INTEGER NOT NULL,
  "taxAmountCents" INTEGER NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ElectronicInvoiceAllowance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ElectronicInvoice_invoiceNumber_key" ON "ElectronicInvoice"("invoiceNumber");
CREATE UNIQUE INDEX "ElectronicInvoice_vendorId_id_key" ON "ElectronicInvoice"("vendorId", "id");
CREATE UNIQUE INDEX "ElectronicInvoice_vendorId_orderId_key" ON "ElectronicInvoice"("vendorId", "orderId");
CREATE INDEX "ElectronicInvoice_vendorId_status_nextAttemptAt_processingStartedAt_idx" ON "ElectronicInvoice"("vendorId", "status", "nextAttemptAt", "processingStartedAt");
CREATE INDEX "ElectronicInvoice_vendorId_issuedAt_idx" ON "ElectronicInvoice"("vendorId", "issuedAt");
CREATE UNIQUE INDEX "ElectronicInvoiceAllowance_vendorId_id_key" ON "ElectronicInvoiceAllowance"("vendorId", "id");
CREATE UNIQUE INDEX "ElectronicInvoiceAllowance_vendorId_commerceRefundId_key" ON "ElectronicInvoiceAllowance"("vendorId", "commerceRefundId");
CREATE UNIQUE INDEX "ElectronicInvoiceAllowance_vendorId_allowanceNumber_key" ON "ElectronicInvoiceAllowance"("vendorId", "allowanceNumber");
CREATE INDEX "ElectronicInvoiceAllowance_vendorId_electronicInvoiceId_issuedAt_idx" ON "ElectronicInvoiceAllowance"("vendorId", "electronicInvoiceId", "issuedAt");

ALTER TABLE "ElectronicInvoice" ADD CONSTRAINT "ElectronicInvoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ElectronicInvoice" ADD CONSTRAINT "ElectronicInvoice_vendorId_orderId_fkey" FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ElectronicInvoiceAllowance" ADD CONSTRAINT "ElectronicInvoiceAllowance_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ElectronicInvoiceAllowance" ADD CONSTRAINT "ElectronicInvoiceAllowance_vendorId_electronicInvoiceId_fkey" FOREIGN KEY ("vendorId", "electronicInvoiceId") REFERENCES "ElectronicInvoice"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ElectronicInvoiceAllowance" ADD CONSTRAINT "ElectronicInvoiceAllowance_vendorId_commerceRefundId_fkey" FOREIGN KEY ("vendorId", "commerceRefundId") REFERENCES "CommerceOrderRefund"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
