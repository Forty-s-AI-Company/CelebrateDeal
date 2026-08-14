import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "vitest";

const workspace = resolve(import.meta.dirname, "..");
const schema = readFileSync(resolve(workspace, "prisma/schema.prisma"), "utf8");
const migration = readFileSync(
  resolve(workspace, "prisma/migrations/20260808110000_g7_04_commerce_orders/migration.sql"),
  "utf8",
);

function requireText(source: string, text: string, label: string) {
  assert.ok(source.includes(text), `${label}: expected ${JSON.stringify(text)}`);
}

test("keeps the commerce order schema and migration contracts executable", () => {
  for (const value of ["physical", "digital", "service", "course"]) {
    requireText(schema, `enum CommerceFulfillmentType {`, "fulfillment enum");
    requireText(schema, `  ${value}`, `fulfillment enum value ${value}`);
  }

  for (const enumName of [
    "ShippingFulfillmentStatus",
    "CommerceEntitlementStatus",
    "ServiceFulfillmentStatus",
    "CommerceOrderRefundStatus",
  ]) {
    requireText(schema, `enum ${enumName} {`, `status enum ${enumName}`);
  }

  for (const model of [
    "CommerceOrder",
    "CommerceOrderItem",
    "CommerceOrderEvent",
    "CommerceOrderRefund",
    "ShippingFulfillment",
    "CommerceEntitlement",
    "ServiceFulfillment",
  ]) {
    requireText(schema, `model ${model} {`, `model ${model}`);
  }

  for (const text of [
    "fulfillmentType                CommerceFulfillmentType @default(physical)",
    "fulfillmentTypeConfirmed       Boolean                 @default(true)",
    "checkoutIdentityHash",
    "@@unique([vendorId, primaryPaymentTransactionId])",
    "@@unique([vendorId, orderId, dedupKey])",
    "@@unique([vendorId, providerName, eventIdentity])",
    "references: [vendorId, id]",
    "accessEncryptedEnvelope",
    "scheduledAt",
    "@@unique([vendorId, id])",
  ]) {
    requireText(schema, text, `schema contract ${text}`);
  }

  for (const text of [
    'ADD COLUMN IF NOT EXISTS "fulfillmentType" "CommerceFulfillmentType" NOT NULL DEFAULT \'physical\'',
    'ADD COLUMN IF NOT EXISTS "fulfillmentTypeConfirmed" BOOLEAN NOT NULL DEFAULT false',
    'UPDATE "Product"',
    'SET "fulfillmentType" = \'course\'',
    'WHERE "commerceDomain" = \'course\'',
    'ALTER COLUMN "fulfillmentTypeConfirmed" SET DEFAULT true',
    'CREATE TABLE "CommerceOrder"',
    'CREATE TABLE "CommerceOrderItem"',
    'CREATE TABLE "CommerceOrderEvent"',
    'CREATE TABLE "CommerceOrderRefund"',
    'FOREIGN KEY ("vendorId", "primaryPaymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id")',
    'FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id")',
    'CONSTRAINT "CommerceOrder_amounts_check"',
    'CONSTRAINT "CommerceOrder_identity_hash_check"',
    'CONSTRAINT "CommerceOrder_shipping_pair_check"',
    'CONSTRAINT "CommerceOrderItem_amounts_check"',
    'CONSTRAINT "CommerceEntitlement_granted_access_check"',
    'CONSTRAINT "CommerceEntitlement_lifecycle_check"',
    'CREATE TRIGGER "CommerceOrderRefund_order_limit_trigger"',
    'CREATE TRIGGER "ShippingFulfillment_item_type_trigger"',
    'CREATE TRIGGER "CommerceEntitlement_item_type_trigger"',
    'CREATE TRIGGER "ServiceFulfillment_item_type_trigger"',
  ]) {
    requireText(migration, text, `migration contract ${text}`);
  }
});
