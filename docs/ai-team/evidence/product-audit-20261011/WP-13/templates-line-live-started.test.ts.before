import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  process: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock("@/lib/line-notification", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/line-notification")>()),
  enqueueLineNotification: mocks.enqueue,
  processDueLineDeliveries: mocks.process,
}));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));

import {
  dispatchLiveStartedLineNotifications,
  dispatchLiveStartedLineNotificationsSafely,
} from "@/lib/line-live-started";

describe("live-started LINE dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://celebratedeal.example");
    mocks.enqueue
      .mockResolvedValueOnce({ status: "queued", deliveryId: "delivery-1" })
      .mockResolvedValueOnce({ status: "duplicate", deliveryId: "delivery-2" });
    mocks.process.mockResolvedValue([
      { id: "delivery-1", status: "sent" },
      { id: "delivery-2", status: "claimed_elsewhere" },
    ]);
  });

  it("uses tenant-scoped registrations, stable per-viewer keys, and a scoped eager worker", async () => {
    const startedAt = new Date("2026-09-07T12:00:00.000Z");
    const db = {
      live: { findFirst: vi.fn().mockResolvedValue({ id: "live-1", slug: "safe-live", title: "安全直播", startedAt }) },
      formSubmission: { findMany: vi.fn().mockResolvedValue([{ id: "submission-1" }, { id: "submission-2" }]) },
    };

    await expect(dispatchLiveStartedLineNotifications(db as never, {
      vendorId: "vendor-1",
      liveId: "live-1",
      startedAt,
    })).resolves.toEqual({ queued: 2, sent: 1, failed: 0 });

    expect(db.live.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "live-1", vendorId: "vendor-1", status: "live", startedAt, endedAt: null },
    }));
    expect(db.formSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { liveId: "live-1", verificationStatus: "VERIFIED", form: { vendorId: "vendor-1" } },
    }));
    expect(mocks.enqueue).toHaveBeenNthCalledWith(1, db, expect.objectContaining({
      vendorId: "vendor-1",
      subjectType: "buyer_registration",
      subjectId: "submission-1",
      trigger: "live_started",
      idempotencyKey: expect.stringMatching(/^line:v1:[a-f0-9]{64}$/u),
    }));
    expect(mocks.enqueue.mock.calls[0]?.[1].idempotencyKey).not.toBe(mocks.enqueue.mock.calls[1]?.[1].idempotencyKey);
    expect(mocks.process).toHaveBeenCalledWith(db, undefined, startedAt, {
      vendorId: "vendor-1",
      deliveryIds: ["delivery-1", "delivery-2"],
    });
  });

  it("keeps the committed live transition successful when eager LINE delivery fails", async () => {
    const startedAt = new Date("2026-09-07T12:00:00.000Z");
    const providerFailure = new Error("temporary provider failure");
    const db = {
      live: { findFirst: vi.fn().mockRejectedValue(providerFailure) },
      formSubmission: { findMany: vi.fn() },
    };

    await expect(dispatchLiveStartedLineNotificationsSafely(db as never, "vendor-1", {
      id: "live-1",
      liveStartedAt: startedAt,
    })).resolves.toBeUndefined();

    expect(mocks.captureOperationalError).toHaveBeenCalledWith(providerFailure, {
      source: "line_notification",
      operation: "live_started_dispatch",
      status: "failed",
    });
  });
});
