import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueueLineNotification: vi.fn(),
  buildAutomationLineMessage: vi.fn((input) => ({ type: "text", text: input.message })),
  stableLineIdempotencyKey: vi.fn((parts: Array<string | number>) => parts.join(":")),
  getDb: vi.fn(),
}));

vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/line-notification", () => ({
  enqueueLineNotification: mocks.enqueueLineNotification,
  buildAutomationLineMessage: mocks.buildAutomationLineMessage,
  stableLineIdempotencyKey: mocks.stableLineIdempotencyKey,
}));

import { AUTOMATION_RECIPES, AUTOMATION_TRIGGERS, automationRuleReady, automationTriggerReady, automationConditionMatches, automationCustomerKeyHash, dispatchAutomationEvent, dispatchFormNoShowAutomationsForLive, dispatchPaymentPaidAutomationByOrder, dryRunAutomationRule, maskAutomationTarget, materializeAutomationRecipe, parseAutomationRule } from "@/lib/automation-workflow";

const event = {
  vendorId: "vendor-1",
  eventId: "event-1",
  trigger: "payment_paid" as const,
  subjectType: "buyer_order" as const,
  subjectId: "order-1",
  subjectKeyHash: "customer-hash",
  orderAmountCents: 12_000,
  currency: "TWD",
};

