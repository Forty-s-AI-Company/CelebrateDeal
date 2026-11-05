/**
 * F-031 review M-1: every envelope target, end to end on PostgreSQL.
 *
 * Two tenants are seeded with one row per target (support cases: every content
 * kind; tracking deliveries: all four sources): tenant A with no keyring (v1),
 * tenant B with a non-legacy active key (v2, which the
 * 20261103160100_sensitive_envelope_v2_checks CHECKs must accept). Every value
 * comes from the module function the application writes it with, and every
 * read goes through the module function the application reads it with. Then:
 * dry run reports no unreadable rows, --apply leaves nothing pending, and with
 * `legacy` removed from the keyring everything still reads back.
 *
 * Only parent rows are skipped: the seed transactions (and only those) run
 * with SET LOCAL session_replication_role = replica, which disables every
 * trigger that is not ENABLE ALWAYS, including foreign-key enforcement and
 * the application's validation triggers. CHECK and NOT NULL constraints still
 * apply, so the stored envelopes meet the real column rules. The
 * re-encryption writes run in normal mode, so every trigger fires there.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import { CLOUDFLARE_STREAM_KEY_PURPOSE } from "../src/lib/cloudflare-ops";
import { protectCustomCheckoutAnswers, revealCustomCheckoutAnswers } from "../src/lib/commerce-custom-checkout";
import { protectCommerceEntitlementAccess, revealCommerceEntitlementAccess } from "../src/lib/commerce-entitlement-access";
import { protectCommerceOrderPii, revealCommerceOrderPii } from "../src/lib/commerce-order-pii";
import { protectEmailDeliveryPayload, revealEmailDeliveryPayload } from "../src/lib/email-delivery-pii";
import {
  learnerContactProofEnvelopePurpose,
  learnerContactReceiptEnvelopePurpose,
  learnerNotificationPayloadEnvelopePurpose,
  learnerNotificationReceiptEnvelopePurpose,
  protectLearnerNotificationDestination,
  revealLearnerNotificationDestination,
} from "../src/lib/learner-notification-contract";
import { learnerNotificationSourceEnvelopePurpose } from "../src/lib/learner-notification-source-events";
import {
  protectLineOfficialAccountCredentials,
  protectLineProfileValue,
  unprotectLineOfficialAccountCredentials,
  unprotectLineProfileValue,
} from "../src/lib/line-credentials";
import { lineLoginVerifierEnvelopePurpose } from "../src/lib/line-login";
import { lineDeliveryPayloadEnvelopePurpose } from "../src/lib/line-notification";
import { luckyDrawClaimEnvelopePurpose } from "../src/lib/live-interaction";
import { decryptPrivateChatBody, encryptPrivateChatBody } from "../src/lib/live-private-chat-storage";
import { decryptMfaSecret, encryptMfaSecret, generateTotpSecret } from "../src/lib/mfa";
import {
  protectOrderItemDeliverySnapshot,
  protectProductDeliveryConfig,
  revealOrderItemDeliverySnapshot,
  revealProductDeliveryConfig,
} from "../src/lib/product-delivery";
import { REGISTRATION_FORM_RETRY_ENVELOPE_PURPOSE } from "../src/lib/registration-form-retry";
import { decryptSensitiveValue, encryptSensitiveValue, sensitiveEnvelopeKeyId } from "../src/lib/sensitive-data";
import { SUPPORT_CASE_CONTENT_KINDS, protectSupportCaseContent, revealSupportCaseContent } from "../src/lib/support-case-pii";
import { protectInvoiceRequest, revealInvoiceRequest } from "../src/lib/taiwan-invoice-request";
import { protectTrackingBrowserContext, revealTrackingBrowserContext } from "../src/lib/tracking-browser-context";
import { protectFacebookAccessToken, unprotectFacebookAccessToken } from "../src/lib/tracking-credentials";
import { APPLY_CONFIRMATION, REENCRYPT_SESSION_FLAG, runSensitiveDataReencryption, type ReencryptOptions } from "./reencrypt-sensitive-data";
import { ENVELOPE_TARGETS, envelopeTargetLabel } from "./sensitive-data-envelope-targets";

const ROOT = "synthetic-all-targets-root-" + "0123456789abcdef";
// Synthetic keyring key built at run time (no key-shaped literal).
const KEY = Buffer.alloc(32, 77).toString("base64url");
const WITH_LEGACY = JSON.stringify([{ kid: "k2026a", key: KEY, active: true }, { kid: "legacy" }]);
const WITHOUT_LEGACY = JSON.stringify([{ kid: "k2026a", key: KEY, active: true }]);
const options: ReencryptOptions = { apply: false, target: null, batchSize: 3, allowUnreadable: false, only: null };

type Value = string | number | boolean | Date | null;
type Tx = Prisma.TransactionClient;
type Cell = { label: string; table: string; idColumn: string; id: string; verify: (row: Record<string, unknown>) => void };

const hex64 = () => randomBytes(32).toString("hex");
const id = (prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`;
const columnCache = new Map<string, Map<string, { udt: string; required: boolean; quotedType: string }>>();
const created = { vendorIds: [] as string[], userIds: [] as string[] };

async function columns(table: string) {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const rows = await getDb().$queryRawUnsafe<Array<{ name: string; udt: string; required: boolean; quoted: string }>>(
    `SELECT a.attname AS name, t.typname AS udt, format_type(a.atttypid, a.atttypmod) AS quoted,
            (a.attnotnull AND NOT a.atthasdef) AS required
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_type t ON t.oid = a.atttypid
      WHERE c.relname = $1 AND c.relnamespace = pg_catalog.current_schema()::regnamespace AND a.attnum > 0 AND NOT a.attisdropped`, table);
  const map = new Map(rows.map((row) => [row.name, { udt: row.udt, required: row.required, quotedType: row.quoted }]));
  columnCache.set(table, map);
  return map;
}

async function firstEnumLabel(udt: string) {
  const [row] = await getDb().$queryRawUnsafe<Array<{ label: string }>>(
    `SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       JOIN pg_namespace n ON n.oid = t.typnamespace AND n.nspname = pg_catalog.current_schema()
      WHERE t.typname = $1 ORDER BY e.enumsortorder LIMIT 1`, udt);
  return row?.label ?? null;
}

async function syntheticValue(udt: string): Promise<Value> {
  if (udt === "text" || udt === "varchar") return id("syn");
  if (udt === "int4" || udt === "int8" || udt === "int2") return 1;
  if (udt === "bool") return false;
  if (udt === "timestamp" || udt === "timestamptz") return new Date();
  if (udt === "jsonb" || udt === "json") return "{}";
  return firstEnumLabel(udt);
}

/** Inserts one row, filling required columns the test does not care about. */
async function insert(tx: Tx, table: string, values: Record<string, Value>) {
  const meta = await columns(table);
  const row: Record<string, Value> = { ...values };
  for (const [name, column] of meta) {
    if (column.required && !(name in row)) row[name] = await syntheticValue(column.udt);
  }
  const names = Object.keys(row);
  for (const name of names) if (!meta.has(name)) throw new Error(`Unknown column ${table}.${name}`);
  const sql = `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${
    names.map((name, index) => `$${index + 1}::text::${meta.get(name)!.quotedType}`).join(", ")})`;
  await tx.$executeRawUnsafe(sql, ...names.map((name) => {
    const value = row[name];
    return value === null || value === undefined ? null : value instanceof Date ? value.toISOString() : String(value);
  }));
}

