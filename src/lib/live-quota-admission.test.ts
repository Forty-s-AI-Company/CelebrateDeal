import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  admitLiveViewer,
  hasActiveLiveViewerSession,
  hashLiveViewerToken,
  LIVE_VIEWER_SESSION_TTL_MS,
  releaseLiveViewer,
} from "@/lib/live-quota-admission";

const tx = {
  live: { findFirst: vi.fn() },
  paymentMethodReference: { findFirst: vi.fn(), findMany: vi.fn() },
  vendorUsageLimit: { findUnique: vi.fn() },
  streamUsageLedgerEntry: { aggregate: vi.fn() },
  liveViewerSession: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
};
const deleteMany = vi.fn();
const db = {
  $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  liveViewerSession: { findUnique: vi.fn(), deleteMany },
} as unknown as PrismaClient;

const now = new Date("2026-08-07T06:00:00.000Z");
const runtimeReadyContent = {
  video: { vendorId: "vendor-1", sourceType: "url", status: "ready", cloudflareReadyToStream: false, cloudflareLiveInputUid: null, liveInputStatus: null },
  form: null,
  messageTemplate: null,
  interactionScript: null,
  products: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.live.findFirst.mockResolvedValue({
    id: "live-1",
    vendorId: "vendor-1",
    quotaPolicy: { version: 1, affiliateMode: "enabled", maxConcurrentViewers: 2, stopWhenCreditsBelow: 100 },
    ...runtimeReadyContent,
  });
  tx.paymentMethodReference.findFirst.mockResolvedValue({
    status: "verified",
    verifiedAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: null,
  });
  tx.paymentMethodReference.findMany.mockResolvedValue([]);
  tx.vendorUsageLimit.findUnique.mockResolvedValue({ creditsLimit: 1000, creditsUsed: 100 });
  tx.streamUsageLedgerEntry.aggregate.mockResolvedValue({ _sum: { watchSeconds: 0 } });
  tx.liveViewerSession.findUnique.mockResolvedValue(null);
  tx.liveViewerSession.count.mockResolvedValue(0);
  tx.liveViewerSession.create.mockResolvedValue({ id: "session-1" });
  tx.liveViewerSession.update.mockResolvedValue({ id: "session-1" });
  (db.liveViewerSession.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    vendorId: "vendor-1",
    liveId: "live-1",
    expiresAt: new Date("2026-08-07T06:01:00.000Z"),
  });
  deleteMany.mockResolvedValue({ count: 1 });
});