describe("smart automation workflow engine", () => {
  it("fails closed for an unscoped watch event before querying rules", async () => {
    const db = { automationRule: { findMany: vi.fn() } };
    await expect(dispatchAutomationEvent(db as never, { ...event, trigger: "viewer_watch_progress" })).resolves.toEqual([{ ruleId: "__scope__", status: "missing_live_scope" }]);
    expect(db.automationRule.findMany).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CSRF_SECRET", "automation-workflow-test-secret-longer-than-32-bytes");
    mocks.enqueueLineNotification.mockResolvedValue({ status: "queued", deliveryId: "delivery-1" });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("validates condition/action contracts and evaluates trigger-specific thresholds", () => {
    expect(AUTOMATION_TRIGGERS).toEqual(expect.arrayContaining(["form_registered", "consultation_booked", "consultation_no_show", "form_no_show", "webinar_attended_duration_gte"]));
    expect(parseAutomationRule({ id: "rule-1", condition: { type: "order_amount_gte", amountCents: 10_000 }, actions: [] })).toBeNull();
    expect(parseAutomationRule({
      id: "rule-1",
      condition: { type: "watch_seconds_gte", seconds: 300 },
      actions: [{ type: "add_customer_tag", tag: "高互動" }],
    })).not.toBeNull();
    expect(parseAutomationRule({
      id: "rule-1",
      condition: { type: "always" },
      actions: [{ type: "issue_repurchase_voucher", productId: "p1", discountType: "percentage", discountValue: 100, expiresInDays: 7 }],
    })).toBeNull();
    expect(automationConditionMatches({ type: "order_amount_gte", amountCents: 10_000 }, event)).toBe(true);
    expect(automationConditionMatches({ type: "watch_seconds_gte", seconds: 60 }, event)).toBe(false);
  });

  it("materializes all four recipes and evaluates dry-runs without side effects", () => {
    expect(AUTOMATION_RECIPES).toHaveLength(7);
    expect(materializeAutomationRecipe("high_intent_chaser", "product-1")).toMatchObject({ trigger: "webinar_attended_duration_gte" });
    expect(materializeAutomationRecipe("vip_auto_tiering", "product-1")).toMatchObject({ condition: { amountCents: 3_000_000 } });
    expect(materializeAutomationRecipe("consultation_confirmer")).toMatchObject({ trigger: "consultation_booked" });
    expect(materializeAutomationRecipe("no_show_reactivation")).toMatchObject({ trigger: "form_no_show" });
    expect(dryRunAutomationRule({ condition: { type: "watch_seconds_gte_and_not_purchased", seconds: 1_800 }, actions: [{ type: "add_customer_tag", tag: "高意向" }] }, { ...event, trigger: "webinar_attended_duration_gte", watchSecondsTotal: 1_800, hasPurchased: false })).toMatchObject({ status: "would_dispatch", conditionMatched: true });
    expect(maskAutomationTarget("customer@example.com")).toBe("c***@example.com");
    expect(maskAutomationTarget("abcdefgh12345678")).toBe("abcd…5678");
    expect(automationCustomerKeyHash("vendor-1", " Buyer@Example.com ")).toBe(automationCustomerKeyHash("vendor-1", "buyer@example.com"));
    expect(automationCustomerKeyHash("vendor-2", "buyer@example.com")).not.toBe(automationCustomerKeyHash("vendor-1", "buyer@example.com"));
  });

  it("keeps vendor-wide rules for every event and admits a scoped rule only for its trusted funnel page", async () => {
    const db = { automationRule: { findMany: vi.fn().mockResolvedValue([]) } };

    await dispatchAutomationEvent(db as never, { ...event, trigger: "form_registered", subjectType: "buyer_registration", subjectId: "registration-1" });
    expect(db.automationRule.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ funnelPageId: null }] }),
    }));

    await dispatchAutomationEvent(db as never, { ...event, trigger: "form_registered", subjectType: "buyer_registration", subjectId: "registration-1", funnelPageId: "page-1" });
    expect(db.automationRule.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [{ funnelPageId: null }, { funnelPageId: "page-1" }] }),
    }));
  });

  it("runs tag, voucher and LINE actions once and keeps bearer values out of logs", async () => {
    const update = vi.fn().mockResolvedValue({});
    const db = {
      automationRule: { findMany: vi.fn().mockResolvedValue([{
        id: "rule-1",
        createdAt: new Date(),
        condition: { type: "order_amount_gte", amountCents: 10_000 },
        actions: [
          { type: "add_customer_tag", tag: "VIP" },
          { type: "issue_repurchase_voucher", productId: "product-1", discountType: "fixed", discountValue: 1_000, expiresInDays: 7 },
          { type: "line_push", message: "謝謝購買，優惠券：{{voucher_url}}", buttonLabel: "立即使用", buttonUrl: "{{voucher_url}}" },
        ],
      }]) },
      automationExecutionLog: { create: vi.fn().mockResolvedValue({ id: "log-1" }), update },
      customerTagAssignment: { upsert: vi.fn().mockResolvedValue({}) },
      automationVoucherGrant: { create: vi.fn().mockResolvedValue({}) },
      product: { findFirst: vi.fn().mockResolvedValue({ id: "product-1", currency: "TWD" }) },
      lineOfficialAccount: {}, lineUserIdentity: {}, lineDelivery: {},
    };

    await expect(dispatchAutomationEvent(db as never, event)).resolves.toEqual([{ ruleId: "rule-1", status: "completed" }]);
    expect(db.customerTagAssignment.upsert).toHaveBeenCalledTimes(1);
    expect(db.automationVoucherGrant.create).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueLineNotification).toHaveBeenCalledWith(db, expect.objectContaining({ trigger: "automation" }));
    const completion = update.mock.calls.at(-1)?.[0].data;
    expect(completion.status).toBe("completed");
    expect(JSON.stringify(completion)).not.toContain("token=");
  });

  it("queues an encrypted email action without writing recipient PII to execution logs", async () => {
    const update = vi.fn().mockResolvedValue({});
    const db = {
      automationRule: { findMany: vi.fn().mockResolvedValue([{ id: "rule-email", condition: { type: "always" }, actions: [{ type: "send_email_notification", template: "webinar_replay" }] }]) },
      automationExecutionLog: { create: vi.fn().mockResolvedValue({ id: "log-email" }), update },
      emailDelivery: { create: vi.fn().mockResolvedValue({ id: "email-1" }) },
      customerTagAssignment: {}, automationVoucherGrant: {}, product: {}, lineOfficialAccount: {}, lineUserIdentity: {}, lineDelivery: {},
    };
    const emailEvent = { ...event, trigger: "form_no_show" as const, recipientEmail: "buyer@example.test", webinarUrl: "https://app.example.test/replay", consultationUrl: "https://app.example.test/book" };
    await expect(dispatchAutomationEvent(db as never, emailEvent)).resolves.toEqual([{ ruleId: "rule-email", status: "completed" }]);
    const delivery = db.emailDelivery.create.mock.calls[0]?.[0].data;
    expect(delivery.recipientMaskedEmail).toBe("b***@example.test");
    expect(JSON.stringify(delivery)).not.toContain("buyer@example.test");
    expect(JSON.stringify(update.mock.calls.at(-1)?.[0].data)).not.toContain("buyer@example.test");
  });

  it("dispatches no-show only for verified registrants without attendance evidence", async () => {
    const db = {
      live: { findFirst: vi.fn().mockResolvedValue({ id: "live-1", slug: "launch" }) },
      formSubmission: { findMany: vi.fn().mockResolvedValueOnce([{ id: "registration-1", email: "absent@example.test" }, { id: "registration-2", email: "attended@example.test" }]) },
      automationExecutionLog: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "watch-log" }) },
      automationRule: { findMany: vi.fn().mockResolvedValue([]) },
      commerceOrder: {}, emailDelivery: {}, customerTagAssignment: {}, automationVoucherGrant: {}, product: {}, lineOfficialAccount: {}, lineUserIdentity: {}, lineDelivery: {},
    };
    await expect(dispatchFormNoShowAutomationsForLive(db as never, { vendorId: "vendor-1", liveId: "live-1" })).resolves.toEqual({ dispatched: 1 });
    expect(db.automationExecutionLog.findFirst).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ liveId: "live-1", subjectKeyHash: expect.any(String) }),
    }));
    expect(db.automationRule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", trigger: "form_no_show" }) }));
  });

  it("uses the execution log unique key as a strict replay guard", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: Prisma.prismaVersion.client,
    });
    const db = {
      automationRule: { findMany: vi.fn().mockResolvedValue([{
        id: "rule-1", createdAt: new Date(), condition: { type: "always" },
        actions: [{ type: "add_customer_tag", tag: "VIP" }],
      }]) },
      automationExecutionLog: {
        create: vi.fn().mockRejectedValue(conflict),
        findUnique: vi.fn().mockResolvedValue({ id: "log-1", status: "completed", startedAt: new Date() }),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      customerTagAssignment: { upsert: vi.fn() },
      automationVoucherGrant: {}, product: {}, lineOfficialAccount: {}, lineUserIdentity: {}, lineDelivery: {},
    };
    await expect(dispatchAutomationEvent(db as never, event)).resolves.toEqual([{ ruleId: "rule-1", status: "duplicate" }]);
    expect(db.customerTagAssignment.upsert).not.toHaveBeenCalled();
  });

  it("deduplicates different provider event ids for the same paid order", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: Prisma.prismaVersion.client,
    });
    const db = {
      automationRule: { findMany: vi.fn().mockResolvedValue([{
        id: "rule-1", version: 1, createdAt: new Date(), condition: { type: "always" },
        actions: [{ type: "add_customer_tag", tag: "buyer" }],
      }]) },
      automationExecutionLog: {
        create: vi.fn().mockResolvedValueOnce({ id: "log-1" }).mockRejectedValueOnce(conflict),
        findUnique: vi.fn().mockResolvedValue({ id: "log-1", status: "completed", startedAt: new Date() }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn(),
      },
      customerTagAssignment: { upsert: vi.fn().mockResolvedValue({}) },
      automationVoucherGrant: {}, product: {}, lineOfficialAccount: {}, lineUserIdentity: {}, lineDelivery: {},
    };

    await expect(dispatchAutomationEvent(db as never, event))
      .resolves.toEqual([{ ruleId: "rule-1", status: "completed" }]);
    await expect(dispatchAutomationEvent(db as never, { ...event, eventId: "provider-event-2" }))
      .resolves.toEqual([{ ruleId: "rule-1", status: "duplicate" }]);

    const firstKey = db.automationExecutionLog.create.mock.calls[0]?.[0].data.idempotencyKey;
    const secondKey = db.automationExecutionLog.create.mock.calls[1]?.[0].data.idempotencyKey;
    expect(firstKey).toBe(secondKey);
    expect(db.customerTagAssignment.upsert).toHaveBeenCalledTimes(1);
  });

  it("runs a watch-threshold rule only once for the same viewer across heartbeat event IDs", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: Prisma.prismaVersion.client,
    });
    const db = {
      automationRule: { findMany: vi.fn().mockResolvedValue([{
        id: "rule-watch", version: 3, createdAt: new Date(), condition: { type: "watch_seconds_gte", seconds: 60 },
        actions: [{ type: "add_customer_tag", tag: "看播滿一分鐘" }],
      }]) },
      automationExecutionLog: {
        create: vi.fn().mockResolvedValueOnce({ id: "log-watch" }).mockRejectedValueOnce(conflict),
        findUnique: vi.fn().mockResolvedValue({ id: "log-watch", status: "completed", startedAt: new Date() }),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn(),
      },
      customerTagAssignment: { upsert: vi.fn().mockResolvedValue({}) },
      automationVoucherGrant: {}, product: {}, lineOfficialAccount: {}, lineUserIdentity: {}, lineDelivery: {},
    };
    const watchEvent = {
      ...event,
      eventId: "heartbeat-1",
      liveId: "live-a",
      trigger: "viewer_watch_progress" as const,
      subjectType: "buyer_registration" as const,
      subjectId: "registration-1",
      watchSecondsTotal: 60,
    };

    await expect(dispatchAutomationEvent(db as never, watchEvent)).resolves.toEqual([{ ruleId: "rule-watch", status: "completed" }]);
    await expect(dispatchAutomationEvent(db as never, { ...watchEvent, eventId: "heartbeat-2", watchSecondsTotal: 90 }))
      .resolves.toEqual([{ ruleId: "rule-watch", status: "duplicate" }]);
    expect(db.customerTagAssignment.upsert).toHaveBeenCalledTimes(1);
  });

  it("reclaims a failed execution and safely resumes after a voucher was already issued", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: Prisma.prismaVersion.client,
    });
    const update = vi.fn().mockResolvedValue({});
    const db = {
      automationRule: { findMany: vi.fn().mockResolvedValue([{
        id: "rule-1", version: 1, createdAt: new Date(), condition: { type: "always" },
        actions: [
          { type: "issue_repurchase_voucher", productId: "product-1", discountType: "fixed", discountValue: 1_000, expiresInDays: 7 },
          { type: "line_push", message: "使用 {{voucher_url}}", buttonLabel: "立即使用", buttonUrl: "{{voucher_url}}" },
        ],
      }]) },
      automationExecutionLog: {
        create: vi.fn()
          .mockResolvedValueOnce({ id: "log-1" })
          .mockRejectedValueOnce(conflict),
        findUnique: vi.fn().mockResolvedValue({ id: "log-1", status: "failed", startedAt: new Date() }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update,
      },
      automationVoucherGrant: { create: vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(conflict) },
      product: { findFirst: vi.fn().mockResolvedValue({ id: "product-1", currency: "TWD" }) },
      customerTagAssignment: {}, lineOfficialAccount: {}, lineUserIdentity: {}, lineDelivery: {},
    };
    mocks.enqueueLineNotification.mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce({ status: "queued" });

    await expect(dispatchAutomationEvent(db as never, event)).resolves.toEqual([{ ruleId: "rule-1", status: "failed" }]);
    await expect(dispatchAutomationEvent(db as never, event)).resolves.toEqual([{ ruleId: "rule-1", status: "completed" }]);
    expect(db.automationVoucherGrant.create).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueLineNotification).toHaveBeenCalledTimes(2);
    expect(mocks.enqueueLineNotification.mock.calls[1]?.[1].messages[0].text).toContain("token=");
    expect(update.mock.calls.at(-1)?.[0].data.status).toBe("completed");
  });

  it("reuses the LINE outbox key when a watch execution is reclaimed by a later heartbeat", async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError("duplicate", {
      code: "P2002",
      clientVersion: Prisma.prismaVersion.client,
    });
    const deliveryKeys = new Set<string>();
    mocks.enqueueLineNotification.mockImplementation(async (_db, input) => {
      const duplicate = deliveryKeys.has(input.idempotencyKey);
      deliveryKeys.add(input.idempotencyKey);
      return { status: duplicate ? "duplicate" : "queued" };
    });
    const db = {
      automationRule: { findMany: vi.fn().mockResolvedValue([{
        id: "rule-watch", version: 1, createdAt: new Date(), condition: { type: "watch_seconds_gte", seconds: 60 },
        actions: [{ type: "line_push", message: "感謝觀看" }],
      }]) },
      automationExecutionLog: {
        create: vi.fn().mockResolvedValueOnce({ id: "log-watch" }).mockRejectedValueOnce(conflict),
        findUnique: vi.fn().mockResolvedValue({ id: "log-watch", status: "failed", startedAt: new Date() }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn()
          .mockRejectedValueOnce(new Error("completion write failed"))
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({}),
      },
      automationVoucherGrant: {}, product: {}, customerTagAssignment: {},
      lineOfficialAccount: {}, lineUserIdentity: {}, lineDelivery: {},
    };
    const firstHeartbeat = {
      ...event,
      eventId: "heartbeat-1",
      liveId: "live-a",
      trigger: "viewer_watch_progress" as const,
      subjectType: "buyer_registration" as const,
      subjectId: "registration-1",
      watchSecondsTotal: 60,
    };

    await expect(dispatchAutomationEvent(db as never, firstHeartbeat)).resolves.toEqual([{ ruleId: "rule-watch", status: "failed" }]);
    await expect(dispatchAutomationEvent(db as never, { ...firstHeartbeat, eventId: "heartbeat-2" }))
      .resolves.toEqual([{ ruleId: "rule-watch", status: "completed" }]);
    expect(mocks.enqueueLineNotification).toHaveBeenCalledTimes(2);
    expect(deliveryKeys).toHaveLength(1);
    expect(mocks.enqueueLineNotification.mock.calls[0]?.[1].idempotencyKey)
      .toBe(mocks.enqueueLineNotification.mock.calls[1]?.[1].idempotencyKey);
  });

  it("recovers a committed payment by an unambiguous provider order", async () => {
    const db = {
      paymentTransaction: { findMany: vi.fn().mockResolvedValue([{ id: "transaction-1", vendorId: "vendor-1" }]) },
      commerceOrder: { findFirst: vi.fn().mockResolvedValue({
        id: "order-1", totalAmountCents: 12_000, currency: "TWD", checkoutIdentityHash: "customer-hash",
      }) },
      automationRule: { findMany: vi.fn().mockResolvedValue([]) },
    };
    mocks.getDb.mockReturnValue(db);
    await expect(dispatchPaymentPaidAutomationByOrder({
      webhookEventId: "webhook-1",
      providerName: "payuni",
      orderNumber: "CD-1",
    })).resolves.toEqual([]);
    expect(db.paymentTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2 }));
  });
});

