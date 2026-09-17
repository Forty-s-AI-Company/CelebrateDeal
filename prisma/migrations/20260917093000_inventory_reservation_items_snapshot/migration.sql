-- Immutable server-owned stock snapshot for primary products and order bumps.
-- NULL deliberately preserves legacy one-product reservations.
ALTER TABLE "InventoryReservation" ADD COLUMN "items" JSONB;