async function seedTenant(tag: string) {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: `Synthetic ${tag}`, slug: `all-targets-${suffix}`, email: `all-targets-${suffix}@example.test`, passwordHash: "synthetic-only" } });
  const user = await db.user.create({ data: { email: `all-targets-${suffix}@example.test`, name: "Synthetic", passwordHash: "synthetic-only" } });
  created.vendorIds.push(vendor.id);
  created.userIds.push(user.id);
  const vendorId = vendor.id;
  const cells: Cell[] = [];
  const cell = (label: string, rowId: string, verify: Cell["verify"], idColumn = "id") => {
    const [table] = label.split(".");
    cells.push({ label, table: table!, idColumn, id: rowId, verify });
  };

  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");

    const totp = generateTotpSecret();
    await insert(tx, "UserMfaFactor", { id: id("mfa"), userId: user.id, factorType: "totp", secretEncrypted: encryptMfaSecret(totp) });
    cells.push({ label: "UserMfaFactor.secretEncrypted", table: "UserMfaFactor", idColumn: "userId", id: user.id, verify: (row) => expect(decryptMfaSecret(String(row.secretEncrypted))).toBe(totp) });

    const token = `synthetic${randomBytes(16).toString("hex")}`;
    const trackingSettingId = id("ts");
    await insert(tx, "TrackingSetting", { id: trackingSettingId, vendorId, facebookAccessTokenEncrypted: protectFacebookAccessToken(vendorId, token) });
    cell("TrackingSetting.facebookAccessTokenEncrypted", trackingSettingId, (row) => expect(unprotectFacebookAccessToken(vendorId, String(row.facebookAccessTokenEncrypted))).toBe(token));

    const context = { sourceUrl: "https://app.example.test/register", userAgent: "SyntheticBrowser/1.0" };
    const orderId = id("order");
    const paymentId = id("payment");
    for (const [eventName, source] of [
      ["Purchase", { orderId }], ["Lead", { formId: id("form"), submissionId: id("sub") }],
      ["ViewContent", { analyticsEventId: id("event") }], ["Schedule", { bookingId: id("booking") }],
    ] as const) {
      const sourceId = Object.entries(source).find(([key]) => key !== "formId")![1];
      const deliveryId = id("td");
      await insert(tx, "TrackingDelivery", { id: deliveryId, vendorId, eventName, ...source, status: "queued",
        contextEncrypted: protectTrackingBrowserContext(vendorId, sourceId, context) });
      cell("TrackingDelivery.contextEncrypted", deliveryId, (row) => expect(revealTrackingBrowserContext(vendorId, sourceId, String(row.contextEncrypted))).toEqual(context));
    }

    const pii = {
      buyer: { name: "王小明", email: "buyer@example.test", phone: "0900000000" },
      shipping: { recipientName: "王小明", phone: "0900000000", countryCode: "TW", administrativeArea: "台北市", locality: "中正區", addressLine1: "合成路 1 號" },
    };
    const protectedPii = protectCommerceOrderPii(pii, { vendorId, orderId });
    const invoiceSelection = { type: "personal" as const, carrier: "mobile" as const, carrierNumber: "/ABC1234" };
    const invoiceEnvelope = protectInvoiceRequest(invoiceSelection, vendorId, orderId);
    await insert(tx, "CommerceOrder", {
      id: orderId, vendorId, checkoutIdentityHash: protectedPii.checkoutIdentityHash,
      buyerEncryptedEnvelope: protectedPii.buyerEncrypted, buyerMaskedName: protectedPii.buyerNameMasked, buyerMaskedEmail: protectedPii.buyerEmailMasked,
      shippingEncryptedEnvelope: protectedPii.shippingEncrypted, shippingMaskedSummary: protectedPii.shippingSummaryMasked,
      subtotalAmountCents: 100, totalAmountCents: 100, paidAmountCents: 100, status: "paid", primaryPaymentTransactionId: paymentId,
      invoiceRequestEncryptedEnvelope: invoiceEnvelope,
      trackingContextEncrypted: protectTrackingBrowserContext(vendorId, orderId, context),
    });
    const readPii = (row: Record<string, unknown>) => revealCommerceOrderPii(
      { buyerEncrypted: String(row.buyerEncryptedEnvelope), shippingEncrypted: String(row.shippingEncryptedEnvelope) }, { vendorId, orderId });
    cell("CommerceOrder.buyerEncryptedEnvelope", orderId, (row) => expect(readPii(row).buyer.email).toBe("buyer@example.test"));
    cell("CommerceOrder.shippingEncryptedEnvelope", orderId, (row) => expect(readPii(row).shipping?.addressLine1).toBe("合成路 1 號"));
    cell("CommerceOrder.invoiceRequestEncryptedEnvelope", orderId, (row) => expect(revealInvoiceRequest(String(row.invoiceRequestEncryptedEnvelope), vendorId, orderId)).toEqual(invoiceSelection));
    cell("CommerceOrder.trackingContextEncrypted", orderId, (row) => expect(revealTrackingBrowserContext(vendorId, orderId, String(row.trackingContextEncrypted))).toEqual(context));

    const invoiceId = id("einv");
    await insert(tx, "ElectronicInvoice", { id: invoiceId, vendorId, orderId, requestEncryptedEnvelope: invoiceEnvelope });
    cell("ElectronicInvoice.requestEncryptedEnvelope", invoiceId, (row) => expect(revealInvoiceRequest(String(row.requestEncryptedEnvelope), vendorId, orderId)).toEqual(invoiceSelection));

    const fields = [{ key: "engraving", label: "刻字", type: "text" as const, required: true }];
    const orderItemId = id("item");
    await insert(tx, "CommerceOrderItem", { id: orderItemId, vendorId, orderId, fulfillmentType: "digital",
      customCheckoutAnswersEncryptedEnvelope: protectCustomCheckoutAnswers(fields, { engraving: "給小明" }, { vendorId, orderId, orderItemId }) });
    cell("CommerceOrderItem.customCheckoutAnswersEncryptedEnvelope", orderItemId,
      (row) => expect(revealCustomCheckoutAnswers(String(row.customCheckoutAnswersEncryptedEnvelope), fields, { vendorId, orderId, orderItemId })).toEqual({ engraving: "給小明" }));

    const entitlementId = id("ent");
    const access = protectCommerceEntitlementAccess({ vendorId, entitlementId, orderItemId });
    await insert(tx, "CommerceEntitlement", { id: entitlementId, vendorId, orderItemId, ...access });
    cell("CommerceEntitlement.accessEncryptedEnvelope", entitlementId,
      (row) => expect(revealCommerceEntitlementAccess(String(row.accessEncryptedEnvelope), { vendorId, entitlementId, orderItemId })).toMatchObject({ entitlementId }));

    const delivery = { fulfillmentType: "digital" as const, deliveryKind: "digital_link" as const, status: "active" as const, title: "下載",
      destinationUrl: "https://files.example.test/a", destinationHostname: "files.example.test", destinationPathPrefix: "/", instructions: "請於七天內下載" };
    const configId = id("pdc");
    const productId = id("product");
    const configBinding = { vendorId, productId, configId, revision: 2 };
    await insert(tx, "ProductDeliveryConfig", { id: configId, vendorId, productId, revision: 2, ...protectProductDeliveryConfig(delivery, configBinding) });
    for (const column of ["destinationEncryptedEnvelope", "instructionsEncryptedEnvelope"]) {
      cell(`ProductDeliveryConfig.${column}`, configId, (row) => expect(revealProductDeliveryConfig(
        { destinationEncryptedEnvelope: String(row.destinationEncryptedEnvelope), instructionsEncryptedEnvelope: String(row.instructionsEncryptedEnvelope) }, configBinding,
      )).toEqual({ destinationUrl: delivery.destinationUrl, instructions: delivery.instructions }));
    }
    const snapshotId = id("snap");
    const snapshotBinding = { vendorId, orderId, orderItemId, snapshotId };
    await insert(tx, "CommerceOrderItemDeliverySnapshot", { id: snapshotId, vendorId, orderId, orderItemId,
      ...protectOrderItemDeliverySnapshot({ destinationUrl: delivery.destinationUrl, instructions: delivery.instructions }, snapshotBinding) });
    for (const column of ["destinationEncryptedEnvelope", "instructionsEncryptedEnvelope"]) {
      cell(`CommerceOrderItemDeliverySnapshot.${column}`, snapshotId, (row) => expect(revealOrderItemDeliverySnapshot(
        { destinationEncryptedEnvelope: String(row.destinationEncryptedEnvelope), instructionsEncryptedEnvelope: String(row.instructionsEncryptedEnvelope) }, snapshotBinding,
      )).toEqual({ destinationUrl: delivery.destinationUrl, instructions: delivery.instructions }));
    }

    const emailId = id("email");
    await insert(tx, "EmailDelivery", { id: emailId, vendorId,
      ...protectEmailDeliveryPayload({ recipientEmail: "learner@example.test", subject: "合成主旨", body: "合成內容" }, { vendorId, deliveryId: emailId }) });
    cell("EmailDelivery.payloadEncryptedEnvelope", emailId,
      (row) => expect(revealEmailDeliveryPayload(String(row.payloadEncryptedEnvelope), { vendorId, deliveryId: emailId })).toMatchObject({ recipientEmail: "learner@example.test" }));

    const idHash = hex64();
    const draft = JSON.stringify({ synthetic: true, idHash });
    await insert(tx, "RegistrationFormRetryDraft", { idHash, vendorId, formId: id("form"), sourcePath: "/form/synthetic",
      encryptedPayload: encryptSensitiveValue(draft, REGISTRATION_FORM_RETRY_ENVELOPE_PURPOSE), expiresAt: new Date(Date.now() + 5 * 60_000) });
    cell("RegistrationFormRetryDraft.encryptedPayload", idHash,
      (row) => expect(decryptSensitiveValue(String(row.encryptedPayload), REGISTRATION_FORM_RETRY_ENVELOPE_PURPOSE)).toBe(draft), "idHash");

    const credentials = { messagingChannelId: "1234567890", messagingChannelSecret: `secret-${suffix}`, messagingAccessToken: `access-${suffix}`,
      loginChannelId: "9876543210", loginChannelSecret: `login-${suffix}` };
    const accountId = id("loa");
    await insert(tx, "LineOfficialAccount", { id: accountId, vendorId, ...protectLineOfficialAccountCredentials(vendorId, credentials) });
    for (const column of ["messagingChannelIdEncrypted", "messagingChannelSecretEncrypted", "messagingAccessTokenEncrypted", "loginChannelIdEncrypted", "loginChannelSecretEncrypted"]) {
      cell(`LineOfficialAccount.${column}`, accountId, (row) => expect(unprotectLineOfficialAccountCredentials(vendorId, {
        messagingChannelIdEncrypted: String(row.messagingChannelIdEncrypted), messagingChannelSecretEncrypted: String(row.messagingChannelSecretEncrypted),
        messagingAccessTokenEncrypted: String(row.messagingAccessTokenEncrypted), loginChannelIdEncrypted: String(row.loginChannelIdEncrypted),
        loginChannelSecretEncrypted: String(row.loginChannelSecretEncrypted),
      })).toEqual(credentials));
    }

    const identityId = id("lui");
    const profile = { userId: `U${randomBytes(16).toString("hex")}`, displayName: "合成 LINE", pictureUrl: "https://profile.example.test/p.png" };
    await insert(tx, "LineUserIdentity", { id: identityId, vendorId,
      lineUserIdEncrypted: protectLineProfileValue(vendorId, "userId", profile.userId),
      displayNameEncrypted: protectLineProfileValue(vendorId, "displayName", profile.displayName),
      pictureUrlEncrypted: protectLineProfileValue(vendorId, "pictureUrl", profile.pictureUrl) });
    for (const [column, field] of [["lineUserIdEncrypted", "userId"], ["displayNameEncrypted", "displayName"], ["pictureUrlEncrypted", "pictureUrl"]] as const) {
      cell(`LineUserIdentity.${column}`, identityId, (row) => expect(unprotectLineProfileValue(vendorId, field, String(row[column]))).toBe(profile[field]));
    }

    const stateId = id("lls");
    const verifier = `${randomBytes(24).toString("base64url")}:${randomBytes(8).toString("hex")}`;
    await insert(tx, "LineLoginState", { id: stateId, vendorId, codeVerifierEncrypted: encryptSensitiveValue(verifier, lineLoginVerifierEnvelopePurpose(vendorId, stateId)),
      expiresAt: new Date(Date.now() + 600_000) });
    cell("LineLoginState.codeVerifierEncrypted", stateId,
      (row) => expect(decryptSensitiveValue(String(row.codeVerifierEncrypted), lineLoginVerifierEnvelopePurpose(vendorId, stateId))).toBe(verifier));

    const lineDeliveryId = id("ld");
    const messages = JSON.stringify([{ type: "text", text: "合成通知" }]);
    await insert(tx, "LineDelivery", { id: lineDeliveryId, vendorId, payloadEncrypted: encryptSensitiveValue(messages, lineDeliveryPayloadEnvelopePurpose(vendorId, lineDeliveryId)) });
    cell("LineDelivery.payloadEncrypted", lineDeliveryId,
      (row) => expect(decryptSensitiveValue(String(row.payloadEncrypted), lineDeliveryPayloadEnvelopePurpose(vendorId, lineDeliveryId))).toBe(messages));

    const messageId = hex64();
    const chatScope = { vendorId, liveId: id("live"), submissionId: id("sub"), messageId, source: "viewer" as const };
    await insert(tx, "LivePrivateChatMessage", { id: messageId, vendorId, liveId: chatScope.liveId, formSubmissionId: chatScope.submissionId,
      source: "viewer", bodyEncrypted: encryptPrivateChatBody("私訊內容", chatScope) });
    cell("LivePrivateChatMessage.bodyEncrypted", messageId, (row) => expect(decryptPrivateChatBody(String(row.bodyEncrypted), chatScope)).toBe("私訊內容"));

    const supportCaseId = id("case");
    for (const kind of SUPPORT_CASE_CONTENT_KINDS) {
      const eventId = id("sce");
      await insert(tx, "SupportCaseEvent", { id: eventId, vendorId, supportCaseId, actorUserId: user.id,
        payloadEncryptedEnvelope: protectSupportCaseContent(`客服內容 ${kind}`, { vendorId, supportCaseId, recordId: eventId, kind }) });
      cell("SupportCaseEvent.payloadEncryptedEnvelope", eventId,
        (row) => expect(revealSupportCaseContent(String(row.payloadEncryptedEnvelope), { vendorId, supportCaseId, recordId: eventId, kind })).toBe(`客服內容 ${kind}`));
    }
    const handoffId = id("srh");
    await insert(tx, "SupportRefundHandoff", { id: handoffId, vendorId, supportCaseId, orderId, paymentTransactionId: paymentId, requestedAmountCents: 100,
      reasonEncryptedEnvelope: protectSupportCaseContent("退款原因", { vendorId, supportCaseId, recordId: handoffId, kind: "refund_reason" }) });
    cell("SupportRefundHandoff.reasonEncryptedEnvelope", handoffId,
      (row) => expect(revealSupportCaseContent(String(row.reasonEncryptedEnvelope), { vendorId, supportCaseId, recordId: handoffId, kind: "refund_reason" })).toBe("退款原因"));

    const responseId = id("lir");
    const claimCode = randomBytes(6).toString("hex");
    await insert(tx, "LiveInteractionResponse", { id: responseId, vendorId,
      winnerClaimCodeEncryptedEnvelope: encryptSensitiveValue(claimCode, luckyDrawClaimEnvelopePurpose(vendorId, responseId)) });
    cell("LiveInteractionResponse.winnerClaimCodeEncryptedEnvelope", responseId,
      (row) => expect(decryptSensitiveValue(String(row.winnerClaimCodeEncryptedEnvelope), luckyDrawClaimEnvelopePurpose(vendorId, responseId))).toBe(claimCode));

    const learnerScope = { vendorId, productId, customerKeyHash: randomBytes(32).toString("base64url") };
    const destination = { email: "learner@example.test" };
    const preferenceId = id("lnp");
    await insert(tx, "LearnerNotificationPreference", { id: preferenceId, vendorId, productId, customerKeyHash: learnerScope.customerKeyHash, channel: "email",
      destinationEncryptedEnvelope: protectLearnerNotificationDestination(learnerScope, "email", destination).encryptedEnvelope });
    cell("LearnerNotificationPreference.destinationEncryptedEnvelope", preferenceId,
      (row) => expect(revealLearnerNotificationDestination(learnerScope, "email", String(row.destinationEncryptedEnvelope))).toEqual(destination));

    const learnerDeliveryId = id("lnd");
    const deduplicationKey = hex64();
    const payload = JSON.stringify({ synthetic: "payload" });
    await insert(tx, "LearnerNotificationDelivery", { id: learnerDeliveryId, vendorId, productId, preferenceId, event: "lesson_published",
      deduplicationKey, payloadEncryptedEnvelope: encryptSensitiveValue(payload, learnerNotificationPayloadEnvelopePurpose(vendorId, deduplicationKey)),
      providerReceiptEncryptedEnvelope: encryptSensitiveValue("receipt", learnerNotificationReceiptEnvelopePurpose(vendorId, learnerDeliveryId)) });
    cell("LearnerNotificationDelivery.payloadEncryptedEnvelope", learnerDeliveryId,
      (row) => expect(decryptSensitiveValue(String(row.payloadEncryptedEnvelope), learnerNotificationPayloadEnvelopePurpose(vendorId, deduplicationKey))).toBe(payload));
    cell("LearnerNotificationDelivery.providerReceiptEncryptedEnvelope", learnerDeliveryId,
      (row) => expect(decryptSensitiveValue(String(row.providerReceiptEncryptedEnvelope), learnerNotificationReceiptEnvelopePurpose(vendorId, learnerDeliveryId))).toBe("receipt"));

    const verificationId = id("lnv");
    const proof = randomBytes(32).toString("base64url");
    const protectedDestination = protectLearnerNotificationDestination(learnerScope, "email", destination);
    await insert(tx, "LearnerNotificationVerification", { id: verificationId, vendorId, productId, preferenceId, tokenHash: hex64(),
      destinationEncryptedEnvelope: protectedDestination.encryptedEnvelope, destinationKeyHash: protectedDestination.destinationKeyHash,
      deliveryTokenEncryptedEnvelope: encryptSensitiveValue(proof, learnerContactProofEnvelopePurpose(vendorId, verificationId)),
      deliveryReceiptEncryptedEnvelope: encryptSensitiveValue("contact-receipt", learnerContactReceiptEnvelopePurpose(vendorId, verificationId)),
      expiresAt: new Date(Date.now() + 3_600_000) });
    cell("LearnerNotificationVerification.destinationEncryptedEnvelope", verificationId,
      (row) => expect(revealLearnerNotificationDestination(learnerScope, "email", String(row.destinationEncryptedEnvelope))).toEqual(destination));
    cell("LearnerNotificationVerification.deliveryTokenEncryptedEnvelope", verificationId,
      (row) => expect(decryptSensitiveValue(String(row.deliveryTokenEncryptedEnvelope), learnerContactProofEnvelopePurpose(vendorId, verificationId))).toBe(proof));
    cell("LearnerNotificationVerification.deliveryReceiptEncryptedEnvelope", verificationId,
      (row) => expect(decryptSensitiveValue(String(row.deliveryReceiptEncryptedEnvelope), learnerContactReceiptEnvelopePurpose(vendorId, verificationId))).toBe("contact-receipt"));

    const sourceEventId = id("lns");
    const sourceInput = { vendorId, productId, event: "lesson_published" as const, eventIdentity: id("lesson") };
    await insert(tx, "LearnerNotificationSourceEvent", { id: sourceEventId, ...sourceInput,
      payloadEncryptedEnvelope: encryptSensitiveValue(payload, learnerNotificationSourceEnvelopePurpose(sourceInput)) });
    cell("LearnerNotificationSourceEvent.payloadEncryptedEnvelope", sourceEventId,
      (row) => expect(decryptSensitiveValue(String(row.payloadEncryptedEnvelope), learnerNotificationSourceEnvelopePurpose(sourceInput))).toBe(payload));

    const videoId = id("video");
    const streamKey = `stream-${randomBytes(12).toString("hex")}`;
    await insert(tx, "Video", { id: videoId, vendorId, liveStreamKey: encryptSensitiveValue(streamKey, CLOUDFLARE_STREAM_KEY_PURPOSE) });
    cell("Video.liveStreamKey", videoId, (row) => expect(decryptSensitiveValue(String(row.liveStreamKey), CLOUDFLARE_STREAM_KEY_PURPOSE)).toBe(streamKey));
  });
  return { vendorId, userId: user.id, cells };
}