describe('WP18 follow-up draft recipes',()=>{
 it.each(['followup_no_show','followup_completed_no_order','followup_checkout_incomplete'])('materializes %s inactive without a product or incentive',id=>{
  const recipe=materializeAutomationRecipe(id);expect(recipe).not.toBeNull();expect(recipe?.isActive).toBe(false);
  expect(recipe?.actions).toHaveLength(1);expect(recipe?.actions[0].type).toBe('send_email_notification');
 });
 it('keeps existing recipes active and their identities intact',()=>{
  for(const id of ['high_intent_chaser','consultation_confirmer','vip_auto_tiering','no_show_reactivation']){
   expect(AUTOMATION_RECIPES.some(r=>r.id===id)).toBe(true);
   expect(materializeAutomationRecipe(id,'product-1')?.isActive).toBe(true);expect(automationRuleReady(materializeAutomationRecipe(id,'product-1')!)).toBe(true);
  }
 });
 it('requires actual completion and explicitly no order; duration or no payment is not enough',()=>{
  const recipe=materializeAutomationRecipe('followup_completed_no_order')!;
  const completed={...event,trigger:'viewer_completed' as const,subjectType:'buyer_registration' as const,liveId:'live-1',watchCompleted:true,hasOrdered:false};
  expect(automationConditionMatches(recipe.condition,completed)).toBe(true);
  for(const variant of [{...completed,watchCompleted:false},{...completed,watchCompleted:undefined,watchSecondsTotal:99999},{...completed,hasOrdered:true,hasPurchased:false},{...completed,hasOrdered:undefined},{...completed,liveId:undefined},{...completed,trigger:'viewer_watch_progress' as const}]){
   expect(automationConditionMatches(recipe.condition,variant)).toBe(false);
  }
 });
 it('requires a still pending order and excludes paid/cancelled/refunded/unknown states',()=>{
  const recipe=materializeAutomationRecipe('followup_checkout_incomplete')!;
  expect(automationConditionMatches(recipe.condition,{...event,trigger:'checkout_incomplete',orderStatus:'pending_payment'})).toBe(true);
  for(const orderStatus of ['paid','cancelled','refunded','failed',undefined])expect(automationConditionMatches(recipe.condition,{...event,trigger:'checkout_incomplete',orderStatus})).toBe(false);
  expect(automationConditionMatches(recipe.condition,{...event,trigger:'checkout_incomplete',orderStatus:'pending_payment',subjectType:'buyer_registration'})).toBe(false);
 });
 it.each(['viewer_completed','checkout_incomplete'] as const)('blocks %s before reading rules or creating any outbox',async trigger=>{
  const db={automationRule:{findMany:vi.fn()},emailDelivery:{create:vi.fn()},automationExecutionLog:{create:vi.fn()}};
  expect(automationTriggerReady(trigger)).toBe(true);
  await expect(dispatchAutomationEvent(db as never,{...event,trigger})).resolves.toEqual([{ruleId:'__scope__',status:'trusted_source_required'}]);
  expect(db.automationRule.findMany).not.toHaveBeenCalled();expect(db.emailDelivery.create).not.toHaveBeenCalled();expect(db.automationExecutionLog.create).not.toHaveBeenCalled();
  expect(dryRunAutomationRule({condition:{type:'always'},actions:[{type:'add_customer_tag',tag:'x'}]},{...event,trigger}).status).toBe('trigger_not_ready');
 });
});

