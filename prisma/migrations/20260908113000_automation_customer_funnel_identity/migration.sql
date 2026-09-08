-- Optional because historical orders cannot be safely reconstructed without
-- decrypting PII. New checkouts persist only a tenant-bound irreversible key.
ALTER TABLE "CommerceOrder" ADD COLUMN "automationCustomerKeyHash" TEXT;
CREATE INDEX "CommerceOrder_vendorId_automationCustomerKeyHash_status_idx"
ON "CommerceOrder"("vendorId", "automationCustomerKeyHash", "status");
