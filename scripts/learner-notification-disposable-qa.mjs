import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { main as migrate } from "./prisma-loopback-disposable-migration-runner.mjs";
import { learnerNotificationDeliveryKey, protectLearnerNotificationDestination } from "../src/lib/learner-notification-contract.ts";
const results = [];
async function check(name, run) {
  try { await run(); results.push({ name, status: "PASS" }); }
  catch { results.push({ name, status: "FAIL" }); throw new Error("notification-db-regression-failed"); }
}
const migration = await migrate({ afterMigrate: async ({ databaseUrl }) => {
  // The migration runner has already verified its own loopback marker and disposable resources.
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
  process.env.CSRF_SECRET = "synthetic-notification-database-encryption-secret-32-bytes";
  try {
    const suffix = randomUUID();
    const vendor = await db.vendor.create({ data: { name: "Synthetic notification owner", slug: `notification-${suffix}`, email: `notification-${suffix}@invalid.example`, passwordHash: "synthetic-login-disabled" } });
    const foreign = await db.vendor.create({ data: { name: "Synthetic foreign owner", slug: `notification-foreign-${suffix}`, email: `notification-foreign-${suffix}@invalid.example`, passwordHash: "synthetic-login-disabled" } });
    const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic course", slug: `notification-product-${suffix}`, priceCents: 1000, commerceDomain: "course", fulfillmentType: "course" } });
    const foreignProduct = await db.product.create({ data: { vendorId: foreign.id, name: "Foreign course", slug: `notification-foreign-product-${suffix}`, priceCents: 1000, commerceDomain: "course", fulfillmentType: "course" } });
    const identity = { vendorId: vendor.id, productId: product.id, customerKeyHash: "a".repeat(43) };
    const destination = protectLearnerNotificationDestination(identity, "sms", { phone: "+886900000001" });
    const preference = await db.learnerNotificationPreference.create({ data: { ...identity, channel: "sms", destinationEncryptedEnvelope: destination.encryptedEnvelope, destinationKeyHash: destination.destinationKeyHash } });
    await check("cross-tenant product FK refuses preference", async () => {
      await assert.rejects(() => db.learnerNotificationPreference.create({ data: { ...identity, productId: foreignProduct.id, channel: "email" } }), error => error.code === "P2003");
      assert.equal(await db.learnerNotificationPreference.count(), 1);
    });
    const key = learnerNotificationDeliveryKey(identity, "sms", "lesson_published", "synthetic_lesson_event", 1);
    const deliveryData = { vendorId: vendor.id, productId: product.id, preferenceId: preference.id, event: "lesson_published", eventIdentity: "synthetic_lesson_event", deduplicationKey: key, consentRevision: 1, payloadEncryptedEnvelope: "synthetic-encrypted-payload" };
    await check("cross-tenant delivery/preference FK refuses dispatch", async () => {
      await assert.rejects(() => db.learnerNotificationDelivery.create({ data: { ...deliveryData, vendorId: foreign.id, productId: foreignProduct.id } }), error => error.code === "P2003");
      assert.equal(await db.learnerNotificationDelivery.count(), 0);
    });
    await check("concurrent consent CAS admits one writer", async () => {
      const outcomes = await Promise.all([true, false].map(enabled => db.learnerNotificationPreference.updateMany({ where: { id: preference.id, ...identity, revision: 1 }, data: { enabled, consentedAt: new Date(), revision: 2 } })));
      assert.equal(outcomes.reduce((total, result) => total + result.count, 0), 1);
      assert.equal((await db.learnerNotificationPreference.findUniqueOrThrow({ where: { id: preference.id } })).revision, 2);
    });
    await check("event uniqueness survives a consent revision change", async () => {
      await db.learnerNotificationDelivery.create({ data: deliveryData });
      assert.equal(learnerNotificationDeliveryKey(identity, "sms", "lesson_published", "synthetic_lesson_event", 2), key);
      await assert.rejects(() => db.learnerNotificationDelivery.create({ data: { ...deliveryData, consentRevision: 2 } }), error => error.code === "P2002");
      assert.equal(await db.learnerNotificationDelivery.count(), 1);
    });
    await check("default-deny RLS hides rows and rejects anonymous-role writes", async () => {
      await db.$executeRawUnsafe('CREATE ROLE learner_notification_synthetic_probe NOLOGIN');
      await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO learner_notification_synthetic_probe');
      await db.$executeRawUnsafe('GRANT SELECT,INSERT ON "LearnerNotificationPreference" TO learner_notification_synthetic_probe');
      const rows = await db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE learner_notification_synthetic_probe');
        return tx.$queryRawUnsafe('SELECT count(*) AS count FROM "LearnerNotificationPreference"');
      });
      assert.equal(Number(rows[0].count), 0);
      await assert.rejects(() => db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE learner_notification_synthetic_probe');
        // Raw SQL preserves PostgreSQL SQLSTATE instead of connector-specific create error wrapping.
        await tx.$executeRaw`INSERT INTO "LearnerNotificationPreference"
          ("id", "vendorId", "productId", "customerKeyHash", "channel", "updatedAt")
          VALUES (${randomUUID()}, ${identity.vendorId}, ${identity.productId}, ${identity.customerKeyHash}, 'email', CURRENT_TIMESTAMP)`;
      }), error => error.code === "P2010" && error.meta?.code === "42501");
      assert.equal(await db.learnerNotificationPreference.count(), 1);
    });
    await check("verification rejects exhausted attempts and expired enrollment", async () => {
      const data = { vendorId: vendor.id, productId: product.id, preferenceId: preference.id, consentRevision: 2, tokenHash: "b".repeat(64), destinationEncryptedEnvelope: destination.encryptedEnvelope, destinationKeyHash: destination.destinationKeyHash, expiresAt: new Date(Date.now() + 600000) };
      await assert.rejects(() => db.learnerNotificationVerification.create({ data: { ...data, attemptCount: 6 } }));
      await assert.rejects(() => db.learnerNotificationVerification.create({ data: { ...data, expiresAt: new Date("2000-01-01") } }));
      assert.equal(await db.learnerNotificationVerification.count(), 0);
    });
  } finally { await db.$disconnect(); }
} });
const receipt = { status: migration.status, migrationCount: migration.migrationNames?.length, tests: results, cleanup: migration.cleanup, safety: { loopbackOnly: true, syntheticOnly: true, externalOperations: false, rawLogsSaved: false } };
fs.mkdirSync(path.resolve(".ai-team/reports"), { recursive: true });
fs.writeFileSync(path.resolve(`.ai-team/reports/learner-notifications-${randomUUID()}.json`), JSON.stringify(receipt, null, 2)+"\n");
fs.writeFileSync(path.resolve(".ai-team/reports/learner-notifications-db-latest.json"), JSON.stringify(receipt, null, 2)+"\n");
process.stdout.write(JSON.stringify(receipt)+"\n");
if (receipt.status !== "PASS" || results.length !== 6 || results.some(test => test.status !== "PASS")) process.exitCode = 1;
