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

import { AUTOMATION_RECIPES, AUTOMATION_TRIGGERS, automationConditionMatches, automationCustomerKeyHash, dispatchAutomationEvent, dispatchFormNoShowAutomationsForLive, dispatchPaymentPaidAutomationByOrder, dryRunAutomationRule, maskAutomationTarget, materializeAutomationRecipe, parseAutomationRule } from "@/lib/automation-workflow";

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
    expect(AUTOMATION_RECIPES).toHaveLength(4);
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