it.each(['checkout_followup','completed_followup'])('does not send a stored %s email even when paired with an active payment trigger',async template=>{
 const rule={id:'mismatched',condition:{type:'always'},actions:[{type:'send_email_notification',template}]};
 const db={automationRule:{findMany:vi.fn().mockResolvedValue([rule])},automationExecutionLog:{create:vi.fn()},emailDelivery:{create:vi.fn()}};
 expect(automationRuleReady({trigger:'payment_paid',...rule})).toBe(false);
 await expect(dispatchAutomationEvent(db as never,event)).resolves.toEqual([{ruleId:'mismatched',status:'trigger_not_ready'}]);
 expect(db.automationExecutionLog.create).not.toHaveBeenCalled();expect(db.emailDelivery.create).not.toHaveBeenCalled();
 expect(dryRunAutomationRule(rule,event).status).toBe('trigger_not_ready');
});
it.each(['completed_and_not_ordered','order_pending_payment'])('does not mark mismatched %s condition ready on an existing trigger',type=>{
 expect(automationRuleReady({trigger:'form_no_show',condition:{type},actions:[{type:'add_customer_tag',tag:'test'}]})).toBe(false);
});

describe('WP18 producer-only readiness',()=>{
 it.each(['followup_completed_no_order','followup_checkout_incomplete'])('allows exact %s configuration, never alternate conditions/actions/scopes',id=>{
  const recipe=materializeAutomationRecipe(id)!;expect(automationRuleReady(recipe)).toBe(true);
  for(const variant of [{...recipe,condition:{type:'always'}},{...recipe,actions:[{type:'add_customer_tag',tag:'x'}]},{...recipe,actions:[...recipe.actions,{type:'line_push',message:'x'}]},{...recipe,funnelPageId:'page-1'}])expect(automationRuleReady(variant)).toBe(false);
  const dry=dryRunAutomationRule(recipe,{...event,trigger:recipe.trigger,watchCompleted:true,hasOrdered:false,orderStatus:'pending_payment',liveId:'live-1'});
  expect(dry).toEqual({status:'trusted_source_required',conditionMatched:false,actionTypes:[]});
 });
 it.each(['viewer_completed','checkout_incomplete'] as const)('ignores forged source booleans for %s without touching DB or outbox',async trigger=>{
  const db={automationRule:{findMany:vi.fn()},emailDelivery:{create:vi.fn()},automationExecutionLog:{create:vi.fn()}};
  await expect(dispatchAutomationEvent(db as never,{...event,trigger,watchCompleted:true,hasOrdered:false,orderStatus:'pending_payment',liveId:'live-1'})).resolves.toEqual([{ruleId:'__scope__',status:'trusted_source_required'}]);
  expect(db.automationRule.findMany).not.toHaveBeenCalled();expect(db.emailDelivery.create).not.toHaveBeenCalled();expect(db.automationExecutionLog.create).not.toHaveBeenCalled();
 });
});

