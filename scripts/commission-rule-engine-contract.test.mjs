import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const migrationPath = new URL("../prisma/migrations/20260905160000_tiered_multilevel_commission/migration.sql", import.meta.url);
const webhookPath = new URL("../src/lib/payment-webhooks.ts", import.meta.url);
const refundPath = new URL("../src/lib/payment-refund-accounting.ts", import.meta.url);

test("tiered commission persistence contract is versioned and tenant scoped", async () => {
  const [schema, migration] = await Promise.all([
    readFile(schemaPath, "utf8"),
    readFile(migrationPath, "utf8"),
  ]);
  assert.match(schema, /model CommissionRuleSet[\s\S]+@@unique\(\[vendorId, version\]\)/);
  assert.match(schema, /model CommissionRateTier[\s\S]+vendorId\s+String/);
  assert.match(schema, /model CommissionUplineLevel[\s\S]+vendorId\s+String/);
  assert.match(migration, /AffiliateCommission_rule_snapshot_immutable_trigger/);
  assert.match(migration, /CommissionRateTier_immutable_trigger/);
  assert.match(migration, /CommissionUplineLevel_immutable_trigger/);
  assert.match(migration, /AffiliateCommission_rule_snapshot_check/);
});

test("checkout and refund paths retain cap and immutable-rate contracts", async () => {
  const [webhook, refund] = await Promise.all([
    readFile(webhookPath, "utf8"),
    readFile(refundPath, "utf8"),
  ]);
  assert.match(webhook, /calculateCommissionPlan\(/);
  assert.match(webhook, /where: \{ vendorId, currency, status: "ACTIVE"/);
  assert.match(webhook, /team: \{ vendorId \}/);
  assert.match(refund, /commission\.commissionRateBps/);
  assert.match(refund, /entryType: "refund"/);
  assert.match(refund, /findMany\(\{[\s\S]+sourceId: input\.transactionId/);
});
