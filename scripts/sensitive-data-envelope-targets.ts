/**
 * F-031 ②③: every database column that holds a sensitive-data envelope
 * (src/lib/sensitive-data.ts, kid `legacy` = v1 or a keyring kid = v2), and
 * how to rebuild the exact purpose each row was encrypted with.
 *
 * Purposes come from the modules that write them (exported for this list), so
 * a change there cannot drift silently. When a row's binding is ambiguous
 * (support-case kind, tracking source) the target lists every candidate; GCM
 * authentication proves which one is right, and a row no candidate opens is
 * reported as unreadable and never written.
 *
 * scripts/sensitive-data-envelope-targets.test.ts checks that every
 * encrypted-looking column in prisma/schema.prisma is either listed here or
 * excluded below with a reason.
 */
import { CLOUDFLARE_STREAM_KEY_PURPOSE } from "../src/lib/cloudflare-ops";
import { customCheckoutAnswersEnvelopePurpose } from "../src/lib/commerce-custom-checkout";
import { commerceEntitlementAccessEnvelopePurpose } from "../src/lib/commerce-entitlement-access";
import { commerceOrderPiiEnvelopePurpose } from "../src/lib/commerce-order-pii";
import { emailDeliveryPayloadEnvelopePurpose } from "../src/lib/email-delivery-pii";
import {
  LearnerNotificationChannel,
  learnerContactProofEnvelopePurpose,
  learnerContactReceiptEnvelopePurpose,
  learnerNotificationDestinationEnvelopePurpose,
  learnerNotificationPayloadEnvelopePurpose,
  learnerNotificationReceiptEnvelopePurpose,
} from "../src/lib/learner-notification-contract";
import { learnerNotificationSourceEnvelopePurpose } from "../src/lib/learner-notification-source-events";
import { lineOfficialAccountCredentialEnvelopePurpose, lineProfileEnvelopePurpose } from "../src/lib/line-credentials";
import { lineLoginVerifierEnvelopePurpose } from "../src/lib/line-login";
import { lineDeliveryPayloadEnvelopePurpose } from "../src/lib/line-notification";
import { luckyDrawClaimEnvelopePurpose } from "../src/lib/live-interaction";
import { livePrivateChatBodyEnvelopePurpose } from "../src/lib/live-private-chat-storage";
import { orderItemDeliverySnapshotEnvelopePurpose, productDeliveryConfigEnvelopePurpose } from "../src/lib/product-delivery";
import { REGISTRATION_FORM_RETRY_ENVELOPE_PURPOSE } from "../src/lib/registration-form-retry";
import { SUPPORT_CASE_CONTENT_KINDS, supportCaseContentEnvelopePurpose } from "../src/lib/support-case-pii";
import { commerceOrderInvoiceEnvelopePurpose } from "../src/lib/taiwan-invoice-request";
import { trackingBrowserContextEnvelopePurpose } from "../src/lib/tracking-browser-context";
import { facebookAccessTokenEnvelopePurpose } from "../src/lib/tracking-credentials";

export type EnvelopeRow = Readonly<Record<string, string | number | null>>;

export type EnvelopeTarget = Readonly<{
  table: string;
  column: string;
  /** Primary key used for the cursor and the compare-and-swap (default "id"). */
  idColumn?: string;
  /** Same-table columns the binding needs. */
  fields: readonly string[];
  /** One joined row (on its "id"); its fields appear as "<table>.<field>". */
  join?: Readonly<{ table: string; localColumn: string; fields: readonly string[] }>;
  /** Column a test or targeted run may restrict to (vendorId or userId). */
  scopeColumn: "vendorId" | "userId";
  /** "mfa" uses src/lib/mfa.ts (its own legacy formats); default "envelope". */
  codec?: "envelope" | "mfa";
  /** Every purpose the row may have been encrypted with. */
  purposes?: (row: EnvelopeRow) => readonly string[];
}>;

