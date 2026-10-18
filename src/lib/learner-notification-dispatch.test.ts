import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ finish: vi.fn() }));
vi.mock("./learner-notification-outbox", async original => ({ ...await original<typeof import("./learner-notification-outbox")>(), finishLearnerNotification: mocks.finish }));
import { dispatchClaimedLearnerNotification } from "./learner-notification-dispatch";
import { protectLearnerNotificationDestination } from "./learner-notification-contract";
import { encryptSensitiveValue } from "./sensitive-data";

const vendorId = "vendor_a", id = "delivery_a", claimToken = "c".repeat(43), dedup = "d".repeat(64);
const scope = { vendorId, productId: "course_a", customerKeyHash: "a".repeat(43) };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const message = { paymentOrder: { id: "order_a" }, title: "付款已完成", body: "合成課程", path: "/portal/notify.link/vendor_a/notifications" };
const options = { appOrigin: "https://app.example.test", configuration: {} };

function fixture(overrides: { event?: string; orderCurrent?: boolean; enabled?: boolean } = {}) {
  const row = { id, vendorId, productId: scope.productId, preferenceId: "pref_a", event: overrides.event ?? "payment_success", consentRevision: 2, deduplicationKey: dedup, dispatchedAt: null,
    payloadEncryptedEnvelope: encryptSensitiveValue(JSON.stringify(message), `learner-notification-payload-v1:${JSON.stringify([vendorId, dedup])}`) };
  const preference = { id: "pref_a", ...scope, channel: "email", enabled: overrides.enabled ?? true, revision: 2, consentedAt: new Date(), destinationVerifiedAt: new Date(),
    destinationKeyHash: "f".repeat(64), destinationEncryptedEnvelope: protectLearnerNotificationDestination(scope, "email", { email: "learner@invalid.example" }).encryptedEnvelope };
  const sql: string[] = [];
  let inTransaction = false;
  const tx = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(0),
    $queryRaw: vi.fn(async (query: TemplateStringsArray | { strings: readonly string[] }) => {
      const text = ("strings" in query ? query.strings : query).join("?"); sql.push(text);
      if (text.includes('"LearnerNotificationDelivery"')) return [{ id }];
      if (text.includes('FROM "CommerceOrder" o') && text.includes("EXISTS")) return overrides.orderCurrent === false ? [] : [{ id: "order_a" }];
      if (text.includes('"CommerceEntitlement"')) return [{ id: "entitlement_a" }];
      return [];
    }),
    learnerNotificationDelivery: { findFirstOrThrow: vi.fn().mockResolvedValue(row), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    learnerNotificationPreference: { findFirstOrThrow: vi.fn().mockResolvedValue(preference) },
  };
  const db = { $transaction: vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => { inTransaction = true; try { return await run(tx); } finally { inTransaction = false; } }) };
  return { tx, db, sql, row, inside: () => inTransaction };
}
beforeEach(() => { vi.stubEnv("CSRF_SECRET", "synthetic-dispatch-encryption-key-32-bytes"); mocks.finish.mockReset().mockResolvedValue(true); });
afterEach(() => vi.unstubAllEnvs());

it("calls the provider outside any transaction and never locks commerce, live or consultation rows", async () => {
  const f = fixture(); let sentInside: boolean | null = null;
  const sender = vi.fn(async () => { sentInside = f.inside(); return { outcome: "sent" as const, providerReceipt: "synthetic-receipt" }; });
  expect(await dispatchClaimedLearnerNotification(f.db as never, { vendorId, id, claimToken }, { ...options, sender })).toEqual({ status: "sent", providerAttempted: true });
  expect(sender).toHaveBeenCalledTimes(1); expect(sentInside).toBe(false);
  expect(f.tx.$executeRawUnsafe).toHaveBeenCalledWith("SET LOCAL lock_timeout = '2s'");
  const locking = f.sql.filter(text => /FOR (UPDATE|NO KEY UPDATE|SHARE)/u.test(text));
  expect(locking).toHaveLength(1); expect(locking[0]).toMatch(/FOR UPDATE OF d$/u);
  for (const table of ["CommerceOrder", "CommerceEntitlement", "Live", "SalesProject", "ConsultationEvent", "LearnerNotificationPreference"]) expect(locking[0]).not.toContain(`"${table}"`);
});

