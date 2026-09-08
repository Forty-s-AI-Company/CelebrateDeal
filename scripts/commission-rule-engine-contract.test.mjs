import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const migrationPath = new URL("../prisma/migrations/20260905160000_tiered_multilevel_commission/migration.sql", import.meta.url);
const quantityMigrationPath = new URL("../prisma/migrations/20260907220000_quantity_commission_tiers/migration.sql", import.meta.url);
const snapshotMigrationPath = new URL("../prisma/migrations/20260907221500_quantity_commission_snapshot_contract/migration.sql", import.meta.url);
const webhookPath = new URL("../src/lib/payment-webhooks.ts", import.meta.url);
const tieredEnginePath = new URL("../src/lib/tiered-commission-engine.ts", import.meta.url);
const refundPath = new URL("../src/lib/payment-refund-accounting.ts", import.meta.url);

test("tiered commission persistence contract is versioned and tenant scoped", async () => {
  const [schema, migration, quantityMigration, snapshotMigration] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(migrationPath, "utf8"),
    readFile(quantityMigrationPath, "utf8"),
    readFile(snapshotMigrationPath, "utf8"),
  ]);
  assert.match(schema, /model CommissionRuleSet[\s\S]+@@unique\(\[vendorId, version\]\)/);
  assert.match(schema, /model CommissionRateTier[\s\S]+vendorId\s+String/);
  assert.match(schema, /model CommissionUplineLevel[\s\S]+vendorId\s+String/);
  assert.match(schema, /model CommissionQuantityTier[\s\S]+vendorId\s+String/);
  assert.match(schema, /model CommissionProductOverride[\s\S]+product Product\s+@relation\(fields: \[vendorId, productId\]/);
  assert.match(migration, /AffiliateCommission_rule_snapshot_immutable_trigger/);
  assert.match(migration, /CommissionRateTier_immutable_trigger/);
  assert.match(migration, /CommissionUplineLevel_immutable_trigger/);
  assert.match(migration, /AffiliateCommission_rule_snapshot_check/);
  assert.match(quantityMigration, /CommissionQuantityTier_immutable_trigger/);
  assert.match(snapshotMigration, /"policyVersion" IS NOT NULL[\s\S]+"matchedTier" IS NOT NULL[\s\S]+"calculationSnapshot" IS NOT NULL/);
});

test("checkout and refund paths retain cap and immutable-rate contracts", async () => {
  const [webhook, refund, engine] = await Promise.all([
    readFile(webhookPath, "utf8"),
    readFile(refundPath, "utf8"),
    readFile(tieredEnginePath, "utf8"),
  ]);
  assert.match(webhook, /calculateCommissionPlan\(/);
  assert.match(webhook, /where: \{ vendorId, currency, activatedAt: \{ lte: occurredAt \} \}/);
  assert.match(webhook, /orderBy: \[\{ activatedAt: "desc" \}, \{ version: "desc" \}\]/);
  assert.match(webhook, /team: \{ vendorId \}/);
  assert.match(webhook, /calculateTieredCommission\(/);
  assert.match(webhook, /where: \{ vendorId, primaryPaymentTransactionId: transactionId \}/);
  assert.match(webhook, /cumulativeSalesBeforeCount/);
  assert.match(engine, /productOverrides\.find/);
  assert.match(engine, /grossSalesAmount/);
  assert.match(refund, /commission\.commissionRateBps/);
  assert.match(refund, /entryType: "refund"/);
  assert.match(refund, /findMany\(\{[\s\S]+sourceId: input\.transactionId/);
});