const text = (row: EnvelopeRow, field: string) => {
  const value = row[field];
  if (value === null || value === undefined) throw new Error("Envelope binding is incomplete.");
  return String(value);
};

function lineCredential(column: string, field: Parameters<typeof lineOfficialAccountCredentialEnvelopePurpose>[1]): EnvelopeTarget {
  return {
    table: "LineOfficialAccount", column, fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [lineOfficialAccountCredentialEnvelopePurpose(text(row, "vendorId"), field)],
  };
}

function lineProfile(column: string, field: Parameters<typeof lineProfileEnvelopePurpose>[1]): EnvelopeTarget {
  return {
    table: "LineUserIdentity", column, fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [lineProfileEnvelopePurpose(text(row, "vendorId"), field)],
  };
}

function productDeliveryConfig(column: string, field: "destination" | "instructions"): EnvelopeTarget {
  return {
    table: "ProductDeliveryConfig", column, fields: ["vendorId", "productId", "revision"], scopeColumn: "vendorId",
    purposes: (row) => [productDeliveryConfigEnvelopePurpose({
      vendorId: text(row, "vendorId"), productId: text(row, "productId"), configId: text(row, "id"), revision: Number(row.revision),
    }, field)],
  };
}

function orderItemDeliverySnapshot(column: string, field: "destination" | "instructions"): EnvelopeTarget {
  return {
    table: "CommerceOrderItemDeliverySnapshot", column, fields: ["vendorId", "orderId", "orderItemId"], scopeColumn: "vendorId",
    purposes: (row) => [orderItemDeliverySnapshotEnvelopePurpose({
      vendorId: text(row, "vendorId"), orderId: text(row, "orderId"), orderItemId: text(row, "orderItemId"), snapshotId: text(row, "id"),
    }, field)],
  };
}

