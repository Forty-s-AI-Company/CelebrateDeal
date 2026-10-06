import { createHash, randomBytes } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { LearnerNotificationChannel, LearnerNotificationEvent, LearnerNotificationScope, learnerNotificationDeliveryKey, mayDispatchLearnerNotification, type LearnerNotificationScope as Scope } from "./learner-notification-contract";
import { decryptSensitiveValue, encryptSensitiveValue } from "./sensitive-data";

export const LearnerNotificationMessage = z.object({
 title: z.string().trim().min(1).max(200),
 body: z.string().trim().min(1).max(2000),
 // Product links never carry session tokens, contact details or a foreign origin.
 path: z.string().max(512).regex(/^\/(?!\/)[A-Za-z0-9_/%.-]+$/u),
}).strict();
type Store = Pick<Prisma.TransactionClient, "commerceOrderItem" | "learnerNotificationPreference" | "learnerNotificationDelivery">;
type Database = Store & Pick<PrismaClient, "$transaction">;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const payloadPurpose = (vendorId: string, key: string) => `learner-notification-payload-v1:${JSON.stringify([vendorId,key])}`;

/** Every supported event keeps a live vendor/customer/product purchase boundary. */
async function hasRights(tx: Store, scope: Scope) {
 return !!await tx.commerceOrderItem.findFirst({ where: {
  vendorId: scope.vendorId, productId: scope.productId,
  entitlement: { is: { status: "granted", revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } },
  order: { is: { vendorId: scope.vendorId, automationCustomerKeyHash: scope.customerKeyHash, status: { in: ["paid", "partially_refunded"] } } },
 }, select: { id: true } });
}
async function serializable<T>(db: Database, run: (tx: Prisma.TransactionClient) => Promise<T>) {
 for (let attempt = 0; attempt < 3; attempt++) {
  try { return await db.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
  catch (error) {
   if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code) || attempt === 2) throw error;
  }
 }
 throw new Error("Notification outbox transaction failed.");
}

/** Internal event producers call this after committing a real lesson/order/live event.
 * This is never a public endpoint accepting arbitrary learner or event identities. */
export async function enqueueLearnerNotification(db: Database, rawScope: Scope, raw: { channel: string; event: string; eventIdentity: string; message: unknown }) {
 const scope = LearnerNotificationScope.parse(rawScope), channel = LearnerNotificationChannel.parse(raw.channel), event = LearnerNotificationEvent.parse(raw.event);
 const message = LearnerNotificationMessage.parse(raw.message);
 return serializable(db, async tx => {
  const preference = await tx.learnerNotificationPreference.findFirst({ where: { ...scope, channel } });
  if (!preference?.enabled || !preference.destinationVerifiedAt || !preference.destinationEncryptedEnvelope || !preference.destinationKeyHash || !await hasRights(tx,scope)) return null;
  const key = learnerNotificationDeliveryKey(scope, channel, event, raw.eventIdentity, preference.revision);
  return tx.learnerNotificationDelivery.upsert({ where: { vendorId_deduplicationKey: { vendorId: scope.vendorId, deduplicationKey: key } }, update: {},
   create: { vendorId: scope.vendorId, productId: scope.productId, preferenceId: preference.id, event, eventIdentity: raw.eventIdentity,
    deduplicationKey: key, consentRevision: preference.revision, payloadEncryptedEnvelope: encryptSensitiveValue(JSON.stringify(message), payloadPurpose(scope.vendorId,key)) },
   select: { id: true, status: true } });
 });
}

/** Exact ID claim, no "latest recipient" fallback. Only one worker receives a token.
 * Processing rows never auto-retry after a crash: external delivery may have happened. */
