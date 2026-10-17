import { encryptSensitiveValue } from "./sensitive-data";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const monitoring = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: monitoring.capture }));
import { checkoutFollowupDeliveryKey, isCurrentCheckoutFollowupDelivery,
  recordCheckoutFollowupCandidate, tryRecordCheckoutFollowupCandidate } from "./checkout-followup";

import { protectCommerceOrderPii } from "./commerce-order-pii";
import { createEmailRecipientHash } from "./email-delivery-pii";
const scope = { vendorId: "vendor-1", orderId: "order-1" };
const ref = { orderId: "order-1", ruleId: "rule-1", ruleVersion: 2 };
const event = { id: "event-1", eventType: "checkout_incomplete_candidate", actorType: "system", createdAt: new Date(Date.now()-60*60_000) };
const rule = { createdAt: new Date(Date.now()-2*60*60_000), updatedAt: new Date(Date.now()-2*60*60_000), condition: { type: "order_pending_payment" },
  actions: [{ type: "send_email_notification", template: "checkout_followup" }] };
function database() {
  const pii=protectCommerceOrderPii({buyer:{name:"Synthetic",email:"buyer@example.test"},shipping:null},{vendorId:scope.vendorId,orderId:scope.orderId});
  return { commerceOrder: { findFirst: vi.fn().mockResolvedValue({ id: scope.orderId, buyerEncryptedEnvelope:pii.buyerEncrypted }) },
    commerceOrderEvent: { upsert: vi.fn().mockResolvedValue(event), findUnique: vi.fn().mockResolvedValue(event) },
    automationRule: { findFirst: vi.fn().mockResolvedValue(rule) } };
}
function delivery() { return { vendorId: scope.vendorId, trigger: "checkout_followup", idempotencyKey: checkoutFollowupDeliveryKey(ref), recipientHash:createEmailRecipientHash("buyer@example.test",scope.vendorId) }; }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CSRF_SECRET","wp18-unit-synthetic-encryption-key-20261016"); });
afterEach(()=>vi.unstubAllEnvs());

describe("checkout follow-up candidate", () => {
  it("records only server-confirmed unpaid orders with one stable event identity and no PII", async () => {
    const db = database();
    await expect(recordCheckoutFollowupCandidate(db as never, scope)).resolves.toEqual({ status: "recorded", eventId: "event-1" });
    expect(db.commerceOrder.findFirst).toHaveBeenCalledWith({ where: {
      vendorId: scope.vendorId, id: scope.orderId,
      status: "pending_payment", paidAt: null, paidAmountCents: 0, refundedAmountCents: 0, totalAmountCents: { gt: 0 },
      primaryPaymentTransaction: { is: { vendorId: scope.vendorId, status: "pending" } },
    }, select: { id: true } });
    expect(db.commerceOrderEvent.upsert).toHaveBeenCalledWith({
      where: { vendorId_orderId_dedupKey: { ...scope, dedupKey: "checkout-followup-candidate:v1" } },
      create: { ...scope, dedupKey: "checkout-followup-candidate:v1", eventType: "checkout_incomplete_candidate", actorType: "system", sanitizedData: { version: 1 } },
      update: {}, select: { id: true, eventType: true, actorType: true },
    });
  });
  it("does not append facts for a paid/failed/cancelled, missing or cross-tenant candidate", async () => {
    const db = database(); db.commerceOrder.findFirst.mockResolvedValue(null);
    await expect(recordCheckoutFollowupCandidate(db as never, scope)).resolves.toEqual({ status: "not_eligible" });
    expect(db.commerceOrderEvent.upsert).not.toHaveBeenCalled();
  });
  it("does not silently reuse a conflicting source fact", async () => {
    const db = database(); db.commerceOrderEvent.upsert.mockResolvedValue({ ...event, eventType: "other" });
    await expect(recordCheckoutFollowupCandidate(db as never, scope)).rejects.toThrow("event mismatch");
  });
  it("does not change checkout success or leak raw errors when recording/monitoring fails", async () => {
    const db = database(); db.commerceOrder.findFirst.mockRejectedValue(new Error("private provider details"));
    await expect(tryRecordCheckoutFollowupCandidate(db as never, scope)).resolves.toEqual({ status: "failed" });
    expect(monitoring.capture.mock.calls[0][0].message).toBe("Checkout follow-up event unavailable");
    monitoring.capture.mockImplementationOnce(() => { throw new Error("monitor unavailable"); });
    await expect(tryRecordCheckoutFollowupCandidate(db as never, scope)).resolves.toEqual({ status: "failed" });
  });
});