export const ENVELOPE_TARGETS: readonly EnvelopeTarget[] = Object.freeze([
  { table: "UserMfaFactor", column: "secretEncrypted", fields: [], scopeColumn: "userId", codec: "mfa" },
  {
    table: "TrackingSetting", column: "facebookAccessTokenEncrypted", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [facebookAccessTokenEnvelopePurpose(text(row, "vendorId"))],
  },
  {
    // The source id depends on the event (src/lib/tracking-event-payload.ts).
    table: "TrackingDelivery", column: "contextEncrypted",
    fields: ["vendorId", "orderId", "submissionId", "analyticsEventId", "bookingId"], scopeColumn: "vendorId",
    purposes: (row) => ["orderId", "submissionId", "analyticsEventId", "bookingId"]
      .filter((field) => row[field] !== null && row[field] !== undefined)
      .map((field) => trackingBrowserContextEnvelopePurpose(text(row, "vendorId"), text(row, field))),
  },
  {
    table: "CommerceOrder", column: "trackingContextEncrypted", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [trackingBrowserContextEnvelopePurpose(text(row, "vendorId"), text(row, "id"))],
  },
  {
    table: "CommerceOrder", column: "buyerEncryptedEnvelope", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [commerceOrderPiiEnvelopePurpose("buyer", { vendorId: text(row, "vendorId"), orderId: text(row, "id") })],
  },
  {
    table: "CommerceOrder", column: "shippingEncryptedEnvelope", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [commerceOrderPiiEnvelopePurpose("shipping", { vendorId: text(row, "vendorId"), orderId: text(row, "id") })],
  },
  {
    table: "CommerceOrder", column: "invoiceRequestEncryptedEnvelope", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [commerceOrderInvoiceEnvelopePurpose(text(row, "vendorId"), text(row, "id"))],
  },
  {
    // A copy of the order's invoice request, still bound to the order.
    table: "ElectronicInvoice", column: "requestEncryptedEnvelope", fields: ["vendorId", "orderId"], scopeColumn: "vendorId",
    purposes: (row) => [commerceOrderInvoiceEnvelopePurpose(text(row, "vendorId"), text(row, "orderId"))],
  },
  {
    table: "CommerceOrderItem", column: "customCheckoutAnswersEncryptedEnvelope", fields: ["vendorId", "orderId"], scopeColumn: "vendorId",
    purposes: (row) => [customCheckoutAnswersEnvelopePurpose({
      vendorId: text(row, "vendorId"), orderId: text(row, "orderId"), orderItemId: text(row, "id"),
    })],
  },
  {
    table: "CommerceEntitlement", column: "accessEncryptedEnvelope", fields: ["vendorId", "orderItemId"], scopeColumn: "vendorId",
    purposes: (row) => [commerceEntitlementAccessEnvelopePurpose({
      vendorId: text(row, "vendorId"), entitlementId: text(row, "id"), orderItemId: text(row, "orderItemId"),
    })],
  },
  productDeliveryConfig("destinationEncryptedEnvelope", "destination"),
  productDeliveryConfig("instructionsEncryptedEnvelope", "instructions"),
  orderItemDeliverySnapshot("destinationEncryptedEnvelope", "destination"),
  orderItemDeliverySnapshot("instructionsEncryptedEnvelope", "instructions"),
  {
    table: "EmailDelivery", column: "payloadEncryptedEnvelope", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [emailDeliveryPayloadEnvelopePurpose({ vendorId: text(row, "vendorId"), deliveryId: text(row, "id") })],
  },
  {
    table: "RegistrationFormRetryDraft", column: "encryptedPayload", idColumn: "idHash", fields: [], scopeColumn: "vendorId",
    purposes: () => [REGISTRATION_FORM_RETRY_ENVELOPE_PURPOSE],
  },
  lineCredential("messagingChannelIdEncrypted", "messagingChannelId"),
  lineCredential("messagingChannelSecretEncrypted", "messagingChannelSecret"),
  lineCredential("messagingAccessTokenEncrypted", "messagingAccessToken"),
  lineCredential("loginChannelIdEncrypted", "loginChannelId"),
  lineCredential("loginChannelSecretEncrypted", "loginChannelSecret"),
  lineProfile("lineUserIdEncrypted", "userId"),
  lineProfile("displayNameEncrypted", "displayName"),
  lineProfile("pictureUrlEncrypted", "pictureUrl"),
  {
    table: "LineLoginState", column: "codeVerifierEncrypted", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [lineLoginVerifierEnvelopePurpose(text(row, "vendorId"), text(row, "id"))],
  },
  {
    table: "LineDelivery", column: "payloadEncrypted", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [lineDeliveryPayloadEnvelopePurpose(text(row, "vendorId"), text(row, "id"))],
  },
  {
    table: "LivePrivateChatMessage", column: "bodyEncrypted", fields: ["vendorId", "liveId", "formSubmissionId", "source"], scopeColumn: "vendorId",
    purposes: (row) => [livePrivateChatBodyEnvelopePurpose({
      vendorId: text(row, "vendorId"), liveId: text(row, "liveId"), submissionId: text(row, "formSubmissionId"),
      messageId: text(row, "id"), source: text(row, "source") as "viewer" | "instructor",
    })],
  },
  {
    // The content kind follows the event type; every kind is a candidate.
    table: "SupportCaseEvent", column: "payloadEncryptedEnvelope", fields: ["vendorId", "supportCaseId"], scopeColumn: "vendorId",
    purposes: (row) => SUPPORT_CASE_CONTENT_KINDS.map((kind) => supportCaseContentEnvelopePurpose({
      vendorId: text(row, "vendorId"), supportCaseId: text(row, "supportCaseId"), recordId: text(row, "id"), kind,
    })),
  },
  {
    table: "SupportRefundHandoff", column: "reasonEncryptedEnvelope", fields: ["vendorId", "supportCaseId"], scopeColumn: "vendorId",
    purposes: (row) => [supportCaseContentEnvelopePurpose({
      vendorId: text(row, "vendorId"), supportCaseId: text(row, "supportCaseId"), recordId: text(row, "id"), kind: "refund_reason",
    })],
  },
  {
    table: "LiveInteractionResponse", column: "winnerClaimCodeEncryptedEnvelope", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [luckyDrawClaimEnvelopePurpose(text(row, "vendorId"), text(row, "id"))],
  },
  {
    table: "LearnerNotificationPreference", column: "destinationEncryptedEnvelope",
    fields: ["vendorId", "productId", "customerKeyHash", "channel"], scopeColumn: "vendorId",
    purposes: (row) => [learnerNotificationDestinationEnvelopePurpose({
      vendorId: text(row, "vendorId"), productId: text(row, "productId"), customerKeyHash: text(row, "customerKeyHash"),
    }, LearnerNotificationChannel.parse(text(row, "channel")))],
  },
  {
    table: "LearnerNotificationDelivery", column: "payloadEncryptedEnvelope", fields: ["vendorId", "deduplicationKey"], scopeColumn: "vendorId",
    purposes: (row) => [learnerNotificationPayloadEnvelopePurpose(text(row, "vendorId"), text(row, "deduplicationKey"))],
  },
  {
    table: "LearnerNotificationDelivery", column: "providerReceiptEncryptedEnvelope", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [learnerNotificationReceiptEnvelopePurpose(text(row, "vendorId"), text(row, "id"))],
  },
  {
    // Bound to the preference's recipient and channel (learner-verification-delivery.ts).
    table: "LearnerNotificationVerification", column: "destinationEncryptedEnvelope", fields: ["vendorId", "productId"],
    join: { table: "LearnerNotificationPreference", localColumn: "preferenceId", fields: ["customerKeyHash", "channel"] },
    scopeColumn: "vendorId",
    purposes: (row) => [learnerNotificationDestinationEnvelopePurpose({
      vendorId: text(row, "vendorId"), productId: text(row, "productId"),
      customerKeyHash: text(row, "LearnerNotificationPreference.customerKeyHash"),
    }, LearnerNotificationChannel.parse(text(row, "LearnerNotificationPreference.channel")))],
  },
  {
    table: "LearnerNotificationVerification", column: "deliveryTokenEncryptedEnvelope", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [learnerContactProofEnvelopePurpose(text(row, "vendorId"), text(row, "id"))],
  },
  {
    table: "LearnerNotificationVerification", column: "deliveryReceiptEncryptedEnvelope", fields: ["vendorId"], scopeColumn: "vendorId",
    purposes: (row) => [learnerContactReceiptEnvelopePurpose(text(row, "vendorId"), text(row, "id"))],
  },
  {
    table: "LearnerNotificationSourceEvent", column: "payloadEncryptedEnvelope", fields: ["vendorId", "productId", "event", "eventIdentity"],
    scopeColumn: "vendorId",
    purposes: (row) => [learnerNotificationSourceEnvelopePurpose({
      vendorId: text(row, "vendorId"), productId: text(row, "productId"),
      event: text(row, "event") as Parameters<typeof learnerNotificationSourceEnvelopePurpose>[0]["event"],
      eventIdentity: text(row, "eventIdentity"),
    })],
  },
  {
    table: "Video", column: "liveStreamKey", fields: [], scopeColumn: "vendorId",
    purposes: () => [CLOUDFLARE_STREAM_KEY_PURPOSE],
  },
] satisfies EnvelopeTarget[]);

