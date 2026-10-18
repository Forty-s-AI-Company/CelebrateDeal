import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rights: vi.fn() }));
vi.mock("./learner-notification-access", () => ({ hasLearnerNotificationPurchase: mocks.rights }));
import { LEARNER_VERIFICATION_DAILY_LIMITS, requestLearnerContactVerification } from "./learner-notification-verification";
import { LEARNER_PHONE_ALLOWED_COUNTRY_CODES, isAllowedLearnerPhoneDestination, learnerNotificationDestinationRateKey } from "./learner-notification-contract";

const session = { vendorId: "vendor_a", customerKeyHash: "a".repeat(43) };
function fixture(counts: { learner?: number; destination?: number } = {}) {
  const tx = {
    learnerNotificationPreference: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "pref_a", channel: "sms", enabled: false, revision: 1, destinationVerifiedAt: null }), update: vi.fn() },
    learnerNotificationVerification: {
      findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => "destinationRateKeyHash" in where ? counts.destination ?? 0 : counts.learner ?? 0),
      create: vi.fn(async ({ data }: { data: { id: string; expiresAt: Date } }) => ({ id: data.id, expiresAt: data.expiresAt })),
    },
  };
  const db = { $transaction: vi.fn(async (run: (value: typeof tx) => unknown) => run(tx)) };
  return { tx, db };
}
beforeEach(() => { vi.stubEnv("CSRF_SECRET", "synthetic-verification-encryption-key-32b"); mocks.rights.mockReset().mockResolvedValue(true); });
afterEach(() => vi.unstubAllEnvs());

it("never returns the plaintext token or destination to the caller", async () => {
  const f = fixture();
  const result = await requestLearnerContactVerification(f.db as never, session, "course_a", { channel: "sms", destination: { phone: "+886912345678" }, expectedRevision: 0 });
  expect(result.status).toBe("challenge_created");
  expect(Object.keys(result).sort()).toEqual(["challenge", "preference", "status"]);
  expect(JSON.stringify(result)).not.toContain("+886912345678");
  const created = f.tx.learnerNotificationVerification.create.mock.calls[0]![0].data as unknown as Record<string, string>;
  expect(created.destinationRateKeyHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(JSON.stringify(created)).not.toContain("+886912345678");
});

it.each(["sms", "whatsapp"] as const)("%s enrollment outside the +886 allowlist is refused before any database work", async channel => {
  expect(LEARNER_PHONE_ALLOWED_COUNTRY_CODES).toEqual(["+886"]);
  const f = fixture();
  expect(await requestLearnerContactVerification(f.db as never, session, "course_a", { channel, destination: { phone: "+15005550006" }, expectedRevision: 0 })).toEqual({ status: "destination_unsupported" });
  expect(f.db.$transaction).not.toHaveBeenCalled();
  expect(isAllowedLearnerPhoneDestination("+886912345678")).toBe(true);
  expect(isAllowedLearnerPhoneDestination("+8869")).toBe(false);
});

it("email and push are not subject to the phone allowlist", async () => {
  const f = fixture();
  expect((await requestLearnerContactVerification(f.db as never, session, "course_a", { channel: "email", destination: { email: "learner@invalid.example" }, expectedRevision: 0 })).status).toBe("challenge_created");
});

it("caps verification sends per learner across products and channels within 24 hours", async () => {
  const f = fixture({ learner: LEARNER_VERIFICATION_DAILY_LIMITS.learner });
  expect(await requestLearnerContactVerification(f.db as never, session, "course_a", { channel: "email", destination: { email: "learner@invalid.example" }, expectedRevision: 0 })).toEqual({ status: "daily_limit_reached" });
  const where = f.tx.learnerNotificationVerification.count.mock.calls[0]![0].where as { createdAt: { gt: Date } };
  expect(where).toEqual({ vendorId: "vendor_a", createdAt: { gt: expect.any(Date) }, preference: { is: { vendorId: "vendor_a", customerKeyHash: session.customerKeyHash } } });
  expect(Date.now() - where.createdAt.gt.getTime()).toBeGreaterThanOrEqual(LEARNER_VERIFICATION_DAILY_LIMITS.windowMs - 1000);
  expect(f.tx.learnerNotificationPreference.create).not.toHaveBeenCalled();
  expect(f.tx.learnerNotificationVerification.create).not.toHaveBeenCalled();
});

it("caps verification sends per destination within the tenant", async () => {
  const f = fixture({ learner: 0, destination: LEARNER_VERIFICATION_DAILY_LIMITS.destination });
  expect(await requestLearnerContactVerification(f.db as never, session, "course_a", { channel: "sms", destination: { phone: "+886912345678" }, expectedRevision: 0 })).toEqual({ status: "daily_limit_reached" });
  const where = f.tx.learnerNotificationVerification.count.mock.calls[1]![0].where;
  expect(where).toEqual({ vendorId: "vendor_a", destinationRateKeyHash: learnerNotificationDestinationRateKey("vendor_a", "sms", { phone: "+886912345678" }), createdAt: { gt: expect.any(Date) } });
  expect(f.tx.learnerNotificationVerification.create).not.toHaveBeenCalled();
  expect(LEARNER_VERIFICATION_DAILY_LIMITS).toMatchObject({ learner: 5, destination: 3 });
});

it("the destination rate key is shared by SMS/WhatsApp, independent of learner/product, and tenant scoped", () => {
  const phone = { phone: "+886912345678" };
  expect(learnerNotificationDestinationRateKey("vendor_a", "sms", phone)).toBe(learnerNotificationDestinationRateKey("vendor_a", "whatsapp", phone));
  expect(learnerNotificationDestinationRateKey("vendor_a", "sms", phone)).not.toBe(learnerNotificationDestinationRateKey("vendor_b", "sms", phone));
  expect(learnerNotificationDestinationRateKey("vendor_a", "email", { email: "A@Invalid.Example" })).toBe(learnerNotificationDestinationRateKey("vendor_a", "email", { email: "a@invalid.example" }));
});
