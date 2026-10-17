import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { protectCommerceOrderPii } from "./commerce-order-pii";
import { revealEmailDeliveryPayload } from "./email-delivery-pii";
const monitor = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: monitor.capture }));
import { checkoutFollowupDeliveryId } from "./checkout-followup";
import { encryptSensitiveValue } from "./sensitive-data";
import { processDueCheckoutFollowups } from "./checkout-followup-queue";

const now = new Date("2026-10-16T04:00:00.000Z");
const pair = { vendorId: "vendor-1", orderId: "order-1", eventId: "event-1", ruleId: "rule-1", ruleVersion: 2 };
function database() {
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic", email: "buyer@example.test" }, shipping: null }, pair);
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: pair.eventId }]),
    commerceOrder: { findFirst: vi.fn().mockResolvedValue({ id: pair.orderId, buyerEncryptedEnvelope: pii.buyerEncrypted }) },
    commerceOrderEvent: { findUnique: vi.fn().mockResolvedValue({ eventType: "checkout_incomplete_candidate", actorType: "system", createdAt: new Date(+now - 60*60_000) }) },
    automationRule: { findFirst: vi.fn().mockResolvedValue({ createdAt: new Date(+now-2*60*60_000), updatedAt: new Date(+now-2*60*60_000), condition: { type: "order_pending_payment" }, actions: [{ type: "send_email_notification", template: "checkout_followup" }] }) },
    automationExecutionLog: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ id: "log-1" }) },
    emailDelivery: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "delivery-1" }) },
  };
  const db = {
    $queryRaw: vi.fn().mockResolvedValue([pair]),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
    automationExecutionLog: { upsert: vi.fn().mockResolvedValue({ id: "log-1" }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  return { db, tx };
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CSRF_SECRET", "wp18-owned-unit-synthetic-encryption-key-20261016"); vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test"); });
afterEach(() => vi.unstubAllEnvs());

describe("bounded delayed checkout materialization", () => {
  it("writes a guarded encrypted outbox and completion receipt in one transaction", async () => {
    const { db, tx } = database();
    await expect(processDueCheckoutFollowups(db as never, { now })).resolves.toEqual([{ status: "queued" }]);
    const data = tx.emailDelivery.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ vendorId: pair.vendorId, trigger: "checkout_followup", idempotencyKey: "wp18-checkout-v1:order-1:rule-1:2", status: "queued", nextAttemptAt: now });
    expect(revealEmailDeliveryPayload(data.payloadEncryptedEnvelope, { vendorId: pair.vendorId, deliveryId: data.id }).recipientEmail).toBe("buyer@example.test");
    expect(revealEmailDeliveryPayload(data.payloadEncryptedEnvelope, { vendorId: pair.vendorId, deliveryId: data.id }).body).toContain("https://app.example.test/unsubscribe?");
    expect(JSON.stringify(tx.emailDelivery.create.mock.calls)).not.toContain("buyer@example.test");
    expect(tx.automationExecutionLog.upsert.mock.calls[0][0].create).toMatchObject({ vendorId: pair.vendorId, eventId: pair.eventId, ruleId: pair.ruleId, status: "completed", conditionMatched: true });
    expect(db.automationExecutionLog.upsert).not.toHaveBeenCalled();
  });
  it("excludes already handled pairs before LIMIT and uses fixed maturity, retention and retry windows", async () => {
    const { db } = database(); await processDueCheckoutFollowups(db as never, { now, limit: 7 });
    const sql = db.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql.indexOf('NOT EXISTS')).toBeLessThan(sql.sql.lastIndexOf('LIMIT'));
    expect(sql.sql).toContain('"EmailDelivery"'); expect(sql.sql).toContain('"AutomationExecutionLog"');
    expect(sql.sql).toContain('r."createdAt" <= e."createdAt"');
    expect(sql.values).toContain(new Date(+now - 30*60_000).toISOString()); expect(sql.values).toContain(new Date(+now - 7*86_400_000).toISOString());
    expect(sql.values).toContain(new Date(+now-5*60_000).toISOString()); expect(sql.values.at(-1)).toBe(7);
  });
  it.each([0, -1, 101, 1.5, NaN])("rejects unbounded invocation limit %s before database access", async limit => {
    const { db } = database(); await expect(processDueCheckoutFollowups(db as never, { limit })).rejects.toThrow(); expect(db.$queryRaw).not.toHaveBeenCalled();
  });
  it("skips a source locked by another worker", async () => {
    const { db, tx } = database(); tx.$queryRaw.mockResolvedValue([]);
    await expect(processDueCheckoutFollowups(db as never, { now })).resolves.toEqual([{ status: "claimed_elsewhere" }]);
    expect(tx.emailDelivery.create).not.toHaveBeenCalled();
  });
  it.each(["completed", "skipped", "running", "failed"])("skips a terminal or recent %s claim on recheck", async status => {
    const { db, tx } = database(); tx.automationExecutionLog.findUnique.mockResolvedValue({ status, startedAt: now });
    await expect(processDueCheckoutFollowups(db as never, { now })).resolves.toEqual([{ status: "duplicate" }]); expect(tx.emailDelivery.create).not.toHaveBeenCalled();
  });
  it.each(["running", "failed"])("recovers stale %s claims with the same durable delivery reference", async status => {
    const { db, tx } = database(); tx.automationExecutionLog.findUnique.mockResolvedValue({ status, startedAt: new Date(+now-6*60_000) });
    await expect(processDueCheckoutFollowups(db as never, { now })).resolves.toEqual([{ status: "queued" }]);
    expect(tx.automationExecutionLog.upsert.mock.calls[0][0].update.status).toBe("completed");
  });
  it("does not queue when payment/rule eligibility changes after candidate selection", async () => {
    const { db, tx } = database(); tx.commerceOrder.findFirst.mockResolvedValueOnce({ id: pair.orderId, buyerEncryptedEnvelope: protectCommerceOrderPii({ buyer: { name: "Synthetic", email: "buyer@example.test" }, shipping: null }, pair).buyerEncrypted }).mockResolvedValueOnce(null);
    await expect(processDueCheckoutFollowups(db as never, { now })).resolves.toEqual([{ status: "superseded" }]); expect(tx.emailDelivery.create).not.toHaveBeenCalled();
  });
  it("records only fixed failure codes, cools down poison candidates and continues later pairs", async () => {
    const { db, tx } = database(); db.$queryRaw.mockResolvedValue([pair, { ...pair, eventId: "event-2" }]);
    tx.commerceOrder.findFirst.mockRejectedValueOnce(new Error("synthetic private source"));
    await expect(processDueCheckoutFollowups(db as never, { now })).resolves.toEqual([{ status: "failed" }, { status: "queued" }]);
    expect(JSON.stringify(db.automationExecutionLog.upsert.mock.calls)).not.toContain("private");
    expect(db.automationExecutionLog.updateMany.mock.calls[0][0].where.status).toBe("failed");
    expect(monitor.capture.mock.calls[0][0].message).toBe("Checkout follow-up materialization unavailable");
  });
  it("does not report completed when the transactional receipt write fails", async () => {
    const { db, tx } = database(); tx.automationExecutionLog.upsert.mockRejectedValue(new Error("receipt unavailable"));
    await expect(processDueCheckoutFollowups(db as never, { now })).resolves.toEqual([{ status: "failed" }]);
    expect(db.automationExecutionLog.upsert.mock.calls[0][0].create.status).toBe("failed");
    // Actual transaction rollback is verified against disposable PostgreSQL.
  });
  it("fails closed on the top-level database query without creating any rows", async () => {
    const { db } = database(); db.$queryRaw.mockRejectedValue(new Error("offline"));
    await expect(processDueCheckoutFollowups(db as never, { now })).rejects.toThrow("offline"); expect(db.$transaction).not.toHaveBeenCalled();
  });
});

