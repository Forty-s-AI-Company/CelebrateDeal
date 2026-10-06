import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { main as migrate } from "./prisma-loopback-disposable-migration-runner.mjs";
import { learnerNotificationDeliveryKey, protectLearnerNotificationDestination } from "../src/lib/learner-notification-contract.ts";
import { saveLearnerNotificationConsent } from "../src/lib/learner-notification-preferences.ts";
import { enqueueLearnerNotification, claimLearnerNotification, finishLearnerNotification } from "../src/lib/learner-notification-outbox.ts";
import { protectCommerceOrderPii } from "../src/lib/commerce-order-pii.ts";
import { reconcileCommerceOrderRefund } from "../src/lib/commerce-orders.ts";
const sourceFiles = ["package.json", "package-lock.json", "prisma/schema.prisma", "prisma/migrations/20261007010000_learner_notifications/migration.sql",
 "src/lib/learner-notification-contract.ts", "src/lib/learner-notification-preferences.ts", "src/lib/learner-notification-outbox.ts", "src/lib/learner-notification-verification.ts",
 "src/lib/student-course-learning.ts", "src/lib/sensitive-data.ts", "src/lib/commerce-order-pii.ts", "src/lib/commerce-order-fulfillment.ts", "src/lib/commerce-orders.ts", "scripts/learner-notification-disposable-qa.mjs"];
