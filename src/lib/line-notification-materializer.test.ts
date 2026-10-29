import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  enqueue: vi.fn(),
  db: {
    lineUserIdentity: { findMany: vi.fn(), update: vi.fn() },
    formSubmission: { findFirst: vi.fn() },
    commerceOrder: { findFirst: vi.fn() },
    affiliateCommission: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ getDb: () => runtime.db }));
vi.mock("@/lib/line-notification", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/line-notification")>();
  return { ...original, enqueueLineNotification: runtime.enqueue };
});

import { materializeLineNotifications } from "@/lib/line-notification-materializer";

describe("LINE automatic notification materializer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://celebratedeal.example");
    runtime.enqueue.mockResolvedValue({ status: "queued", deliveryId: "delivery-1" });
    runtime.db.lineUserIdentity.findMany.mockResolvedValue([
      { id: "identity-registration", vendorId: "vendor-1", subjectType: "buyer_registration", subjectId: "submission-1" },
      { id: "identity-order", vendorId: "vendor-1", subjectType: "buyer_order", subjectId: "order-1" },
      { id: "identity-promoter", vendorId: "vendor-1", subjectType: "promoter", subjectId: "affiliate-1" },
    ]);
    runtime.db.formSubmission.findFirst.mockResolvedValue({
      id: "submission-1",
      live: {
        id: "live-1",
        slug: "ai-live",
        title: "AI 實戰",
        status: "live",
        scheduledAt: new Date("2026-09-05T12:00:00Z"),
        startedAt: new Date("2026-09-05T12:00:00Z"),
        endedAt: null,
      },
    });
    runtime.db.commerceOrder.findFirst.mockResolvedValue({
      id: "order-1",
      orderNumber: "CD-001",
      totalAmountCents: 100_000,
      currency: "TWD",
      status: "paid",
      paidAt: new Date("2026-09-05T11:00:00Z"),
      createdAt: new Date("2026-09-05T10:00:00Z"),
    });
    runtime.db.affiliateCommission.findMany.mockResolvedValue([{
      id: "commission-1",
      commissionAmountCents: 10_000,
      currency: "TWD",
      orderNumber: "CD-001",
      createdAt: new Date("2026-09-05T11:00:00Z"),
    }]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("materializes live start, order creation/payment receipt, and commission credit", async () => {
    const result = await materializeLineNotifications(new Date("2026-09-05T12:01:00Z"));
    expect(result).toHaveLength(4);
    expect(runtime.enqueue.mock.calls.map(([, input]) => input.trigger)).toEqual([
      "live_started",
      "order_created",
      "order_paid",
      "commission_credited",
    ]);
    for (const [, input] of runtime.enqueue.mock.calls) {
      expect(input.idempotencyKey).toMatch(/^line:v1:[a-f0-9]{64}$/u);
    }
  });

  it("does not push scheduledAt-based reminders or start notices for an active evergreen live", async () => {
    runtime.db.lineUserIdentity.findMany.mockResolvedValue([
      { id: "identity-registration", vendorId: "vendor-1", subjectType: "buyer_registration", subjectId: "submission-1" },
    ]);
    const evergreen = {
      id: "live-1", slug: "ai-live", title: "AI 實戰", status: "scheduled",
      scheduledAt: new Date("2026-09-05T12:00:00Z"), startedAt: null, endedAt: null,
      isEvergreen: true, streamMode: "vod", evergreenScheduleMode: "just_in_time", evergreenIntervalMinutes: 15,
      evergreenDailyTimes: [], evergreenSessionStartAt: null, video: { durationSec: 1_800 },
    };
    runtime.db.formSubmission.findFirst.mockResolvedValue({ id: "submission-1", live: evergreen });
    // 30 minutes before scheduledAt: a regular live would get its reminder now.
    await expect(materializeLineNotifications(new Date("2026-09-05T11:30:00Z"))).resolves.toEqual([]);
    expect(runtime.enqueue).not.toHaveBeenCalled();
    expect(runtime.db.lineUserIdentity.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "identity-registration" } }));

    runtime.db.formSubmission.findFirst.mockResolvedValue({ id: "submission-1", live: { ...evergreen, status: "live", startedAt: new Date("2026-09-05T12:00:00Z") } });
    await expect(materializeLineNotifications(new Date("2026-09-05T12:01:00Z"))).resolves.toEqual([]);
    expect(runtime.enqueue).not.toHaveBeenCalled();

    // The same live without evergreen keeps the unchanged reminder.
    runtime.db.formSubmission.findFirst.mockResolvedValue({ id: "submission-1", live: { ...evergreen, isEvergreen: false } });
    await materializeLineNotifications(new Date("2026-09-05T11:30:00Z"));
    expect(runtime.enqueue.mock.calls.map(([, input]) => input.trigger)).toEqual(["live_reminder"]);
  });

  it("accepts an injected database handle for one cron invocation", async () => {
    const cronDb = {
      lineUserIdentity: { findMany: vi.fn().mockResolvedValue([]) },
    };

    await expect(materializeLineNotifications(cronDb as never, new Date("2026-09-05T12:01:00Z")))
      .resolves.toEqual([]);
    expect(cronDb.lineUserIdentity.findMany).toHaveBeenCalledOnce();
    expect(runtime.db.lineUserIdentity.findMany).not.toHaveBeenCalled();
  });

  it("persists a commission cursor so item 21 is reached on the next batch", async () => {
    runtime.db.lineUserIdentity.findMany.mockResolvedValue([
      { id: "identity-promoter", vendorId: "vendor-1", subjectType: "promoter", subjectId: "affiliate-1", materializationCursor: null },
    ]);
    const firstBatch = Array.from({ length: 20 }, (_, index) => ({
      id: `commission-${index + 1}`,
      commissionAmountCents: 1_000,
      currency: "TWD",
      orderNumber: null,
      createdAt: new Date(`2026-09-05T11:${String(index).padStart(2, "0")}:00Z`),
    }));
    runtime.db.affiliateCommission.findMany.mockResolvedValueOnce(firstBatch);
    await materializeLineNotifications(new Date("2026-09-05T12:00:00Z"));
    expect(runtime.db.lineUserIdentity.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ materializationCursor: "commission-20" }),
    }));

    runtime.db.lineUserIdentity.findMany.mockResolvedValue([
      { id: "identity-promoter", vendorId: "vendor-1", subjectType: "promoter", subjectId: "affiliate-1", materializationCursor: "commission-20" },
    ]);
    runtime.db.affiliateCommission.findMany.mockResolvedValueOnce([{
      id: "commission-21", commissionAmountCents: 1_000, currency: "TWD", orderNumber: null,
      createdAt: new Date("2026-09-05T11:20:00Z"),
    }]);
    await materializeLineNotifications(new Date("2026-09-05T12:01:00Z"));
    expect(runtime.db.affiliateCommission.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      cursor: { id: "commission-20" },
      skip: 1,
    }));
    expect(runtime.db.lineUserIdentity.update).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ materializationCursor: "commission-21" }),
    }));
  });
});