describe("checkout follow-up send-time guard", () => {
  it("rechecks order/payment, original candidate, active rule and exact version within the same tenant", async () => {
    const db = database(); await expect(isCurrentCheckoutFollowupDelivery(delivery(), db as never)).resolves.toBe(true);
    expect(db.commerceOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: scope.orderId, vendorId: scope.vendorId, status: "pending_payment", paidAmountCents: 0 }) }));
    expect(db.automationRule.findFirst).toHaveBeenCalledWith({ where: { id: ref.ruleId, vendorId: scope.vendorId, version: 2, trigger: "checkout_incomplete", isActive: true, funnelPageId: null }, select: { condition: true, actions: true, createdAt: true, updatedAt: true } });
  });
  it.each(["order", "event", "rule"])("refuses when the current %s is no longer eligible", async missing => {
    const db = database();
    if (missing === "order") db.commerceOrder.findFirst.mockResolvedValue(null);
    if (missing === "event") db.commerceOrderEvent.findUnique.mockResolvedValue(null);
    if (missing === "rule") db.automationRule.findFirst.mockResolvedValue(null);
    await expect(isCurrentCheckoutFollowupDelivery(delivery(), db as never)).resolves.toBe(false);
  });
  it.each([
    { ...rule, condition: { type: "always" } },
    { ...rule, actions: [{ type: "send_email_notification", template: "webinar_replay" }] },
    { ...rule, actions: [...rule.actions, { type: "line_push", message: "x" }] },
  ])("refuses a changed or incompatible rule snapshot", async incompatible => {
    const db = database(); db.automationRule.findFirst.mockResolvedValue(incompatible as never);
    await expect(isCurrentCheckoutFollowupDelivery(delivery(), db as never)).resolves.toBe(false);
  });
  it.each([undefined, "", "other:order-1:rule-1:2", "wp18-checkout-v1:order-1:rule-1:02",
    "wp18-checkout-v1:order-1:rule-1:2147483648", "wp18-checkout-v1:order-1:rule-1:2:extra"])("fails closed on malformed references (%s)", async key => {
    const db = database(); await expect(isCurrentCheckoutFollowupDelivery({ ...delivery(), idempotencyKey: key }, db as never)).resolves.toBe(false);
    expect(db.commerceOrder.findFirst).not.toHaveBeenCalled();
  });
  it("preserves existing email types without requiring new database methods", async () => {
    await expect(isCurrentCheckoutFollowupDelivery({ vendorId: "vendor-1", trigger: "registration_confirmed" }, {})).resolves.toBe(true);
    await expect(isCurrentCheckoutFollowupDelivery(delivery(), {})).resolves.toBe(false);
  });
  it("propagates an unavailable database rather than sending or permanently suppressing", async () => {
    const db = database(); db.commerceOrder.findFirst.mockRejectedValue(new Error("database unavailable"));
    await expect(isCurrentCheckoutFollowupDelivery(delivery(), db as never)).rejects.toThrow("database unavailable");
  });
});

it('rejects the wrong recipient hash even when order/rule/event references are all valid',async()=>{
 const db=database();await expect(isCurrentCheckoutFollowupDelivery({...delivery(),recipientHash:createEmailRecipientHash('other@example.test',scope.vendorId)},db as never)).resolves.toBe(false);
});
it('rejects a missing recipient binding before reading the order',async()=>{
 const db=database();await expect(isCurrentCheckoutFollowupDelivery({...delivery(),recipientHash:undefined},db as never)).resolves.toBe(false);expect(db.commerceOrder.findFirst).not.toHaveBeenCalled();
});