export async function claimLearnerNotification(db: Database, vendorId: string, deliveryId: string) {
 if (!/^[A-Za-z0-9_-]{1,128}$/u.test(vendorId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(deliveryId)) throw new Error("Invalid notification identity.");
 return serializable(db, async tx => {
  const row = await tx.learnerNotificationDelivery.findFirst({ where: { vendorId, id: deliveryId, status: "queued", attemptCount: { lt: 5 }, nextAttemptAt: { lte: new Date() } } });
  if (!row) return null;
  const preference = await tx.learnerNotificationPreference.findFirst({ where: { vendorId, productId: row.productId, id: row.preferenceId } });
  const scope = preference ? LearnerNotificationScope.parse({ vendorId, customerKeyHash: preference.customerKeyHash, productId: row.productId }) : null;
  const authorized = !!preference && !!scope && mayDispatchLearnerNotification({ purchaseGranted: await hasRights(tx,scope), orderPaid: true,
   consentEnabled: preference.enabled, destinationVerified: !!preference.destinationVerifiedAt && !!preference.destinationEncryptedEnvelope && !!preference.destinationKeyHash,
   consentRevision: preference.revision, reservedConsentRevision: row.consentRevision, alreadyDispatched: !!row.dispatchedAt });
  if (!authorized || !preference || !scope) {
   await tx.learnerNotificationDelivery.updateMany({ where: { vendorId, id: row.id, status: "queued" }, data: { status: "suppressed", nextAttemptAt: null, lastErrorCode: "AUTHORIZATION_REVOKED" } });
   return null;
  }
  const claimToken = randomBytes(32).toString("base64url"), claimedAt = new Date();
  const changed = await tx.learnerNotificationDelivery.updateMany({ where: { vendorId, id: row.id, status: "queued", attemptCount: row.attemptCount },
   data: { status: "processing", claimTokenHash: tokenHash(claimToken), claimedAt, attemptCount: { increment: 1 }, nextAttemptAt: null } });
  if (changed.count !== 1) return null;
  const message = LearnerNotificationMessage.parse(JSON.parse(decryptSensitiveValue(row.payloadEncryptedEnvelope, payloadPurpose(vendorId,row.deduplicationKey))));
  return { id: row.id, vendorId, claimToken, scope, channel: LearnerNotificationChannel.parse(preference.channel),
   destinationEncryptedEnvelope: preference.destinationEncryptedEnvelope!, message, idempotencyKey: row.deduplicationKey };
 });
}

/** Record only explicit provider outcomes. Unknown network outcomes are terminal
 * indeterminate; retrying those would risk duplicate paid SMS/WhatsApp messages. */
export async function finishLearnerNotification(db: Database, input: { vendorId: string; id: string; claimToken: string; outcome: "sent" | "not_delivered" | "indeterminate"; providerReceipt?: string }) {
 if (!/^[A-Za-z0-9_-]{43}$/u.test(input.claimToken) || !["sent","not_delivered","indeterminate"].includes(input.outcome)) throw new Error("Invalid notification result.");
 if (input.providerReceipt && input.providerReceipt.length > 4096) throw new Error("Invalid notification receipt.");
 return serializable(db, async tx => {
  const identity = { vendorId: input.vendorId, id: input.id, status: "processing", claimTokenHash: tokenHash(input.claimToken) };
  const row = await tx.learnerNotificationDelivery.findFirst({ where: identity });
  if (!row) return false;
  const retry = input.outcome === "not_delivered" && row.attemptCount < 5;
  const status = input.outcome === "sent" ? "sent" : retry ? "queued" : input.outcome === "indeterminate" ? "indeterminate" : "failed";
  const changed = await tx.learnerNotificationDelivery.updateMany({ where: identity, data: { status, claimTokenHash: null,
   nextAttemptAt: retry ? new Date(Date.now() + 30_000 * 2 ** (row.attemptCount - 1)) : null,
   dispatchedAt: input.outcome === "sent" ? new Date() : null,
   lastErrorCode: input.outcome === "sent" ? null : input.outcome === "indeterminate" ? "PROVIDER_OUTCOME_UNKNOWN" : "PROVIDER_NOT_DELIVERED",
   providerReceiptEncryptedEnvelope: input.providerReceipt ? encryptSensitiveValue(input.providerReceipt, `learner-notification-receipt-v1:${JSON.stringify([input.vendorId,input.id])}`) : null } });
  return changed.count === 1;
 });
}
