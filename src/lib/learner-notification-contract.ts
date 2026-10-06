import { createHmac } from "node:crypto";
import { z } from "zod";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "./sensitive-data";

export const LearnerNotificationChannel = z.enum(["email", "push", "sms", "whatsapp"]);
export type LearnerNotificationChannel = z.infer<typeof LearnerNotificationChannel>;
export const LearnerNotificationScope = z.object({
  vendorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  customerKeyHash: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  productId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
}).strict();
export type LearnerNotificationScope = z.infer<typeof LearnerNotificationScope>;
export const LearnerNotificationEvent = z.enum(["lesson_published", "discussion_reply", "course_completed", "live_started", "consultation_reminder", "payment_success"]);
export type LearnerNotificationEvent = z.infer<typeof LearnerNotificationEvent>;
const Phone = z.string().regex(/^\+[1-9][0-9]{7,14}$/u);

/** Channels share a tenant-qualified consent contract; no caller selects another learner. */
export const LearnerNotificationConsentInput = z.object({
  channel: LearnerNotificationChannel,
  enabled: z.boolean(),
  expectedRevision: z.number().int().safe().nonnegative(),
}).strict();
export const LearnerPhoneDestination = z.object({ phone: Phone }).strict();
export const LearnerEmailDestination = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();

function purpose(scope: LearnerNotificationScope, channel: LearnerNotificationChannel) {
  const identity = LearnerNotificationScope.parse(scope);
  return `learner-notification-v1:${JSON.stringify([identity.vendorId, identity.customerKeyHash, identity.productId, LearnerNotificationChannel.parse(channel)])}`;
}

/** Encrypt device endpoints and contacts with the recipient/course/channel bound as AEAD purpose. */
export function protectLearnerNotificationDestination(scope: LearnerNotificationScope, channel: LearnerNotificationChannel, destination: unknown) {
  const binding = purpose(scope, channel);
  const plaintext = JSON.stringify(destination);
  if (!plaintext || Buffer.byteLength(plaintext, "utf8") > 4096) throw new Error("Notification destination is invalid.");
  return {
    encryptedEnvelope: encryptSensitiveValue(plaintext, binding),
    destinationKeyHash: createHmac("sha256", deriveSensitiveDataKey("learner-notification-destination-index-v1"))
      .update(binding).update("\0").update(plaintext).digest("hex"),
  };
}

export function revealLearnerNotificationDestination(scope: LearnerNotificationScope, channel: LearnerNotificationChannel, envelope: string): unknown {
  return JSON.parse(decryptSensitiveValue(envelope, purpose(scope, channel)));
}

/** Frame event identity independently of consent revisions: re-enabling consent
 * must not redeliver an already dispatched event. Revision remains an authorization fence. */
export function learnerNotificationDeliveryKey(scope: LearnerNotificationScope, channel: LearnerNotificationChannel, event: LearnerNotificationEvent, eventId: string, consentRevision: number) {
  const identity = LearnerNotificationScope.parse(scope);
  const parsedEvent = LearnerNotificationEvent.parse(event);
  const parsedChannel = LearnerNotificationChannel.parse(channel);
  if (!/^[A-Za-z0-9_-]{1,160}$/u.test(eventId) || !Number.isSafeInteger(consentRevision) || consentRevision < 1) throw new Error("Notification event identity is invalid.");
  return createHmac("sha256", deriveSensitiveDataKey("learner-notification-delivery-key-v1"))
    .update(JSON.stringify([identity.vendorId, identity.customerKeyHash, identity.productId, parsedChannel, parsedEvent, eventId]))
    .digest("hex");
}

/** Recheck live purchase rights and the exact consent revision immediately before dispatch. */
export function mayDispatchLearnerNotification(input: { purchaseGranted: boolean; orderPaid: boolean; consentEnabled: boolean; consentRevision: number; reservedConsentRevision: number; destinationVerified: boolean; alreadyDispatched: boolean }) {
  return input.purchaseGranted && input.orderPaid && input.consentEnabled && input.destinationVerified
    && !input.alreadyDispatched && Number.isSafeInteger(input.consentRevision) && input.consentRevision > 0
    && input.consentRevision === input.reservedConsentRevision;
}