async function storedRow(cell: Cell) {
  const [row] = await getDb().$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT * FROM "${cell.table}" WHERE "${cell.idColumn}" = $1`, cell.id);
  if (!row) throw new Error(`Missing ${cell.label}`);
  return row;
}

async function verifyAll(cells: Cell[]) {
  for (const cell of cells) {
    try {
      cell.verify(await storedRow(cell));
    } catch (error) {
      throw new Error(`${cell.label}: ${(error as Error).message}`);
    }
  }
}

async function keyIdsOf(cells: Cell[]) {
  const kids = new Set<string | null>();
  for (const cell of cells) {
    const row = await storedRow(cell);
    const column = cell.label.split(".")[1]!;
    const value = String(row[column]);
    kids.add(column === "secretEncrypted" && !value.startsWith("v2.") ? "legacy" : sensitiveEnvelopeKeyId(value));
  }
  return kids;
}

async function cleanup() {
  const vendorIds = created.vendorIds.splice(0);
  const userIds = created.userIds.splice(0);
  if (vendorIds.length + userIds.length === 0) return;
  await getDb().$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    for (const table of new Set(ENVELOPE_TARGETS.map((target) => target.table))) {
      const scope = ENVELOPE_TARGETS.find((target) => target.table === table)!.scopeColumn;
      await tx.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "${scope}" = ANY($1::text[])`, scope === "userId" ? userIds : vendorIds);
    }
  });
  await getDb().vendor.deleteMany({ where: { id: { in: vendorIds } } });
  await getDb().user.deleteMany({ where: { id: { in: userIds } } });
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", ROOT);
  vi.stubEnv("JOB_SECRET", "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv("DATA_ENCRYPTION_KEYRING", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await cleanup();
});