it("rotates the claim to a single-use send token before the provider call and records only with that token", async () => {
  const f = fixture();
  await dispatchClaimedLearnerNotification(f.db as never, { vendorId, id, claimToken }, { ...options, sender: async () => ({ outcome: "sent" as const }) });
  const rotation = f.tx.learnerNotificationDelivery.updateMany.mock.calls[0]![0];
  expect(rotation.where).toEqual({ vendorId, id, status: "processing", claimTokenHash: hash(claimToken) });
  const finish = mocks.finish.mock.calls[0]![1];
  expect(finish).toMatchObject({ vendorId, id, outcome: "sent" });
  expect(finish.claimToken).toMatch(/^[A-Za-z0-9_-]{43}$/u); expect(finish.claimToken).not.toBe(claimToken);
  expect(rotation.data.claimTokenHash).toBe(hash(finish.claimToken));
});

it("suppresses a refunded payment notification without a provider call", async () => {
  const f = fixture({ orderCurrent: false }); const sender = vi.fn();
  expect(await dispatchClaimedLearnerNotification(f.db as never, { vendorId, id, claimToken }, { ...options, sender })).toEqual({ status: "suppressed" });
  expect(sender).not.toHaveBeenCalled();
  expect(f.tx.learnerNotificationDelivery.updateMany).toHaveBeenCalledWith({ where: { vendorId, id, status: "processing", claimTokenHash: hash(claimToken) }, data: expect.objectContaining({ status: "suppressed", lastErrorCode: "AUTHORIZATION_REVOKED" }) });
});

it("a pre-send failure (e.g. lock timeout) never calls the provider and returns the original claim to the retry schedule", async () => {
  const f = fixture(); f.db.$transaction.mockRejectedValueOnce(Object.assign(new Error("canceling statement due to lock timeout"), { code: "P2010" })); const sender = vi.fn();
  expect(await dispatchClaimedLearnerNotification(f.db as never, { vendorId, id, claimToken }, { ...options, sender })).toEqual({ status: "not_delivered", providerAttempted: false });
  expect(sender).not.toHaveBeenCalled();
  expect(mocks.finish).toHaveBeenCalledWith(f.db, { vendorId, id, claimToken, outcome: "not_delivered" });
});

it("a provider exception is terminal indeterminate, never retried", async () => {
  const f = fixture(); const sender = vi.fn(async () => { throw new Error("private provider failure"); });
  expect(await dispatchClaimedLearnerNotification(f.db as never, { vendorId, id, claimToken }, { ...options, sender })).toEqual({ status: "indeterminate", providerAttempted: true });
  expect(sender).toHaveBeenCalledTimes(1); expect(mocks.finish.mock.calls[0]![1]).toMatchObject({ outcome: "indeterminate" });
});

it("a failed outcome commit settles the send token as indeterminate without a second provider call", async () => {
  const f = fixture(); const sender = vi.fn(async () => ({ outcome: "sent" as const, providerReceipt: "synthetic-receipt" }));
  mocks.finish.mockRejectedValueOnce(new Error("commit failed")).mockResolvedValueOnce(true);
  expect(await dispatchClaimedLearnerNotification(f.db as never, { vendorId, id, claimToken }, { ...options, sender })).toEqual({ status: "indeterminate", providerAttempted: true });
  expect(sender).toHaveBeenCalledTimes(1);
  expect(mocks.finish.mock.calls[1]![1]).toMatchObject({ outcome: "indeterminate", providerReceipt: "synthetic-receipt" });
  expect(mocks.finish.mock.calls[1]![1].claimToken).toBe(mocks.finish.mock.calls[0]![1].claimToken);
});

it("a forged or replayed claim token is not claimed and never reaches the provider", async () => {
  const f = fixture(); f.tx.$queryRaw.mockResolvedValueOnce([]); const sender = vi.fn();
  expect(await dispatchClaimedLearnerNotification(f.db as never, { vendorId, id, claimToken }, { ...options, sender })).toEqual({ status: "not_claimed" });
  expect(sender).not.toHaveBeenCalled(); expect(mocks.finish).not.toHaveBeenCalled();
});