/**
 * Encrypted-looking columns that are not sensitive-data envelopes. Bank and
 * tax data use BANK_ACCOUNT_KEYRING_JSON (src/lib/bank-account.ts), which
 * already has key ids and its own rotation.
 */
export const EXCLUDED_ENCRYPTED_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  "PayoutItem.bankAccountEncrypted": "BANK_ACCOUNT_KEYRING_JSON",
  "PaymentAccount.bankAccountEncrypted": "BANK_ACCOUNT_KEYRING_JSON",
  "AffiliatePayeeProfile.bankEncrypted": "BANK_ACCOUNT_KEYRING_JSON",
  "AffiliatePayeeProfile.taxIdentityEncrypted": "BANK_ACCOUNT_KEYRING_JSON",
  "AffiliateRemunerationSnapshot.bankEncrypted": "BANK_ACCOUNT_KEYRING_JSON",
  "AffiliateRemunerationSnapshot.taxIdentityEncrypted": "BANK_ACCOUNT_KEYRING_JSON",
  "ServiceFulfillment.serviceEncryptedEnvelope": "never written with a value (always null in src/lib/commerce-orders.ts)",
});

/**
 * Every encryptSensitiveValue／encryptWithRotation call in src/, keyed by
 * "<file under src/> <purpose argument>" (whitespace collapsed), and where
 * its envelope ends up. scripts/sensitive-data-envelope-targets.test.ts scans
 * the source: a new call must be added here, and every target above must be
 * written by at least one listed call. Envelopes that never reach the
 * database (cookies, tickets) name their lifetime instead; they move to the
 * active kid on their own and lapse when a kid is removed.
 */