afterAll(cleanup);

describe("re-encryption across every envelope target (PostgreSQL)", () => {
  it("writes and reads all 38 targets under v1 and v2, re-encrypts to the active kid and survives removing legacy", async () => {
    const legacyTenant = await seedTenant("legacy");
    vi.stubEnv("DATA_ENCRYPTION_KEYRING", WITH_LEGACY);
    const keyringTenant = await seedTenant("keyring");
    const scope = { vendorIds: [legacyTenant.vendorId, keyringTenant.vendorId], userIds: [legacyTenant.userId, keyringTenant.userId] };

    // Every target got at least one cell in each tenant.
    const labels = ENVELOPE_TARGETS.map(envelopeTargetLabel);
    expect(labels).toHaveLength(38);
    for (const tenant of [legacyTenant, keyringTenant]) {
      expect(labels.filter((label) => !tenant.cells.some((cell) => cell.label === label))).toEqual([]);
    }
    expect(await keyIdsOf(legacyTenant.cells)).toEqual(new Set(["legacy"]));
    expect(await keyIdsOf(keyringTenant.cells)).toEqual(new Set(["k2026a"]));
    await verifyAll([...legacyTenant.cells, ...keyringTenant.cells]);

    const plan = await runSensitiveDataReencryption(getDb(), options, {}, { scope });
    expect(plan).toMatchObject({ mode: "plan", activeKeyId: "k2026a", unreadable: 0, unrecognized: 0, pending: legacyTenant.cells.length });
    for (const target of plan.targets) {
      expect(target.rows, `${target.table}.${target.column}`).toBeGreaterThanOrEqual(2);
      expect(Object.keys(target.byKeyId).sort(), `${target.table}.${target.column}`).toEqual(["k2026a", "legacy"]);
    }

    const applied = await runSensitiveDataReencryption(getDb(), { ...options, apply: true }, { DATA_REENCRYPT_CONFIRM: APPLY_CONFIRMATION }, { scope });
    expect(applied).toMatchObject({ mode: "apply", reencrypted: legacyTenant.cells.length, changed: 0, remainingPending: 0, remainingUnreadable: 0 });
    expect(await keyIdsOf(legacyTenant.cells)).toEqual(new Set(["k2026a"]));

    vi.stubEnv("DATA_ENCRYPTION_KEYRING", WITHOUT_LEGACY);
    await verifyAll([...legacyTenant.cells, ...keyringTenant.cells]);
    const after = await runSensitiveDataReencryption(getDb(), options, {}, { scope });
    expect(after).toMatchObject({ pending: 0, unreadable: 0, unrecognized: 0 });
  });

  it("stores v2 envelopes where CHECKs used to pin v1, rejects malformed values and keeps the refund reason immutable outside re-encryption", async () => {
    vi.stubEnv("DATA_ENCRYPTION_KEYRING", WITH_LEGACY);
    const tenant = await seedTenant("checks");
    const chat = tenant.cells.find((cell) => cell.label === "LivePrivateChatMessage.bodyEncrypted")!;
    const draft = tenant.cells.find((cell) => cell.label === "RegistrationFormRetryDraft.encryptedPayload")!;
    expect(String((await storedRow(chat)).bodyEncrypted)).toMatch(/^v2\.k2026a\./u);
    expect(String((await storedRow(draft)).encryptedPayload)).toMatch(/^v2\.k2026a\./u);

    const db = getDb();
    await expect(db.$executeRawUnsafe(`UPDATE "LivePrivateChatMessage" SET "bodyEncrypted" = 'v3.x.y.z' WHERE "id" = $1`, chat.id)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`UPDATE "LivePrivateChatMessage" SET "bodyEncrypted" = 'v2.UPPER.aaaaaaaaaaaaaaaa.aaaaaaaaaaaaaaaaaaaaaa.a' WHERE "id" = $1`, chat.id)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`UPDATE "RegistrationFormRetryDraft" SET "encryptedPayload" = 'plaintext' WHERE "idHash" = $1`, draft.id)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`UPDATE "RegistrationFormRetryDraft" SET "encryptedPayload" = 'v2.' || repeat('a', 533414) WHERE "idHash" = $1`, draft.id)).rejects.toThrow();
    expect(await db.$executeRawUnsafe(`UPDATE "RegistrationFormRetryDraft" SET "encryptedPayload" = 'v2.' || repeat('a', 533413) WHERE "idHash" = $1`, draft.id)).toBe(1);

    // The refund reason stays immutable for the application. A re-encryption
    // transaction may swap it only between well-formed envelopes with
    // different key ids; a value whose kid cannot be read is never replaced.
    const handoff = tenant.cells.find((cell) => cell.label === "SupportRefundHandoff.reasonEncryptedEnvelope")!;
    const reason = String((await storedRow(handoff)).reasonEncryptedEnvelope);
    expect(sensitiveEnvelopeKeyId(reason)).toBe("k2026a");
    const sameKid = encryptSensitiveValue("另一個原因", "synthetic-other-purpose");
    vi.stubEnv("DATA_ENCRYPTION_KEYRING", "");
    const legacyKid = encryptSensitiveValue("另一個原因", "synthetic-other-purpose");
    const plainSwap = (value: string) => db.$executeRawUnsafe(`UPDATE "SupportRefundHandoff" SET "reasonEncryptedEnvelope" = $1 WHERE "id" = $2`, value, handoff.id);
    const flaggedSwap = (value: string) => db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT pg_catalog.set_config('${REENCRYPT_SESSION_FLAG}', 'on', true)`);
      return tx.$executeRawUnsafe(`UPDATE "SupportRefundHandoff" SET "reasonEncryptedEnvelope" = $1 WHERE "id" = $2`, value, handoff.id);
    });
    await expect(plainSwap(legacyKid)).rejects.toThrow("commercial identity is immutable");
    await expect(flaggedSwap("not-an-envelope")).rejects.toThrow("commercial identity is immutable");
    await expect(flaggedSwap(sameKid)).rejects.toThrow("commercial identity is immutable");
    expect(await flaggedSwap(legacyKid)).toBe(1);
    // The flag is transaction-local: the next plain statement is refused again.
    await expect(plainSwap(reason)).rejects.toThrow("commercial identity is immutable");
    expect(await flaggedSwap(reason)).toBe(1);

    // A stored value whose kid cannot be read is never replaced, even by a
    // well-formed envelope under the flag.
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRawUnsafe(`UPDATE "SupportRefundHandoff" SET "reasonEncryptedEnvelope" = 'damaged' WHERE "id" = $1`, handoff.id);
    });
    await expect(flaggedSwap(legacyKid)).rejects.toThrow("commercial identity is immutable");
  });
});

