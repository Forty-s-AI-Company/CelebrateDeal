-- WP2 brand sender settings: nullable additions only; existing Vendor rows remain NULL.
ALTER TABLE "Vendor" ADD COLUMN "senderName" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "contactUrl" TEXT;