describe("live quota admission", () => {
  it("creates a short-lived opaque session without persisting the raw token", async () => {
    const result = await admitLiveViewer(db, { vendorId: "vendor-1", liveId: "live-1", now });

    expect(result.reused).toBe(false);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.expiresAt).toEqual(new Date(now.getTime() + LIVE_VIEWER_SESSION_TTL_MS));
    expect(tx.liveViewerSession.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        liveId: "live-1",
        tokenHash: hashLiveViewerToken(result.token),
        expiresAt: result.expiresAt,
      }),
    }));
    expect(JSON.stringify(tx.liveViewerSession.create.mock.calls)).not.toContain(result.token);
  });

  it("refreshes an existing same-live session without consuming another slot", async () => {
    const token = "A".repeat(43);
    tx.liveViewerSession.findUnique.mockResolvedValue({ id: "session-1", vendorId: "vendor-1", liveId: "live-1" });

    const result = await admitLiveViewer(db, { vendorId: "vendor-1", liveId: "live-1", token, now });

    expect(result).toMatchObject({ token, reused: true });
    expect(tx.liveViewerSession.update).toHaveBeenCalledWith({
      where: { id: "session-1" },
      data: { lastSeenAt: now, expiresAt: result.expiresAt },
    });
    expect(tx.liveViewerSession.count).not.toHaveBeenCalled();
    expect(tx.liveViewerSession.create).not.toHaveBeenCalled();
  });

  it("fails closed when all concurrent viewer slots are active", async () => {
    tx.liveViewerSession.count.mockResolvedValue(2);

    await expect(admitLiveViewer(db, { vendorId: "vendor-1", liveId: "live-1", now }))
      .rejects.toMatchObject({ code: "viewer_limit_reached" });
    expect(tx.liveViewerSession.create).not.toHaveBeenCalled();
  });

  it("fails closed when server-owned credits are below the live threshold", async () => {
    tx.vendorUsageLimit.findUnique.mockResolvedValue({ creditsLimit: 1000, creditsUsed: 950 });

    await expect(admitLiveViewer(db, { vendorId: "vendor-1", liveId: "live-1", now }))
      .rejects.toMatchObject({ code: "credits_below_threshold" });
    expect(tx.liveViewerSession.count).not.toHaveBeenCalled();
  });

  it("fails closed when the included stream-minute quota is exhausted", async () => {
    tx.vendorUsageLimit.findUnique.mockResolvedValue({
      creditsLimit: 1000,
      creditsUsed: 100,
      streamMinutesLimit: 60,
      streamMinutesUsed: 0,
      resetAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    tx.streamUsageLedgerEntry.aggregate.mockResolvedValue({ _sum: { watchSeconds: 3600 } });

    await expect(admitLiveViewer(db, { vendorId: "vendor-1", liveId: "live-1", now }))
      .rejects.toMatchObject({ code: "stream_minutes_exhausted" });
    expect(tx.liveViewerSession.count).not.toHaveBeenCalled();
  });

  it("fails closed before creating a viewer session when a configured quota lacks payment ownership", async () => {
    tx.live.findFirst.mockResolvedValue({
      id: "live-1",
      vendorId: "vendor-1",
      ...runtimeReadyContent,
      quotaPolicy: {
        quotaPayerScope: "MEMBER",
        usageAttributionMode: "CUSTOM",
        customAllocations: [{ teamId: "team-1", membershipId: "member-1", bps: 10_000 }],
      },
    });
    tx.paymentMethodReference.findMany.mockResolvedValue([]);

    await expect(admitLiveViewer(db, { vendorId: "vendor-1", liveId: "live-1", now }))
      .rejects.toMatchObject({ code: "payment_method_required" });
    expect(tx.paymentMethodReference.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ membershipId: { in: ["member-1"] } }),
    }));
    expect(tx.vendorUsageLimit.findUnique).not.toHaveBeenCalled();
    expect(tx.liveViewerSession.create).not.toHaveBeenCalled();
  });

  it("fails closed before quota work when a published sales live has stale runtime resources", async () => {
    tx.live.findFirst.mockResolvedValue({
      id: "live-1",
      vendorId: "vendor-1",
      quotaPolicy: null,
      ...runtimeReadyContent,
      products: [{ vendorId: "vendor-1", product: { vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true } }],
      form: { vendorId: "vendor-1", isActive: false, fields: [] },
      messageTemplate: { vendorId: "vendor-1", channel: "email", trigger: "registration_confirmed", isActive: true, subject: "報名", body: "內容" },
      interactionScript: { vendorId: "vendor-1", status: "published" },
    });

    await expect(admitLiveViewer(db, { vendorId: "vendor-1", liveId: "live-1", now }))
      .rejects.toMatchObject({ code: "live_not_found" });

    expect(tx.vendorUsageLimit.findUnique).not.toHaveBeenCalled();
    expect(tx.liveViewerSession.create).not.toHaveBeenCalled();
  });

  it("releases only the matching opaque session hash", async () => {
    const token = "B".repeat(43);

    await expect(releaseLiveViewer(db, { vendorId: "vendor-1", liveId: "live-1", token })).resolves.toBe(1);
    expect(deleteMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", liveId: "live-1", tokenHash: hashLiveViewerToken(token) },
    });
  });

  it("accepts only an unexpired session bound to the exact vendor and live", async () => {
    await expect(hasActiveLiveViewerSession(db, {
      vendorId: "vendor-1",
      liveId: "live-1",
      token: "A".repeat(43),
      now,
    })).resolves.toBe(true);

    const lookup = db.liveViewerSession.findUnique as ReturnType<typeof vi.fn>;
    expect(lookup).toHaveBeenCalledWith({
      where: { tokenHash: hashLiveViewerToken("A".repeat(43)) },
      select: { vendorId: true, liveId: true, expiresAt: true },
    });

    lookup.mockResolvedValue({
      vendorId: "vendor-2",
      liveId: "live-1",
      expiresAt: new Date("2026-08-07T06:01:00.000Z"),
    });
    await expect(hasActiveLiveViewerSession(db, {
      vendorId: "vendor-1", liveId: "live-1", token: "A".repeat(43), now,
    })).resolves.toBe(false);

    lookup.mockResolvedValue({
      vendorId: "vendor-1",
      liveId: "live-1",
      expiresAt: new Date("2026-08-07T05:59:59.000Z"),
    });
    await expect(hasActiveLiveViewerSession(db, {
      vendorId: "vendor-1", liveId: "live-1", token: "A".repeat(43), now,
    })).resolves.toBe(false);
  });
});