it.each(['wrong-order','wrong-vendor','malformed','missing-email'])('rejects %s buyer envelopes without leaking or retrying corrupt snapshots',async kind=>{
 const db=database();let envelope:string;
 if(kind==='malformed')envelope='synthetic-invalid-envelope';
 else if(kind==='missing-email')envelope=encryptSensitiveValue(JSON.stringify({name:'Synthetic'}),'commerce-order-buyer:vendor-1:order-1');
 else envelope=protectCommerceOrderPii({buyer:{name:'Synthetic',email:'buyer@example.test'},shipping:null},{vendorId:kind==='wrong-vendor'?'other-vendor':scope.vendorId,orderId:kind==='wrong-order'?'other-order':scope.orderId}).buyerEncrypted;
 db.commerceOrder.findFirst.mockResolvedValue({id:scope.orderId,buyerEncryptedEnvelope:envelope});
 if(kind==='missing-email')await expect(isCurrentCheckoutFollowupDelivery(delivery(),db as never)).resolves.toBe(false);else await expect(isCurrentCheckoutFollowupDelivery(delivery(),db as never)).rejects.toThrow('Follow-up source unavailable');expect(monitoring.capture).toHaveBeenCalledOnce();expect(monitoring.capture.mock.calls[0][0].message).toBe('Checkout follow-up recipient binding unavailable');expect(monitoring.capture.mock.calls[0][0].cause).toBeUndefined();expect(JSON.stringify(monitoring.capture.mock.calls)).not.toContain(envelope);
});
it('uses the existing email transport 256-character reference limit',()=>{
 expect(checkoutFollowupDeliveryKey({orderId:'a'.repeat(128),ruleId:'b'.repeat(108),ruleVersion:1})).toHaveLength(256);
 expect(()=>checkoutFollowupDeliveryKey({orderId:'a'.repeat(128),ruleId:'b'.repeat(109),ruleVersion:1})).toThrow('transport limit');
});
it('rejects an oversized stored key before reading its source',async()=>{
 const db=database();await expect(isCurrentCheckoutFollowupDelivery({...delivery(),idempotencyKey:`wp18-checkout-v1:${'a'.repeat(128)}:${'b'.repeat(109)}:1`},db as never)).resolves.toBe(false);expect(db.commerceOrder.findFirst).not.toHaveBeenCalled();
});

it('reports only a fixed diagnostic when encryption configuration is unavailable',async()=>{
 const db=database(),value=delivery();vi.stubEnv('CSRF_SECRET','');vi.stubEnv('JOB_SECRET','');
 await expect(isCurrentCheckoutFollowupDelivery(value,db as never)).rejects.toThrow('Follow-up source unavailable');
 expect(monitoring.capture).toHaveBeenCalledWith(expect.any(Error),{source:'checkout_followup',operation:'validate_recipient',status:'rejected'});
 expect(monitoring.capture.mock.calls[0][0].message).toBe('Checkout follow-up recipient binding unavailable');expect(monitoring.capture.mock.calls[0][0].cause).toBeUndefined();
});
it('still refuses an unreadable snapshot if monitoring itself fails',async()=>{
 const db=database();db.commerceOrder.findFirst.mockResolvedValue({id:scope.orderId,buyerEncryptedEnvelope:'synthetic-invalid-envelope'});
 monitoring.capture.mockImplementationOnce(()=>{throw new Error('monitor unavailable')});
 await expect(isCurrentCheckoutFollowupDelivery(delivery(),db as never)).rejects.toThrow('Follow-up source unavailable');
});


it.each([0, 29*60_000, 7*86_400_000+1])('rejects an observation outside the delayed follow-up window (%s)',async age=>{
 const db=database();db.commerceOrderEvent.findUnique.mockResolvedValue({...event,createdAt:new Date(Date.now()-age)});
 await expect(isCurrentCheckoutFollowupDelivery(delivery(),db as never)).resolves.toBe(false);
});
it('does not retroactively target checkouts that preceded the rule',async()=>{
 const db=database();db.automationRule.findFirst.mockResolvedValue({...rule,createdAt:new Date()});
 await expect(isCurrentCheckoutFollowupDelivery(delivery(),db as never)).resolves.toBe(false);
});

it('rejects a configuration activated or edited after the checkout observation',async()=>{
 const db=database();db.automationRule.findFirst.mockResolvedValue({...rule,updatedAt:new Date()});
 await expect(isCurrentCheckoutFollowupDelivery(delivery(),db as never)).resolves.toBe(false);
});
