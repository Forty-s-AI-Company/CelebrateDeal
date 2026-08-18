import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  live: { findFirst: vi.fn(), updateMany: vi.fn() },
  paymentMethodReference: { findFirst: vi.fn(), findMany: vi.fn() },
  vendorUsageLimit: { findUnique: vi.fn() },
  liveViewerSession: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
};
const db = {
  live: { findFirst: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(async (callback: (transaction: typeof tx) => unknown) => callback(tx)),
  liveViewerSession: { deleteMany: vi.fn() },
};
const runtimeReadyContent = {
  streamMode: "live",
  scheduledAt: new Date("2026-08-07T05:59:00.000Z"),
  status: "live",
  startedAt: new Date("2026-08-07T05:59:00.000Z"),
  endedAt: null,
  replayAvailableUntil: null,
  replayEnabled: true,
  video: { id: "video-1", vendorId: "vendor-1", durationSec: null, sourceType: "url", status: "ready", cloudflareReadyToStream: false, cloudflareLiveInputUid: null, liveInputStatus: null },
  form: { vendorId: "vendor-1", isActive: true, fields: [
    { key: "name", label: "姓名", type: "text", required: true },
    { key: "email", label: "Email", type: "email", required: true },
  ] },
  messageTemplate: { vendorId: "vendor-1", channel: "email", trigger: "registration_confirmed", isActive: true, subject: "報名成功", body: "{{name}} {{unsubscribe_url}}" },
  interactionScript: null,
  products: [],
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { DELETE, POST } from "@/app/api/live-admission/route";

function request(method: "POST" | "DELETE" = "POST", payload = { vendorId: "vendor-1", liveId: "live-1" }, cookie?: string) {
  return new Request("https://app.example.test/api/live-admission", {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.live.findFirst.mockResolvedValue({ id: "live-1", vendorId: "vendor-1", ...runtimeReadyContent });
  db.live.updateMany.mockResolvedValue({ count: 0 });
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
  tx.liveViewerSession.findUnique.mockResolvedValue(null);
  tx.liveViewerSession.count.mockResolvedValue(0);
  tx.liveViewerSession.create.mockResolvedValue({ id: "session-1" });
  tx.liveViewerSession.update.mockResolvedValue({ id: "session-1" });
  db.liveViewerSession.deleteMany.mockResolvedValue({ count: 1 });
});

describe("POST /api/live-admission", () => {
  it("admits a viewer and returns only a generic success body", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(response.headers.getSetCookie().join("\n")).toContain("HttpOnly");
    expect(JSON.stringify(body)).not.toContain("token");
  });

  it("refreshes an existing same-live cookie session", async () => {
    const token = "A".repeat(43);
    tx.liveViewerSession.findUnique.mockResolvedValue({ id: "session-1", vendorId: "vendor-1", liveId: "live-1" });

    const response = await POST(request("POST", undefined, `celebratedeal_live_viewer=${token}`));

    expect(response.status).toBe(200);
    expect(tx.liveViewerSession.update).toHaveBeenCalledOnce();
    expect(tx.liveViewerSession.create).not.toHaveBeenCalled();
  });

  it("maps viewer and credits quota failures to a bounded unavailable response", async () => {
    tx.liveViewerSession.count.mockResolvedValue(2);
    const viewerLimitResponse = await POST(request());
    expect(viewerLimitResponse.status).toBe(429);
    await expect(viewerLimitResponse.json()).resolves.toEqual({ error: "Playback temporarily unavailable" });

    tx.liveViewerSession.count.mockResolvedValue(0);
    tx.vendorUsageLimit.findUnique.mockResolvedValue({ creditsLimit: 1000, creditsUsed: 950 });
    const creditsResponse = await POST(request());
    expect(creditsResponse.status).toBe(429);
    await expect(creditsResponse.json()).resolves.toEqual({ error: "Playback temporarily unavailable" });
  });

  it("does not expose playback when a configured quota has no payment owner", async () => {
    tx.live.findFirst.mockResolvedValueOnce({
      id: "live-1",
      vendorId: "vendor-1",
      ...runtimeReadyContent,
      quotaPolicy: {
        quotaPayerScope: "MEMBER",
        usageAttributionMode: "CUSTOM",
        customAllocations: [{ teamId: "team-1", membershipId: "member-1", bps: 10_000 }],
      },
    });
    tx.paymentMethodReference.findMany.mockResolvedValueOnce([]);

    const response = await POST(request());

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({ error: "Playback temporarily unavailable" });
    expect(tx.liveViewerSession.create).not.toHaveBeenCalled();
  });

  it("returns 404 before session creation when runtime sales readiness becomes stale", async () => {
    tx.live.findFirst.mockResolvedValueOnce({
      id: "live-1",
      vendorId: "vendor-1",
      quotaPolicy: null,
      ...runtimeReadyContent,
      products: [{ vendorId: "vendor-1", product: { vendorId: "vendor-1", isActive: false, fulfillmentTypeConfirmed: true } }],
      form: { vendorId: "vendor-1", isActive: true, fields: [] },
      messageTemplate: null,
      interactionScript: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Playback source not found" });
    expect(tx.liveViewerSession.create).not.toHaveBeenCalled();
  });

  it.each([
    ["replay disabled", { replayEnabled: false, replayAvailableUntil: null }],
    ["replay deadline expired", { replayEnabled: true, replayAvailableUntil: new Date("2026-08-07T06:00:00.000Z") }],
  ])("persists natural VOD completion before returning 404 when %s", async (_label, replay) => {
    const completionAt = new Date("2026-08-07T06:00:00.000Z");
    const completed = {
      id: "live-1",
      vendorId: "vendor-1",
      quotaPolicy: null,
      ...runtimeReadyContent,
      streamMode: "vod",
      status: "live",
      scheduledAt: new Date("2026-08-07T05:59:00.000Z"),
      startedAt: null,
      ...replay,
      video: { ...runtimeReadyContent.video, durationSec: 60 },
    };
    db.live.findFirst.mockResolvedValue(completed);
    db.live.updateMany.mockResolvedValue({ count: 1 });
    tx.live.findFirst.mockResolvedValue({ ...completed, status: "ended", endedAt: completionAt });

    const response = await POST(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Playback source not found" });
    expect(db.live.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: "ended", endedAt: completionAt },
    }));
    expect(tx.liveViewerSession.create).not.toHaveBeenCalled();
  });

  it("maps exhausted serializable admission conflicts to 503", async () => {
    db.$transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" })
      .mockRejectedValueOnce({ code: "P2034" });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Playback temporarily unavailable" });
    expect(db.$transaction).toHaveBeenCalledTimes(3);
  });
});

describe("DELETE /api/live-admission", () => {
  it("releases the server-side session by hashed cookie token", async () => {
    const token = "B".repeat(43);
    const response = await DELETE(request("DELETE", undefined, `celebratedeal_live_viewer=${token}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(db.liveViewerSession.deleteMany).toHaveBeenCalledOnce();
    expect(JSON.stringify(db.liveViewerSession.deleteMany.mock.calls)).not.toContain(token);
  });
});