export const ENVELOPE_WRITERS: Readonly<Record<string, { targets: readonly string[] } | { notStored: string }>> = Object.freeze({
  "app/actions/interaction-actions.ts luckyDrawClaimEnvelopePurpose(vendor.id, winner.id)": { targets: ["LiveInteractionResponse.winnerClaimCodeEncryptedEnvelope"] },
  "lib/cloudflare-ops.ts CLOUDFLARE_UPLOAD_TICKET_KEY": { notStored: "Cloudflare 續傳 ticket，回給瀏覽器，7 天" },
  "lib/cloudflare-ops.ts CLOUDFLARE_STREAM_KEY_PURPOSE": { targets: ["Video.liveStreamKey"] },
  "lib/commerce-custom-checkout.ts purpose(binding)": { targets: ["CommerceOrderItem.customCheckoutAnswersEncryptedEnvelope"] },
  "lib/commerce-entitlement-access.ts purpose(safe)": { targets: ["CommerceEntitlement.accessEncryptedEnvelope"] },
  "lib/commerce-order-pii.ts envelopePurpose(BUYER_ENVELOPE_PURPOSE, safeBinding)": { targets: ["CommerceOrder.buyerEncryptedEnvelope"] },
  "lib/commerce-order-pii.ts envelopePurpose(SHIPPING_ENVELOPE_PURPOSE, safeBinding)": { targets: ["CommerceOrder.shippingEncryptedEnvelope"] },
  "lib/email-delivery-pii.ts recipientPurpose(binding)": { targets: ["EmailDelivery.payloadEncryptedEnvelope"] },
  "lib/learner-notification-contract.ts binding": {
    targets: ["LearnerNotificationPreference.destinationEncryptedEnvelope", "LearnerNotificationVerification.destinationEncryptedEnvelope"],
  },
  "lib/learner-notification-outbox.ts payloadPurpose(scope.vendorId,key)": { targets: ["LearnerNotificationDelivery.payloadEncryptedEnvelope"] },
  "lib/learner-notification-outbox.ts receiptPurpose(input.vendorId, input.id)": { targets: ["LearnerNotificationDelivery.providerReceiptEncryptedEnvelope"] },
  "lib/learner-notification-source-events.ts purpose(input)": { targets: ["LearnerNotificationSourceEvent.payloadEncryptedEnvelope"] },
  "lib/learner-notification-verification.ts learnerContactProofEnvelopePurpose(scope.vendorId,challengeId)": {
    targets: ["LearnerNotificationVerification.deliveryTokenEncryptedEnvelope"],
  },
  "lib/learner-verification-delivery.ts receiptPurpose(input.vendorId,input.id)": { targets: ["LearnerNotificationVerification.deliveryReceiptEncryptedEnvelope"] },
  "lib/line-credentials.ts credentialPurpose(vendorId, \"messagingChannelId\")": { targets: ["LineOfficialAccount.messagingChannelIdEncrypted"] },
  "lib/line-credentials.ts credentialPurpose(vendorId, \"messagingChannelSecret\")": { targets: ["LineOfficialAccount.messagingChannelSecretEncrypted"] },
  "lib/line-credentials.ts credentialPurpose(vendorId, \"messagingAccessToken\")": { targets: ["LineOfficialAccount.messagingAccessTokenEncrypted"] },
  "lib/line-credentials.ts credentialPurpose(vendorId, \"loginChannelId\")": { targets: ["LineOfficialAccount.loginChannelIdEncrypted"] },
  "lib/line-credentials.ts credentialPurpose(vendorId, \"loginChannelSecret\")": { targets: ["LineOfficialAccount.loginChannelSecretEncrypted"] },
  "lib/line-credentials.ts lineProfileEnvelopePurpose(vendorId, field)": {
    targets: ["LineUserIdentity.lineUserIdEncrypted", "LineUserIdentity.displayNameEncrypted", "LineUserIdentity.pictureUrlEncrypted"],
  },
  "lib/line-login.ts verifierPurpose(input.vendorId, stateId)": { targets: ["LineLoginState.codeVerifierEncrypted"] },
  "lib/line-notification.ts deliveryPurpose(input.vendorId, id)": { targets: ["LineDelivery.payloadEncrypted"] },
  "lib/live-private-chat-storage.ts purpose(scope)": { targets: ["LivePrivateChatMessage.bodyEncrypted"] },
  // Also the 15-minute MFA setup and recovery-code cookies.
  "lib/mfa.ts MFA_ENCRYPTION_KEY.current": { targets: ["UserMfaFactor.secretEncrypted"] },
  "lib/product-delivery.ts configPurpose(binding, \"destination\")": { targets: ["ProductDeliveryConfig.destinationEncryptedEnvelope"] },
  "lib/product-delivery.ts configPurpose(binding, \"instructions\")": { targets: ["ProductDeliveryConfig.instructionsEncryptedEnvelope"] },
  "lib/product-delivery.ts snapshotPurpose(binding, \"destination\")": { targets: ["CommerceOrderItemDeliverySnapshot.destinationEncryptedEnvelope"] },
  "lib/product-delivery.ts snapshotPurpose(binding, \"instructions\")": { targets: ["CommerceOrderItemDeliverySnapshot.instructionsEncryptedEnvelope"] },
  "lib/registration-form-retry.ts PURPOSE": { targets: ["RegistrationFormRetryDraft.encryptedPayload"] },
  "lib/registration-submission-receipt.ts PURPOSE": { notStored: "報名結果 cookie，1 分鐘" },
  "lib/student-portal-auth.ts SESSION_KEY": { notStored: "學員入口 session cookie，30 天" },
  "lib/support-case-pii.ts purpose(binding)": { targets: ["SupportCaseEvent.payloadEncryptedEnvelope", "SupportRefundHandoff.reasonEncryptedEnvelope"] },
  // The order keeps the request; the electronic invoice row copies it unchanged.
  "lib/taiwan-invoice-request.ts purpose(vendorId, orderId)": {
    targets: ["CommerceOrder.invoiceRequestEncryptedEnvelope", "ElectronicInvoice.requestEncryptedEnvelope"],
  },
  "lib/tracking-browser-context.ts purpose(vendorId, sourceId)": { targets: ["TrackingDelivery.contextEncrypted", "CommerceOrder.trackingContextEncrypted"] },
  "lib/tracking-credentials.ts purpose(vendorId)": { targets: ["TrackingSetting.facebookAccessTokenEncrypted"] },
});

export function envelopeTargetLabel(target: Pick<EnvelopeTarget, "table" | "column">) {
  return `${target.table}.${target.column}`;
}
