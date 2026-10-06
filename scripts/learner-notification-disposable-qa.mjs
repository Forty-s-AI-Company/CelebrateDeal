import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createECDH, createHash, randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { main as migrate } from "./prisma-loopback-disposable-migration-runner.mjs";
import { learnerNotificationDeliveryKey, protectLearnerNotificationDestination } from "../src/lib/learner-notification-contract.ts";
import { listLearnerNotificationPreferences, saveLearnerNotificationConsent } from "../src/lib/learner-notification-preferences.ts";
import { enqueueLearnerNotification, claimLearnerNotification, finishLearnerNotification } from "../src/lib/learner-notification-outbox.ts";
import { protectCommerceOrderPii } from "../src/lib/commerce-order-pii.ts";
import { reconcileCommerceOrderRefund, reconcileCommerceOrderPaymentTransition } from "../src/lib/commerce-orders.ts";
import { dispatchClaimedLearnerNotification } from "../src/lib/learner-notification-dispatch.ts";
import { claimLearnerVerificationDelivery, dispatchLearnerVerificationDelivery } from "../src/lib/learner-verification-delivery.ts";
import { saveCourseLesson } from "../src/lib/course-curriculum.ts";
import { saveStudentLessonProgress } from "../src/lib/student-course-learning.ts";
import { recordLearnerLiveStartedSources } from "../src/lib/learner-live-notifications.ts";
import { recordLearnerNotificationSourceEvent, materializeLearnerNotificationSourceEvent } from "../src/lib/learner-notification-source-events.ts";
const sourceFiles = ["src/app/actions.ts","src/lib/learner-live-notifications.ts","src/lib/learner-payment-notifications.ts","src/lib/learner-notification-source-events.ts", "src/lib/course-curriculum.ts", "prisma/migrations/20261007030000_learner_notification_source_events/migration.sql","src/lib/learner-verification-delivery.ts", "prisma/migrations/20261007020000_learner_verification_delivery/migration.sql","package.json", "package-lock.json", "prisma/schema.prisma", "prisma/migrations/20261007010000_learner_notifications/migration.sql",
 "src/lib/learner-notification-contract.ts", "src/lib/learner-notification-preferences.ts", "src/lib/learner-notification-outbox.ts", "src/lib/learner-notification-dispatch.ts", "src/lib/learner-notification-providers.ts", "src/lib/learner-notification-verification.ts",
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
      await db.learnerNotificationVerification.updateMany({where:{vendorId:vendor.id,productId:product.id},data:{createdAt:new Date(Date.now()-61000)}});
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
      await db.learnerNotificationVerification.updateMany({where:{vendorId:vendor.id,productId:product.id},data:{createdAt:new Date(Date.now()-61000)}});
      const requested = await requestLearnerContactVerification(db,identity,product.id,{ channel: "email", expectedRevision: 1, destination: { email: "expired@invalid.example" } });
      assert.equal(requested.status,"challenge_created");
      await db.learnerNotificationVerification.update({ where: { id: requested.challenge.id },data: { createdAt: new Date(Date.now()-60000),expiresAt: new Date(Date.now()-1000) } });
      assert.equal((await consumeLearnerContactVerification(db,identity,product.id,{ challengeId: requested.challenge.id,token: requested.delivery.token })).status,"invalid_challenge");
      assert.equal((await db.learnerNotificationPreference.findUniqueOrThrow({ where: { id: requested.preference.id } })).destinationVerifiedAt,null);
    });
    await check("rotated contact proof consumes once without granting notification consent", async () => {
      await db.learnerNotificationVerification.updateMany({where:{vendorId:vendor.id,productId:product.id},data:{createdAt:new Date(Date.now()-61000)}});
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
      await db.learnerNotificationVerification.updateMany({where:{vendorId:vendor.id,productId:product.id},data:{createdAt:new Date(Date.now()-61000)}});
      const requested = await requestLearnerContactVerification(db,identity,product.id,{ channel:"push",expectedRevision:0,destination });
      assert.equal(requested.status,"challenge_created");
      const verified = await consumeLearnerContactVerification(db,identity,product.id,{ challengeId:requested.challenge.id,token:requested.delivery.token });
      assert.equal(verified.status,"verified");assert.equal(verified.preference.enabled,false);
      assert.equal((await saveLearnerNotificationConsent(db,identity,product.id,{channel:"push",enabled:true,expectedRevision:verified.preference.revision})).status,"saved");
    });
    async function newProof(){
      const pref=await db.learnerNotificationPreference.findFirst({where:{...identity,channel:"email"}});
      await db.learnerNotificationVerification.updateMany({where:{vendorId:vendor.id,productId:product.id,preferenceId:pref.id},data:{createdAt:new Date(Date.now()-61000)}});
      const q=await requestLearnerContactVerification(db,identity,product.id,{channel:"email",expectedRevision:pref.revision,destination:{email:"durable@invalid.example"}});assert.equal(q.status,"challenge_created");return q;
    }
    await check("durable proof is encrypted and repeat requests respect cooldown",async()=>{
      const q=await newProof();const row=await db.learnerNotificationVerification.findUniqueOrThrow({where:{id:q.challenge.id}});
      assert.equal(row.deliveryStatus,"queued");assert.equal(row.deliveryTokenEncryptedEnvelope.includes(q.delivery.token),false);
      assert.equal((await requestLearnerContactVerification(db,identity,product.id,{channel:"email",expectedRevision:q.preference.revision,destination:{email:"second@invalid.example"}})).status,"rate_limited");
      assert.equal((await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:q.preference.id}})).revision,q.preference.revision);
    });
    await check("cross-tenant and concurrent proof claims admit exactly one owner",async()=>{
      const q=await newProof();assert.equal(await claimLearnerVerificationDelivery(db,{vendorId:foreign.id,id:q.challenge.id}),null);
      const outcomes=await Promise.all([1,2].map(()=>claimLearnerVerificationDelivery(db,{vendorId:vendor.id,id:q.challenge.id})));assert.equal(outcomes.filter(Boolean).length,1);
      let calls=0;const sender=async input=>{calls++;assert.equal(input.destination.email,"durable@invalid.example");assert.ok(input.message.body.includes(q.delivery.token));assert.equal(input.message.path.includes(q.delivery.token),false);assert.equal(input.message.path,`/portal/${encodeURIComponent(vendor.slug)}/learn/${encodeURIComponent(product.id)}`);return {outcome:"sent",providerReceipt:"synthetic-proof-acceptance"};};
      assert.equal((await dispatchLearnerVerificationDelivery(db,{...outcomes.find(Boolean),claimToken:"x".repeat(43)},{appOrigin:"https://app.example.test",configuration:{},sender})).status,"not_claimed");
      const sent=await Promise.all([1,2].map(()=>dispatchLearnerVerificationDelivery(db,outcomes.find(Boolean),{appOrigin:"https://app.example.test",configuration:{},sender})));assert.equal(calls,1);assert.equal(sent.filter(r=>r.status==="sent").length,1);
      const row=await db.learnerNotificationVerification.findUniqueOrThrow({where:{id:q.challenge.id}});assert.equal(row.deliveryTokenEncryptedEnvelope,null);assert.ok(row.deliveredAt);assert.equal(row.deliveryReceiptEncryptedEnvelope.includes("synthetic-proof-acceptance"),false);
      assert.equal((await consumeLearnerContactVerification(db,identity,product.id,{challengeId:q.challenge.id,token:q.delivery.token})).status,"verified");
    });
    await check("expired proof suppresses provider and clears its encrypted payload",async()=>{
      const q=await newProof(),claim=await claimLearnerVerificationDelivery(db,{vendorId:vendor.id,id:q.challenge.id});assert.ok(claim);
      await db.learnerNotificationVerification.update({where:{id:q.challenge.id},data:{createdAt:new Date(Date.now()-16*60000),expiresAt:new Date(Date.now()-1000)}});
      let calls=0;assert.equal((await dispatchLearnerVerificationDelivery(db,claim,{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;return {outcome:"sent"};}})).status,"suppressed");assert.equal(calls,0);
      assert.equal((await db.learnerNotificationVerification.findUniqueOrThrow({where:{id:q.challenge.id}})).deliveryTokenEncryptedEnvelope,null);
    });
    await check("contact rotation suppresses old queued proof and rejects claimed old proof",async()=>{
      const old=await newProof(),claim=await claimLearnerVerificationDelivery(db,{vendorId:vendor.id,id:old.challenge.id});const next=await newProof();assert.notEqual(old.challenge.id,next.challenge.id);
      let calls=0;assert.equal((await dispatchLearnerVerificationDelivery(db,claim,{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;return {outcome:"sent"};}})).status,"suppressed");assert.equal(calls,0);
      const third=await newProof();assert.equal((await db.learnerNotificationVerification.findUniqueOrThrow({where:{id:next.challenge.id}})).deliveryStatus,"suppressed");assert.equal((await db.learnerNotificationVerification.findUniqueOrThrow({where:{id:next.challenge.id}})).deliveryTokenEncryptedEnvelope,null);assert.ok(third.challenge.id);
    });
    await check("unknown challenge provider outcome is terminal without automatic replay",async()=>{
      const q=await newProof(),claim=await claimLearnerVerificationDelivery(db,{vendorId:vendor.id,id:q.challenge.id});let calls=0;
      assert.equal((await dispatchLearnerVerificationDelivery(db,claim,{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;throw new Error("synthetic uncertainty");}})).status,"indeterminate");assert.equal(calls,1);
      assert.equal(await claimLearnerVerificationDelivery(db,{vendorId:vendor.id,id:q.challenge.id}),null);assert.equal((await db.learnerNotificationVerification.findUniqueOrThrow({where:{id:q.challenge.id}})).deliveryTokenEncryptedEnvelope,null);
    });
    await check("failed proof commit after provider acceptance does not send again",async()=>{
      const q=await newProof(),claim=await claimLearnerVerificationDelivery(db,{vendorId:vendor.id,id:q.challenge.id});let calls=0;
      await db.$executeRawUnsafe(`CREATE FUNCTION learner_proof_synthetic_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."deliveryStatus"='sent' THEN RAISE EXCEPTION 'synthetic commit fault' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER learner_proof_synthetic_commit_fault AFTER UPDATE ON "LearnerNotificationVerification" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION learner_proof_synthetic_commit_fault()`);
      try{assert.equal((await dispatchLearnerVerificationDelivery(db,claim,{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;return {outcome:"sent",providerReceipt:"synthetic-proof-before-commit-fault"};}})).status,"indeterminate");assert.equal(calls,1);const uncertain=await db.learnerNotificationVerification.findUniqueOrThrow({where:{id:q.challenge.id}});assert.ok(uncertain.deliveryReceiptEncryptedEnvelope);assert.equal(uncertain.deliveryReceiptEncryptedEnvelope.includes("synthetic-proof-before-commit-fault"),false);assert.equal(uncertain.deliveryTokenEncryptedEnvelope,null);assert.equal(await claimLearnerVerificationDelivery(db,{vendorId:vendor.id,id:q.challenge.id}),null);}
      finally{await db.$executeRawUnsafe(`DROP TRIGGER learner_proof_synthetic_commit_fault ON "LearnerNotificationVerification"`);await db.$executeRawUnsafe(`DROP FUNCTION learner_proof_synthetic_commit_fault()`);}
    });
    let publishedLesson;
    await check("real lesson publication commits one source and metadata saves do not republish",async()=>{
      const current=await db.product.findUniqueOrThrow({where:{id:product.id}});
      const draft={productId:product.id,revision:current.revision,chapterTitle:"Synthetic chapter",title:"Synthetic published lesson",videoUrl:"https://media.example.test/synthetic.mp4",durationSeconds:100,published:true};
      publishedLesson=await saveCourseLesson(db,vendor.id,draft);
      const source=await db.learnerNotificationSourceEvent.findFirstOrThrow({where:{vendorId:vendor.id,productId:product.id,event:"lesson_published"}});assert.equal(source.audienceCustomerKeyHash,null);assert.equal(source.payloadEncryptedEnvelope.includes(draft.title),false);
      const revision=(await db.product.findUniqueOrThrow({where:{id:product.id}})).revision;
      await saveCourseLesson(db,vendor.id,{...draft,lessonId:publishedLesson,revision,title:"Synthetic metadata edit"});
      assert.equal(await db.learnerNotificationSourceEvent.count({where:{vendorId:vendor.id,productId:product.id,event:"lesson_published"}}),1);
    });
    await check("source insert failure rolls back the actual lesson and product revision",async()=>{
      const before=await db.product.findUniqueOrThrow({where:{id:product.id}}),lessons=await db.courseLesson.count({where:{vendorId:vendor.id,productId:product.id}});
      await db.$executeRawUnsafe(`CREATE FUNCTION learner_source_synthetic_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."event"='lesson_published' THEN RAISE EXCEPTION 'synthetic source fault' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER learner_source_synthetic_fault BEFORE INSERT ON "LearnerNotificationSourceEvent" FOR EACH ROW EXECUTE FUNCTION learner_source_synthetic_fault()`);
      try{await assert.rejects(()=>saveCourseLesson(db,vendor.id,{productId:product.id,revision:before.revision,chapterTitle:"Synthetic",title:"Synthetic must roll back",videoUrl:"https://media.example.test/synthetic.mp4",durationSeconds:100,published:true}),error=>error.code==="P2034");
        assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).revision,before.revision);assert.equal(await db.courseLesson.count({where:{vendorId:vendor.id,productId:product.id}}),lessons);
      }finally{await db.$executeRawUnsafe(`DROP TRIGGER learner_source_synthetic_fault ON "LearnerNotificationSourceEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION learner_source_synthetic_fault()`);}
    });
    await check("concurrent source consumers create only exact owning current recipients",async()=>{
      const source=await db.learnerNotificationSourceEvent.findFirstOrThrow({where:{vendorId:vendor.id,productId:product.id,event:"lesson_published"}});
      assert.equal((await materializeLearnerNotificationSourceEvent(db,foreign.id,source.id)).status,"not_pending");
      const outcomes=await Promise.all([1,2].map(()=>materializeLearnerNotificationSourceEvent(db,vendor.id,source.id)));
      assert.equal(outcomes.filter(value=>value.status==="completed").length,1);
      const deliveries=await db.learnerNotificationDelivery.findMany({where:{vendorId:vendor.id,productId:product.id,eventIdentity:source.eventIdentity}});assert.equal(deliveries.length,2);
      assert.equal(await db.learnerNotificationDelivery.count({where:{vendorId:foreign.id}}),0);assert.ok((await db.learnerNotificationSourceEvent.findUniqueOrThrow({where:{id:source.id}})).completedAt);
    });
    await check("real completed course source is recipient-bound and idempotent",async()=>{
      await saveStudentLessonProgress(db,identity,{courseId:product.id,lessonId:publishedLesson,watchedSeconds:100,markedComplete:true});
      await saveStudentLessonProgress(db,identity,{courseId:product.id,lessonId:publishedLesson,watchedSeconds:100,markedComplete:true});
      const sources=await db.learnerNotificationSourceEvent.findMany({where:{vendorId:vendor.id,productId:product.id,event:"course_completed"}});assert.equal(sources.length,1);assert.equal(sources[0].audienceCustomerKeyHash,identity.customerKeyHash);
      assert.equal((await materializeLearnerNotificationSourceEvent(db,vendor.id,sources[0].id)).status,"completed");assert.equal(await db.learnerNotificationDelivery.count({where:{vendorId:vendor.id,productId:product.id,event:"course_completed"}}),2);
    });
    await check("bounded source fanout persists its cursor across more than twenty preferences",async()=>{
      const ids=[];const consentedAt=new Date(Date.now()-60000);
      for(let index=0;index<25;index++){
        const scope={...identity,customerKeyHash:Buffer.alloc(32,index+11).toString("base64url")},protectedContact=protectLearnerNotificationDestination(scope,"email",{email:`synthetic-${index}@invalid.example`}),id=`zz-source-pref-${String(index).padStart(2,"0")}`;ids.push(id);
        await db.learnerNotificationPreference.create({data:{...scope,id,channel:"email",enabled:true,consentedAt,destinationVerifiedAt:new Date(),destinationEncryptedEnvelope:protectedContact.encryptedEnvelope,destinationKeyHash:protectedContact.destinationKeyHash}});
      }
      try{
        const source=await db.$transaction(tx=>recordLearnerNotificationSourceEvent(tx,{vendorId:vendor.id,productId:product.id,event:"lesson_published",eventIdentity:"synthetic_bounded_fanout",audienceCustomerKeyHash:null,occurredAt:new Date(),message:{title:"Synthetic cursor",body:"Synthetic only",path:`/portal/${vendor.slug}/learn/${product.id}`}}));
        const first=await materializeLearnerNotificationSourceEvent(db,vendor.id,source.id);assert.equal(first.status,"page_materialized");const cursor=await db.learnerNotificationSourceEvent.findUniqueOrThrow({where:{id:source.id}});assert.ok(cursor.preferenceCursor);assert.equal(cursor.completedAt,null);
        assert.equal((await materializeLearnerNotificationSourceEvent(db,vendor.id,source.id)).status,"completed");assert.equal((await materializeLearnerNotificationSourceEvent(db,vendor.id,source.id)).status,"not_pending");assert.equal(await db.learnerNotificationDelivery.count({where:{vendorId:vendor.id,eventIdentity:"synthetic_bounded_fanout"}}),2);
      }finally{await db.learnerNotificationPreference.deleteMany({where:{vendorId:vendor.id,id:{in:ids}}});}
    });
    await check("source materialization excludes consent granted after the domain event",async()=>{
      const existing=await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:preference.id}}),occurredAt=new Date();
      const source=await db.$transaction(tx=>recordLearnerNotificationSourceEvent(tx,{vendorId:vendor.id,productId:product.id,event:"lesson_published",eventIdentity:"synthetic_no_retroactive_consent",audienceCustomerKeyHash:null,occurredAt,message:{title:"Synthetic prior event",body:"Synthetic only",path:`/portal/${vendor.slug}/learn/${product.id}`}}));
      await db.learnerNotificationPreference.update({where:{id:preference.id},data:{consentedAt:new Date(occurredAt.getTime()+1000)}});
      try{assert.equal((await materializeLearnerNotificationSourceEvent(db,vendor.id,source.id)).status,"completed");const queued=await db.learnerNotificationDelivery.findMany({where:{vendorId:vendor.id,eventIdentity:"synthetic_no_retroactive_consent"},select:{preferenceId:true}});assert.equal(queued.length,1);assert.equal(queued.some(row=>row.preferenceId===preference.id),false);}
      finally{await db.learnerNotificationPreference.update({where:{id:preference.id},data:{consentedAt:existing.consentedAt}});}
    });
    const live = await db.live.create({data:{vendorId:vendor.id,title:"Synthetic purchased course live",slug:`synthetic-notify-live-${randomUUID()}`,scheduledAt:new Date(),status:"scheduled"}});
    await db.liveProduct.create({data:{vendorId:vendor.id,liveId:live.id,productId:product.id,isVisible:true}});
    const liveStart=new Date();
    await check("live source insert failure rolls back owning lifecycle transition",async()=>{
      await db.$executeRawUnsafe(`CREATE FUNCTION learner_live_synthetic_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."event"='live_started' THEN RAISE EXCEPTION 'synthetic live source fault' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER learner_live_synthetic_fault BEFORE INSERT ON "LearnerNotificationSourceEvent" FOR EACH ROW EXECUTE FUNCTION learner_live_synthetic_fault()`);
      try{
        await assert.rejects(()=>db.$transaction(async tx=>{await tx.live.update({where:{id:live.id},data:{status:"live",startedAt:liveStart}});await recordLearnerLiveStartedSources(tx,{vendorId:vendor.id,liveId:live.id,startedAt:liveStart});}),error=>error.code==="P2034");
        assert.equal((await db.live.findUniqueOrThrow({where:{id:live.id}})).status,"scheduled");assert.equal(await db.learnerNotificationSourceEvent.count({where:{event:"live_started"}}),0);
      }finally{await db.$executeRawUnsafe(`DROP TRIGGER learner_live_synthetic_fault ON "LearnerNotificationSourceEvent"`);await db.$executeRawUnsafe(`DROP FUNCTION learner_live_synthetic_fault()`);}
    });
    await check("live source requires exact owning active session and persisted course binding",async()=>{
      await db.$transaction(async tx=>{await tx.live.update({where:{id:live.id},data:{status:"live",startedAt:liveStart}});await recordLearnerLiveStartedSources(tx,{vendorId:vendor.id,liveId:live.id,startedAt:liveStart});});
      await db.$transaction(tx=>recordLearnerLiveStartedSources(tx,{vendorId:foreign.id,liveId:live.id,startedAt:liveStart}));
      await db.$transaction(tx=>recordLearnerLiveStartedSources(tx,{vendorId:vendor.id,liveId:live.id,startedAt:new Date(liveStart.getTime()+1)}));
      await db.$transaction(tx=>recordLearnerLiveStartedSources(tx,{vendorId:vendor.id,liveId:live.id,startedAt:liveStart}));
      const sources=await db.learnerNotificationSourceEvent.findMany({where:{vendorId:vendor.id,productId:product.id,event:"live_started"}});assert.equal(sources.length,1);assert.equal(sources[0].audienceCustomerKeyHash,null);
      assert.equal((await materializeLearnerNotificationSourceEvent(db,vendor.id,sources[0].id)).status,"completed");assert.equal(await db.learnerNotificationDelivery.count({where:{vendorId:vendor.id,event:"live_started"}}),2);
    });
    await check("owning active live dispatch has one bounded authorized provider attempt",async()=>{
      const row=await db.learnerNotificationDelivery.findFirstOrThrow({where:{vendorId:vendor.id,event:"live_started",preferenceId:preference.id}}),claim=await claimLearnerNotification(db,vendor.id,row.id);assert.ok(claim);
      let calls=0;const result=await dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:row.id,claimToken:claim.claimToken},{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;return {outcome:"sent",providerReceipt:"synthetic-live-receipt"};}});assert.equal(result.status,"sent");assert.equal(calls,1);
    });
    await check("live ending after claim suppresses queued session without provider call",async()=>{
      const row=await db.learnerNotificationDelivery.findFirstOrThrow({where:{vendorId:vendor.id,event:"live_started",status:"queued"}}),claim=await claimLearnerNotification(db,vendor.id,row.id);assert.ok(claim);
      await db.live.update({where:{id:live.id},data:{status:"ended",endedAt:new Date()}});let calls=0;
      assert.equal((await dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:row.id,claimToken:claim.claimToken},{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;return {outcome:"sent"};}})).status,"suppressed");assert.equal(calls,0);
    });
    await check("reopened live has new source identity and removed binding suppresses dispatch",async()=>{
      const startedAt=new Date(liveStart.getTime()+1000);
      await db.$transaction(async tx=>{await tx.live.update({where:{id:live.id},data:{status:"live",startedAt,endedAt:null}});await recordLearnerLiveStartedSources(tx,{vendorId:vendor.id,liveId:live.id,startedAt});});
      const source=await db.learnerNotificationSourceEvent.findFirstOrThrow({where:{vendorId:vendor.id,event:"live_started",occurredAt:startedAt}});assert.equal((await materializeLearnerNotificationSourceEvent(db,vendor.id,source.id)).status,"completed");
      assert.equal(await db.learnerNotificationSourceEvent.count({where:{vendorId:vendor.id,event:"live_started"}}),2);
      const row=await db.learnerNotificationDelivery.findFirstOrThrow({where:{vendorId:vendor.id,eventIdentity:source.eventIdentity,preferenceId:preference.id}}),claim=await claimLearnerNotification(db,vendor.id,row.id);assert.ok(claim);
      await db.liveProduct.deleteMany({where:{vendorId:vendor.id,liveId:live.id,productId:product.id}});let calls=0;
      assert.equal((await dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:row.id,claimToken:claim.claimToken},{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;return {outcome:"sent"};}})).status,"suppressed");assert.equal(calls,0);
    });
    const payment = await db.paymentTransaction.create({ data: { vendorId: vendor.id, providerName: "synthetic_no_provider", status: "paid", grossAmountCents: 1000, netAmountCents: 1000 } });
    await db.commerceOrder.update({ where: { id: orderId }, data: { status: "pending_payment", paidAmountCents: 0, primaryPaymentTransactionId: payment.id } });
    await db.commerceEntitlement.update({ where: { id: entitlement.id }, data: { status: "pending", grantedAt: null } });
    const paidInput = { vendorId: vendor.id, paymentTransactionId: payment.id, eventIdentity: "synthetic_exact_payment", transition: "paid", occurredAt: new Date() };
    await check("payment source fault rolls back paid order entitlement and commerce event", async () => {
      await db.$executeRawUnsafe(`CREATE FUNCTION learner_payment_synthetic_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."event"='payment_success' THEN RAISE EXCEPTION 'synthetic payment source fault' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER learner_payment_synthetic_fault BEFORE INSERT ON "LearnerNotificationSourceEvent" FOR EACH ROW EXECUTE FUNCTION learner_payment_synthetic_fault()`);
      try {
        await assert.rejects(() => db.$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, paidInput)), error => error.code === "P2034");
        assert.equal((await db.commerceOrder.findUniqueOrThrow({ where: { id: orderId } })).status, "pending_payment");
        assert.equal((await db.commerceEntitlement.findUniqueOrThrow({ where: { id: entitlement.id } })).status, "pending");
        assert.equal(await db.commerceOrderEvent.count({ where: { vendorId: vendor.id, orderId, eventType: "payment.paid" } }), 0);
      } finally { await db.$executeRawUnsafe(`DROP TRIGGER learner_payment_synthetic_fault ON "LearnerNotificationSourceEvent"`); await db.$executeRawUnsafe(`DROP FUNCTION learner_payment_synthetic_fault()`); }
    });
    await check("exact canonical payment publishes only owning buyer and repeated paid does not republish", async () => {
      assert.equal(await db.$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { ...paidInput, vendorId: foreign.id })), null);
      assert.equal((await db.$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, paidInput))).changed, true);
      assert.equal((await db.$transaction(tx => reconcileCommerceOrderPaymentTransition(tx, { ...paidInput, eventIdentity: "synthetic_repeated_provider_event" }))).changed, false);
      assert.equal((await db.commerceEntitlement.findUniqueOrThrow({ where: { id: entitlement.id } })).status, "granted");
      const sources = await db.learnerNotificationSourceEvent.findMany({ where: { vendorId: vendor.id, productId: product.id, event: "payment_success" } });
      assert.equal(sources.length, 1); assert.equal(sources[0].audienceCustomerKeyHash, identity.customerKeyHash);
      assert.equal(await db.learnerNotificationSourceEvent.count({ where: { vendorId: foreign.id, event: "payment_success" } }), 0);
      assert.equal((await materializeLearnerNotificationSourceEvent(db, vendor.id, sources[0].id)).status, "completed");
      assert.equal(await db.learnerNotificationDelivery.count({ where: { vendorId: vendor.id, productId: product.id, event: "payment_success" } }), 2);
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
    await check("exact claimed dispatch cannot run twice or accept a forged token", async () => {
      const pending=await enqueueLearnerNotification(db,identity,{...event,eventIdentity:"synthetic_worker_single"});assert.ok(pending);
      const worker=await claimLearnerNotification(db,vendor.id,pending.id);assert.ok(worker);let calls=0;
      const options={appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;return {outcome:"sent",providerReceipt:"synthetic-worker-receipt"};}};
      assert.equal((await dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:pending.id,claimToken:"x".repeat(43)},options)).status,"not_claimed");assert.equal(calls,0);
      const outcomes=await Promise.all([dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:pending.id,claimToken:worker.claimToken},options),dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:pending.id,claimToken:worker.claimToken},options)]);
      assert.equal(calls,1);assert.equal(outcomes.filter(result=>result.status==="sent").length,1);assert.equal(outcomes.filter(result=>result.status==="not_claimed").length,1);
      const row=await db.learnerNotificationDelivery.findUniqueOrThrow({where:{id:pending.id}});assert.equal(row.status,"sent");assert.ok(row.dispatchedAt);assert.equal(row.providerReceiptEncryptedEnvelope.includes("synthetic-worker-receipt"),false);
    });
    await check("provider uncertainty is durable and never invokes a second attempt", async () => {
      const pending=await enqueueLearnerNotification(db,identity,{...event,eventIdentity:"synthetic_worker_unknown"});const worker=await claimLearnerNotification(db,vendor.id,pending.id);assert.ok(worker);let calls=0;
      const options={appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;throw new Error("synthetic private provider failure");}};
      assert.equal((await dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:pending.id,claimToken:worker.claimToken},options)).status,"indeterminate");
      assert.equal((await dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:pending.id,claimToken:worker.claimToken},options)).status,"not_claimed");assert.equal(calls,1);
      assert.equal((await db.learnerNotificationDelivery.findUniqueOrThrow({where:{id:pending.id}})).lastErrorCode,"PROVIDER_OUTCOME_UNKNOWN");
    });
    await check("failed database commit after provider acceptance never repeats the external attempt", async () => {
      const pending=await enqueueLearnerNotification(db,identity,{...event,eventIdentity:"synthetic_worker_commit_fail"});const worker=await claimLearnerNotification(db,vendor.id,pending.id);assert.ok(worker);
      // Owned disposable fault injection only. The deferred constraint fails at
      // COMMIT after the synthetic provider callback has returned acceptance.
      await db.$executeRawUnsafe(`CREATE FUNCTION learner_notification_synthetic_commit_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."eventIdentity"='synthetic_worker_commit_fail' AND NEW."status"='sent' THEN RAISE EXCEPTION 'synthetic commit fault' USING ERRCODE='40001'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER learner_notification_synthetic_commit_fault AFTER UPDATE ON "LearnerNotificationDelivery" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION learner_notification_synthetic_commit_fault()`);
      let calls=0;
      try{
        const result=await dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:pending.id,claimToken:worker.claimToken},{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;return {outcome:"sent",providerReceipt:"synthetic-before-commit-fault"};}});
        assert.equal(result.status,"indeterminate");assert.equal(calls,1);
        const row=await db.learnerNotificationDelivery.findUniqueOrThrow({where:{id:pending.id}});assert.equal(row.status,"indeterminate");assert.equal(row.claimTokenHash,null);assert.ok(row.providerReceiptEncryptedEnvelope);
        assert.equal(await claimLearnerNotification(db,vendor.id,pending.id),null);
      }finally{
        await db.$executeRawUnsafe(`DROP TRIGGER learner_notification_synthetic_commit_fault ON "LearnerNotificationDelivery"`);
        await db.$executeRawUnsafe(`DROP FUNCTION learner_notification_synthetic_commit_fault()`);
      }
    });
    await check("entitlement expiry after claim refuses provider dispatch", async () => {
      const pending=await enqueueLearnerNotification(db,identity,{...event,eventIdentity:"synthetic_worker_expired"});const worker=await claimLearnerNotification(db,vendor.id,pending.id);assert.ok(worker);
      await db.commerceEntitlement.update({where:{id:entitlement.id},data:{grantedAt:new Date(Date.now()-60000),expiresAt:new Date(Date.now()-1000)}});
      let calls=0;
      try{
        const result=await dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:pending.id,claimToken:worker.claimToken},{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{calls++;return {outcome:"sent"};}});
        assert.equal(result.status,"suppressed");assert.equal(calls,0);assert.equal((await db.learnerNotificationDelivery.findUniqueOrThrow({where:{id:pending.id}})).status,"suppressed");
      }finally{await db.commerceEntitlement.update({where:{id:entitlement.id},data:{expiresAt:null}});}
    });
    await check("consent withdrawal waits for the bounded authorized provider attempt", async () => {
      const pending=await enqueueLearnerNotification(db,identity,{...event,eventIdentity:"synthetic_worker_withdraw_race"});const worker=await claimLearnerNotification(db,vendor.id,pending.id);assert.ok(worker);
      let release,entered;const gate=new Promise(resolve=>{release=resolve;});const started=new Promise(resolve=>{entered=resolve;});
      const active=dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:pending.id,claimToken:worker.claimToken},{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{entered();await gate;return {outcome:"sent",providerReceipt:"synthetic-bounded-receipt"};}});
      await started;
      const withdrawal=saveLearnerNotificationConsent(db,identity,product.id,{channel:"sms",enabled:false,expectedRevision:3});
      try {
        let count=0;const deadline=Date.now()+5000;
        while(Date.now()<deadline){const rows=await db.$queryRaw`SELECT count(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%LearnerNotificationPreference%'`;count=Number(rows[0].count);if(count>0)break;await new Promise(resolve=>setTimeout(resolve,20));}
        assert.ok(count>0,"consent writer must wait on the exact preference lock");
      }finally{release();}
      assert.equal((await active).status,"sent");assert.equal((await withdrawal).status,"saved");
      assert.equal((await db.learnerNotificationPreference.findUniqueOrThrow({where:{id:preference.id}})).enabled,false);
      assert.equal(await enqueueLearnerNotification(db,identity,{...event,eventIdentity:"synthetic_after_worker_withdraw"}),null);
    });
    await check("consent revision change suppresses a queued event", async () => {
      assert.equal((await saveLearnerNotificationConsent(db,identity,product.id,{channel:"sms",enabled:true,expectedRevision:4})).status,"saved");
      const pending = await enqueueLearnerNotification(db,identity,{ ...event, eventIdentity: "synthetic_outbox_changed_consent" });
      assert.ok(pending);
      assert.equal((await saveLearnerNotificationConsent(db,identity,product.id,{ channel: "sms", enabled: false, expectedRevision: 5 })).status,"saved");
      assert.equal(await claimLearnerNotification(db,vendor.id,pending.id),null);
      assert.equal((await db.learnerNotificationDelivery.findUniqueOrThrow({ where: { id: pending.id } })).status,"suppressed");
    });
    await check("real full refund after claim suppresses dispatch and further producer events", async () => {
      assert.equal((await saveLearnerNotificationConsent(db,identity,product.id,{ channel: "sms", enabled: true, expectedRevision: 6 })).status,"saved");
      const pending = await enqueueLearnerNotification(db,identity,{ ...event, eventIdentity: "synthetic_outbox_before_refund" });
      assert.ok(pending);
      const reserved=await claimLearnerNotification(db,vendor.id,pending.id);assert.ok(reserved);
      const proof=await newProof(),proofClaim=await claimLearnerVerificationDelivery(db,{vendorId:vendor.id,id:proof.challenge.id});assert.ok(proofClaim);
      await db.$transaction(tx => reconcileCommerceOrderRefund(tx,{ vendorId: vendor.id, orderId, providerName: "synthetic", eventIdentity: randomUUID(), amountCents: 1000, occurredAt: new Date() }));
      assert.equal(await claimLearnerNotification(db,vendor.id,pending.id),null);
      let providerCalls=0;
      const result=await dispatchClaimedLearnerNotification(db,{vendorId:vendor.id,id:pending.id,claimToken:reserved.claimToken},{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{providerCalls++;return {outcome:"sent"};}});
      assert.equal(result.status,"suppressed");assert.equal(providerCalls,0);
      assert.equal((await dispatchLearnerVerificationDelivery(db,proofClaim,{appOrigin:"https://app.example.test",configuration:{},sender:async()=>{providerCalls++;return {outcome:"sent"};}})).status,"suppressed");assert.equal(providerCalls,0);
      assert.equal((await db.learnerNotificationDelivery.findUniqueOrThrow({ where: { id: pending.id } })).status,"suppressed");
      assert.equal(await enqueueLearnerNotification(db,identity,{ ...event, eventIdentity: "synthetic_outbox_after_refund" }),null);
      const preferences=await listLearnerNotificationPreferences(db,identity,product.id);assert.ok(preferences);assert.ok(preferences.find(value=>value.channel==="sms")?.enabled);
      assert.equal((await saveLearnerNotificationConsent(db,identity,product.id,{channel:"sms",enabled:false,expectedRevision:7})).status,"saved");
      assert.equal((await saveLearnerNotificationConsent(db,identity,product.id,{channel:"sms",enabled:true,expectedRevision:8})).status,"not_found");
      assert.equal((await listLearnerNotificationPreferences(db,identity,product.id)).find(value=>value.channel==="sms").enabled,false);
      assert.equal(await listLearnerNotificationPreferences(db,{...identity,customerKeyHash:"z".repeat(43)},product.id),null);
      assert.equal(await listLearnerNotificationPreferences(db,{...identity,vendorId:foreign.id},product.id),null);
      assert.equal(preferences.some(value=>"destinationEncryptedEnvelope" in value || "customerKeyHash" in value),false);
    });
    });
  if (sourceSnapshot().revision !== sourceAtStart.revision) throw new Error("notification-source-changed-during-verification");
  } finally { await db.$disconnect(); }
} });
const receipt = { source: sourceAtStart, status: migration.status === "PASS" && results.length === 45 && results.every(test => test.status === "PASS") ? "PASS" : "FAIL", migrationCount: migration.migrationNames?.length, tests: results, cleanup: migration.cleanup, safety: { loopbackOnly: true, syntheticOnly: true, externalOperations: false, providerCallbacks: "synthetic-only;not actual provider delivery", rawLogsSaved: false } };
fs.mkdirSync(path.resolve(".ai-team/reports"), { recursive: true });
fs.writeFileSync(path.resolve(`.ai-team/reports/learner-notifications-${randomUUID()}.json`), JSON.stringify(receipt, null, 2)+"\n");
fs.writeFileSync(path.resolve(".ai-team/reports/learner-notifications-db-latest.json"), JSON.stringify(receipt, null, 2)+"\n");
process.stdout.write(JSON.stringify(receipt)+"\n");
if (receipt.status !== "PASS" || results.length !== 45 || results.some(test => test.status !== "PASS")) process.exitCode = 1;