it('records missing opt-out configuration as retryable failure, then queues once after configuration returns',async()=>{
 vi.stubEnv('CSRF_SECRET','wp18-owned-no-show-unsubscribe-fixture-key-20261016');vi.stubEnv('NEXT_PUBLIC_APP_URL','');
 try{
 const recipe=materializeAutomationRecipe('followup_no_show')!;
 const db={automationRule:{findMany:vi.fn().mockResolvedValue([{id:'no-show-rule',version:1,condition:recipe.condition,actions:recipe.actions}])},automationExecutionLog:{create:vi.fn().mockResolvedValue({id:'no-show-log'}),update:vi.fn(),findUnique:vi.fn().mockResolvedValue({id:'no-show-log',status:'failed'}),updateMany:vi.fn().mockResolvedValue({count:1})},emailDelivery:{create:vi.fn()}};
 const input={...event,trigger:'form_no_show' as const,subjectType:'buyer_registration' as const,subjectId:'synthetic-submission',recipientEmail:'no-show@example.test',webinarUrl:'https://app.example.test/live/synthetic'};
 await expect(dispatchAutomationEvent(db as never,input)).resolves.toEqual([{ruleId:'no-show-rule',status:'failed'}]);
 expect(db.emailDelivery.create).not.toHaveBeenCalled();
 expect(db.automationExecutionLog.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'failed',errorCode:'action_failed'})}));
 vi.stubEnv('NEXT_PUBLIC_APP_URL','https://app.example.test');
 db.automationExecutionLog.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Synthetic existing execution',{code:'P2002',clientVersion:'test'}));
 await expect(dispatchAutomationEvent(db as never,input)).resolves.toEqual([{ruleId:'no-show-rule',status:'completed'}]);
 expect(db.emailDelivery.create).toHaveBeenCalledTimes(1);
 }finally{vi.unstubAllEnvs()}
});