it('refuses a second reminder across different rules and versions under the source lock',async()=>{
 const {db,tx}=database();tx.emailDelivery.findUnique.mockResolvedValue({id:'old-other-rule-delivery'});
 await expect(processDueCheckoutFollowups(db as never,{now})).resolves.toEqual([{status:'duplicate'}]);
 expect(tx.emailDelivery.create).not.toHaveBeenCalled();expect(tx.emailDelivery.findUnique).toHaveBeenCalledWith({where:{id:checkoutFollowupDeliveryId({vendorId:pair.vendorId,orderId:pair.orderId})},select:{id:true}});
});
it('marks a persistently superseded pair skipped instead of consuming every batch',async()=>{
 const {db,tx}=database();tx.automationRule.findFirst.mockResolvedValue(null);
 await expect(processDueCheckoutFollowups(db as never,{now})).resolves.toEqual([{status:'superseded'}]);
 expect(tx.automationExecutionLog.upsert.mock.calls[0][0].create.status).toBe('skipped');expect(tx.emailDelivery.create).not.toHaveBeenCalled();
});

it('continues later pairs and reports the fixed diagnostic if the failure receipt also fails',async()=>{
 const {db,tx}=database();db.$queryRaw.mockResolvedValue([pair,{...pair,eventId:'event-2'}]);tx.commerceOrder.findFirst.mockRejectedValueOnce(new Error('synthetic DB outage'));db.automationExecutionLog.upsert.mockRejectedValueOnce(new Error('failure ledger unavailable'));
 await expect(processDueCheckoutFollowups(db as never,{now})).resolves.toEqual([{status:'failed'},{status:'queued'}]);expect(monitor.capture).toHaveBeenCalledOnce();
});
it('permanently skips decrypted but schema-invalid buyer data without retry diagnostics',async()=>{
 const {db,tx}=database();tx.commerceOrder.findFirst.mockResolvedValue({id:pair.orderId,buyerEncryptedEnvelope:encryptSensitiveValue(JSON.stringify({name:'Synthetic'}),'commerce-order-buyer:vendor-1:order-1')});
 await expect(processDueCheckoutFollowups(db as never,{now})).resolves.toEqual([{status:'superseded'}]);expect(tx.automationExecutionLog.upsert.mock.calls[0][0].create).toMatchObject({status:'skipped',errorCode:'invalid_recipient'});expect(monitor.capture).not.toHaveBeenCalled();expect(tx.emailDelivery.create).not.toHaveBeenCalled();
});