function sourceSnapshot() {
 const hashes = Object.fromEntries(sourceFiles.map(file => [file,createHash("sha256").update(fs.readFileSync(path.resolve(file))).digest("hex")]));
 return { files: hashes, revision: `sha256:${createHash("sha256").update(JSON.stringify(hashes)).digest("hex")}` };
}
const sourceAtStart = sourceSnapshot();
let fixtureStage = "not_started";
import { grantCommerceEntitlement } from "../src/lib/commerce-order-fulfillment.ts";
import { requestLearnerContactVerification, consumeLearnerContactVerification } from "../src/lib/learner-notification-verification.ts";
const results = [];
async function check(name, run) {
  try { await run(); results.push({ name, status: "PASS" }); }
  catch (error) {
    const code = typeof error?.code === "string" && /^P[0-9]{4}$/.test(error.code) ? error.code : "UNKNOWN";
    const constraint = String(error?.message ?? "").match(/constraint ["']([A-Za-z0-9_]{1,128})["']/)?.[1] ?? null;
    const errorClass = ["PrismaClientValidationError","PrismaClientUnknownRequestError","PrismaClientKnownRequestError","TypeError","ReferenceError","CommerceOrderPiiValidationError","AssertionError"].includes(error?.constructor?.name) ? error.constructor.name : "UNKNOWN";
    results.push({ name, status: "FAIL", code, constraint, errorClass, fixtureStage }); throw new Error("notification-db-regression-failed");
  }
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
    await check("refunded recipient can unsubscribe using authenticated scope", async () => {
      const result = await saveLearnerNotificationConsent(db, identity, product.id, { channel: "sms", enabled: false, expectedRevision: 2 });
      assert.equal(result.status, "saved");
      assert.equal(result.preference.enabled, false);
      assert.equal(result.preference.revision, 3);
      assert.equal("destinationEncryptedEnvelope" in result.preference, false);
    });
    await check("service rejects stale consent revision", async () => {
      assert.equal((await saveLearnerNotificationConsent(db, identity, product.id, { channel: "sms", enabled: false, expectedRevision: 2 })).status, "conflict");
      assert.equal((await db.learnerNotificationPreference.findUniqueOrThrow({ where: { id: preference.id } })).revision, 3);
    });
    await check("foreign recipient cannot unsubscribe another tenant", async () => {
      assert.equal((await saveLearnerNotificationConsent(db, { ...identity, vendorId: foreign.id }, foreignProduct.id, { channel: "sms", enabled: false, expectedRevision: 0 })).status, "not_found");
      assert.equal(await db.learnerNotificationPreference.count(), 1);
    });
    await check("recipient without current purchase cannot opt in", async () => {
      assert.equal((await saveLearnerNotificationConsent(db, identity, product.id, { channel: "sms", enabled: true, expectedRevision: 3 })).status, "not_found");
      assert.equal((await db.learnerNotificationPreference.findUniqueOrThrow({ where: { id: preference.id } })).enabled, false);
    });
    await check("verification rejects exhausted attempts and expired enrollment", async () => {
      const data = { vendorId: vendor.id, productId: product.id, preferenceId: preference.id, consentRevision: 2, tokenHash: "b".repeat(64), destinationEncryptedEnvelope: destination.encryptedEnvelope, destinationKeyHash: destination.destinationKeyHash, expiresAt: new Date(Date.now() + 600000) };
      await assert.rejects(() => db.learnerNotificationVerification.create({ data: { ...data, attemptCount: 6 } }));
      await assert.rejects(() => db.learnerNotificationVerification.create({ data: { ...data, expiresAt: new Date("2000-01-01") } }));
      assert.equal(await db.learnerNotificationVerification.count(), 0);
    });
    await check("owned synthetic purchase fixture is created", async () => {
    const orderId = randomUUID();
    fixtureStage = "encrypt_order";
    const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic learner", email: "outbox@invalid.example" }, shipping: null }, { vendorId: vendor.id, orderId });
    fixtureStage = "create_order";
    await db.commerceOrder.create({ data: { id: orderId, vendorId: vendor.id, automationCustomerKeyHash: identity.customerKeyHash, orderNumber: orderId,
      checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash, status: "paid", subtotalAmountCents: 1000, totalAmountCents: 1000, paidAmountCents: 1000,
      buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked } });
    fixtureStage = "create_item";
    const item = await db.commerceOrderItem.create({ data: { vendorId: vendor.id, orderId, productId: product.id, lineIndex: 0, productName: product.name, productSlug: product.slug,
      commerceDomain: "course", fulfillmentType: "course", unitPriceCents: 1000, quantity: 1, lineTotalCents: 1000, nonSensitiveSnapshot: {} } });
    fixtureStage = "create_entitlement";
    const entitlement = await db.commerceEntitlement.create({ data: { vendorId: vendor.id, orderItemId: item.id } });
    await db.$transaction(tx => grantCommerceEntitlement(tx,{ vendorId: vendor.id, entitlementId: entitlement.id, expectedRevision: entitlement.revision, actor: { id: "synthetic-notification-fixture" } }));
    fixtureStage = "enable_preference";
    // Verified synthetic destination is a fixture, never evidence of a provider delivery or contact verification.
    await db.learnerNotificationPreference.update({ where: { id: preference.id }, data: { enabled: true, consentedAt: new Date(), destinationVerifiedAt: new Date() } });
    await check("contact proof refuses foreign recipient and locks after five wrong attempts", async () => {
      const requested = await requestLearnerContactVerification(db,identity,product.id,{ channel: "email", expectedRevision: 0, destination: { email: "verified@invalid.example" } });
      assert.equal(requested.status,"challenge_created");
      assert.equal(requested.preference.enabled,false);
      assert.equal((await consumeLearnerContactVerification(db,{ ...identity,customerKeyHash: "b".repeat(43) },product.id,{ challengeId: requested.challenge.id,token: requested.delivery.token })).status,"not_found");
      assert.equal((await db.learnerNotificationVerification.findUniqueOrThrow({ where: { id: requested.challenge.id } })).attemptCount,0);
      for (let attempt=0;attempt<5;attempt++) assert.equal((await consumeLearnerContactVerification(db,identity,product.id,{ challengeId: requested.challenge.id,token: "x".repeat(43) })).status,"invalid_challenge");
      assert.equal((await consumeLearnerContactVerification(db,identity,product.id,{ challengeId: requested.challenge.id,token: requested.delivery.token })).status,"invalid_challenge");
      assert.equal((await db.learnerNotificationVerification.findUniqueOrThrow({ where: { id: requested.challenge.id } })).attemptCount,5);
    });
    await check("expired contact proof cannot mark destination verified", async () => {
      const requested = await requestLearnerContactVerification(db,identity,product.id,{ channel: "email", expectedRevision: 1, destination: { email: "expired@invalid.example" } });
      assert.equal(requested.status,"challenge_created");
      await db.learnerNotificationVerification.update({ where: { id: requested.challenge.id },data: { createdAt: new Date(Date.now()-60000),expiresAt: new Date(Date.now()-1000) } });
      assert.equal((await consumeLearnerContactVerification(db,identity,product.id,{ challengeId: requested.challenge.id,token: requested.delivery.token })).status,"invalid_challenge");
      assert.equal((await db.learnerNotificationPreference.findUniqueOrThrow({ where: { id: requested.preference.id } })).destinationVerifiedAt,null);
    });
    await check("rotated contact proof consumes once without granting notification consent", async () => {
      const requested = await requestLearnerContactVerification(db,identity,product.id,{ channel: "email", expectedRevision: 2, destination: { email: "final@invalid.example" } });
      assert.equal(requested.status,"challenge_created");
      const outcomes = await Promise.all([consumeLearnerContactVerification(db,identity,product.id,{ challengeId: requested.challenge.id,token: requested.delivery.token }),consumeLearnerContactVerification(db,identity,product.id,{ challengeId: requested.challenge.id,token: requested.delivery.token })]);
      assert.equal(outcomes.filter(result=>result.status==="verified").length,1);
      assert.equal(outcomes.filter(result=>result.status==="invalid_challenge").length,1);
      const verified = outcomes.find(result=>result.status==="verified").preference;
      assert.equal(verified.enabled,false);assert.ok(verified.destinationVerifiedAt);
      assert.equal("destinationEncryptedEnvelope" in verified,false);
      assert.equal((await saveLearnerNotificationConsent(db,identity,product.id,{ channel:"email",enabled:true,expectedRevision:verified.revision })).status,"saved");
    });
    await check("native push subscription proves device separately from channel consent", async () => {
      const device = createECDH("prime256v1");device.generateKeys();
      const destination = { endpoint: "https://fcm.googleapis.com/fcm/send/synthetic-only", expirationTime: null, keys: { p256dh: device.getPublicKey().toString("base64url"),auth:randomBytes(16).toString("base64url") } };
      const requested = await requestLearnerContactVerification(db,identity,product.id,{ channel:"push",expectedRevision:0,destination });
      assert.equal(requested.status,"challenge_created");
      const verified = await consumeLearnerContactVerification(db,identity,product.id,{ challengeId:requested.challenge.id,token:requested.delivery.token });
      assert.equal(verified.status,"verified");assert.equal(verified.preference.enabled,false);
      assert.equal((await saveLearnerNotificationConsent(db,identity,product.id,{channel:"push",enabled:true,expectedRevision:verified.preference.revision})).status,"saved");
    });
    const event = { channel: "sms", event: "lesson_published", eventIdentity: "synthetic_outbox_first", message: { title: "Synthetic lesson", body: "Synthetic only private message", path: "/portal/synthetic/learn/course" } };
    let queued, claim;
    await check("outbox deduplicates concurrent real database event producers", async () => {
      const outcomes = await Promise.all([enqueueLearnerNotification(db, identity, event), enqueueLearnerNotification(db, identity, event)]);
      assert.ok(outcomes[0]); assert.equal(outcomes[0].id, outcomes[1].id); queued = outcomes[0];
      const row = await db.learnerNotificationDelivery.findUniqueOrThrow({ where: { id: queued.id } });
      assert.equal(row.payloadEncryptedEnvelope.includes(event.message.body), false);
    });
    await check("outbox foreign scope cannot queue or claim owning recipient", async () => {
      assert.equal(await enqueueLearnerNotification(db, { ...identity, vendorId: foreign.id }, event), null);
      assert.equal(await claimLearnerNotification(db, foreign.id, queued.id), null);
      assert.equal((await db.learnerNotificationDelivery.findUniqueOrThrow({ where: { id: queued.id } })).status, "queued");
    });
    await check("concurrent worker claim admits exactly one owner", async () => {
      const claims = await Promise.all([claimLearnerNotification(db,vendor.id,queued.id), claimLearnerNotification(db,vendor.id,queued.id)]);
      assert.equal(claims.filter(Boolean).length, 1); claim = claims.find(Boolean);
      assert.equal(claim.message.body, event.message.body);
      assert.equal((await db.learnerNotificationDelivery.findUniqueOrThrow({ where: { id: queued.id } })).attemptCount, 1);
    });
    await check("forged or replayed worker completion cannot mark delivery", async () => {
      assert.equal(await finishLearnerNotification(db, { vendorId: vendor.id, id: queued.id, claimToken: "x".repeat(43), outcome: "sent" }), false);
      assert.equal(await finishLearnerNotification(db, { vendorId: vendor.id, id: queued.id, claimToken: claim.claimToken, outcome: "indeterminate" }), true);
      assert.equal(await finishLearnerNotification(db, { vendorId: vendor.id, id: queued.id, claimToken: claim.claimToken, outcome: "sent" }), false);
      assert.equal(await claimLearnerNotification(db,vendor.id,queued.id), null);
      assert.equal((await db.learnerNotificationDelivery.findUniqueOrThrow({ where: { id: queued.id } })).status, "indeterminate");
    });
    await check("consent revision change suppresses a queued event", async () => {
      const pending = await enqueueLearnerNotification(db,identity,{ ...event, eventIdentity: "synthetic_outbox_changed_consent" });
      assert.ok(pending);
      assert.equal((await saveLearnerNotificationConsent(db,identity,product.id,{ channel: "sms", enabled: false, expectedRevision: 3 })).status,"saved");
      assert.equal(await claimLearnerNotification(db,vendor.id,pending.id),null);
      assert.equal((await db.learnerNotificationDelivery.findUniqueOrThrow({ where: { id: pending.id } })).status,"suppressed");
    });
    await check("real full refund suppresses queued delivery and further producer events", async () => {
      assert.equal((await saveLearnerNotificationConsent(db,identity,product.id,{ channel: "sms", enabled: true, expectedRevision: 4 })).status,"saved");
      const pending = await enqueueLearnerNotification(db,identity,{ ...event, eventIdentity: "synthetic_outbox_before_refund" });
      assert.ok(pending);
      await db.$transaction(tx => reconcileCommerceOrderRefund(tx,{ vendorId: vendor.id, orderId, providerName: "synthetic", eventIdentity: randomUUID(), amountCents: 1000, occurredAt: new Date() }));
      assert.equal(await claimLearnerNotification(db,vendor.id,pending.id),null);
      assert.equal((await db.learnerNotificationDelivery.findUniqueOrThrow({ where: { id: pending.id } })).status,"suppressed");
      assert.equal(await enqueueLearnerNotification(db,identity,{ ...event, eventIdentity: "synthetic_outbox_after_refund" }),null);
    });
    });
  if (sourceSnapshot().revision !== sourceAtStart.revision) throw new Error("notification-source-changed-during-verification");
  } finally { await db.$disconnect(); }
} });
const receipt = { source: sourceAtStart, status: migration.status, migrationCount: migration.migrationNames?.length, tests: results, cleanup: migration.cleanup, safety: { loopbackOnly: true, syntheticOnly: true, externalOperations: false, rawLogsSaved: false } };
fs.mkdirSync(path.resolve(".ai-team/reports"), { recursive: true });
fs.writeFileSync(path.resolve(`.ai-team/reports/learner-notifications-${randomUUID()}.json`), JSON.stringify(receipt, null, 2)+"\n");
fs.writeFileSync(path.resolve(".ai-team/reports/learner-notifications-db-latest.json"), JSON.stringify(receipt, null, 2)+"\n");
process.stdout.write(JSON.stringify(receipt)+"\n");
if (receipt.status !== "PASS" || results.length !== 21 || results.some(test => test.status !== "PASS")) process.exitCode = 1;