it('adds a signed unsubscribe link to the new no-show recipe without persisting plaintext recipient',async()=>{
 vi.stubEnv('CSRF_SECRET','wp18-owned-no-show-unsubscribe-fixture-key-20261016');vi.stubEnv('NEXT_PUBLIC_APP_URL','https://app.example.test');
 try{
 const recipe=materializeAutomationRecipe('followup_no_show')!;
 const db={automationRule:{findMany:vi.fn().mockResolvedValue([{id:'no-show-rule',version:1,condition:recipe.condition,actions:recipe.actions}])},automationExecutionLog:{create:vi.fn().mockResolvedValue({id:'no-show-log'}),update:vi.fn()},emailDelivery:{create:vi.fn()}};
 await expect(dispatchAutomationEvent(db as never,{...event,trigger:'form_no_show',subjectType:'buyer_registration',subjectId:'synthetic-submission',recipientEmail:'no-show@example.test',webinarUrl:'https://app.example.test/live/synthetic'})).resolves.toEqual([{ruleId:'no-show-rule',status:'completed'}]);
 const data=db.emailDelivery.create.mock.calls[0][0].data;
 const {revealEmailDeliveryPayload,verifyEmailUnsubscribeToken}=await import('@/lib/email-delivery-pii');
 const payload=revealEmailDeliveryPayload(data.payloadEncryptedEnvelope,{vendorId:event.vendorId,deliveryId:data.id});const link=payload.body.match(/取消訂閱：(\S+)/u)?.[1];if(!link)throw new Error('Signed unsubscribe link missing');
 expect(verifyEmailUnsubscribeToken(new URL(link).searchParams.get('token')??'')).toBe(data.id);expect(JSON.stringify(data).includes('no-show@example.test')).toBe(false);
 }finally{vi.unstubAllEnvs()}
});
