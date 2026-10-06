import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LearnerNotificationConsentInput, LearnerPhoneDestination, learnerNotificationDeliveryKey, mayDispatchLearnerNotification, protectLearnerNotificationDestination, revealLearnerNotificationDestination } from "./learner-notification-contract";
const scope = { vendorId: "synthetic_vendor", customerKeyHash: "a".repeat(43), productId: "synthetic_course" };
beforeEach(() => vi.stubEnv("CSRF_SECRET", "synthetic-notification-encryption-secret-32-bytes"));
afterEach(() => vi.unstubAllEnvs());
describe("tenant-qualified learner notification contracts", () => {
  it("binds encrypted destination and private lookup to recipient/course/channel", () => {
    const destination = { phone: "+886900000001" };
    const protectedValue = protectLearnerNotificationDestination(scope, "sms", destination);
    expect(protectedValue.encryptedEnvelope).not.toContain(destination.phone);
    expect(revealLearnerNotificationDestination(scope, "sms", protectedValue.encryptedEnvelope)).toEqual(destination);
    for (const other of [{ ...scope, vendorId: "foreign_vendor" }, { ...scope, customerKeyHash: "b".repeat(43) }, { ...scope, productId: "foreign_course" }]) {
      expect(() => revealLearnerNotificationDestination(other, "sms", protectedValue.encryptedEnvelope)).toThrow();
      expect(protectLearnerNotificationDestination(other, "sms", destination).destinationKeyHash).not.toBe(protectedValue.destinationKeyHash);
    }
    expect(() => revealLearnerNotificationDestination(scope, "whatsapp", protectedValue.encryptedEnvelope)).toThrow();
  });
  it("deduplicates the same event across consent changes while separating recipient,tenant,course and channel", () => {
    const key = learnerNotificationDeliveryKey(scope, "email", "lesson_published", "synthetic_event", 1);
    expect(learnerNotificationDeliveryKey(scope, "email", "lesson_published", "synthetic_event", 1)).toBe(key);
    expect(learnerNotificationDeliveryKey(scope, "sms", "lesson_published", "synthetic_event", 1)).not.toBe(key);
    expect(learnerNotificationDeliveryKey(scope, "email", "lesson_published", "synthetic_event", 2)).toBe(key);
    for (const other of [{ ...scope, vendorId: "foreign_vendor" }, { ...scope, customerKeyHash: "b".repeat(43) }, { ...scope, productId: "foreign_course" }]) expect(learnerNotificationDeliveryKey(other, "email", "lesson_published", "synthetic_event", 1)).not.toBe(key);
    expect(() => learnerNotificationDeliveryKey(scope, "email", "lesson_published", "", 1)).toThrow();
  });
  it("rejects caller-controlled tenant/resource selectors and malformed contacts", () => {
    expect(LearnerNotificationConsentInput.safeParse({ channel: "sms", enabled: true, expectedRevision: 0, vendorId: "foreign" }).success).toBe(false);
    expect(LearnerPhoneDestination.safeParse({ phone: "+886900000001" }).success).toBe(true);
    for (const phone of ["", "0900000001", "+0000000000", "+886900000001&To=other"]) expect(LearnerPhoneDestination.safeParse({ phone }).success).toBe(false);
  });
  it("suppresses revoked rights,withdrawn consent,unverified contacts and stale or repeated dispatch", () => {
    const permitted = { purchaseGranted: true, orderPaid: true, consentEnabled: true, consentRevision: 2, reservedConsentRevision: 2, destinationVerified: true, alreadyDispatched: false };
    expect(mayDispatchLearnerNotification(permitted)).toBe(true);
    for (const change of [{ purchaseGranted: false }, { orderPaid: false }, { consentEnabled: false }, { destinationVerified: false }, { alreadyDispatched: true }, { consentRevision: 3 }, { consentRevision: 0 }, { consentRevision: NaN }]) expect(mayDispatchLearnerNotification({ ...permitted, ...change })).toBe(false);
  });
});
