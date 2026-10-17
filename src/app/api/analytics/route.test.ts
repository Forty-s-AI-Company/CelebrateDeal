import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyticsCreate: vi.fn(),
  captureProductEvent: vi.fn(),
  checkRateLimit: vi.fn(),
  hasActiveLiveViewerSession: vi.fn(),
  hashLiveViewerToken: vi.fn(),
  liveFindFirst: vi.fn(),
  liveProductFindFirst: vi.fn(),
  liveViewerTokenFromRequest: vi.fn(),
  enqueueTracking: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    analyticsEvent: { create: mocks.analyticsCreate },
    live: { findFirst: mocks.liveFindFirst },
    liveProduct: { findFirst: mocks.liveProductFindFirst },
    $transaction: mocks.transaction,
  }),
}));
vi.mock("@/lib/product-analytics", () => ({ captureProductEvent: mocks.captureProductEvent }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/tracking-event-outbox", () => ({ enqueueAuthoritativeTrackingEvent: mocks.enqueueTracking }));
vi.mock("@/lib/live-quota-admission", () => ({
  hasActiveLiveViewerSession: mocks.hasActiveLiveViewerSession,
  hashLiveViewerToken: mocks.hashLiveViewerToken,
  liveViewerTokenFromRequest: mocks.liveViewerTokenFromRequest,
}));

import { POST } from "@/app/api/analytics/route";
import { MAX_JSON_BODY_BYTES } from "@/lib/api-security";

function analyticsRequest(payload?: unknown, body?: string, extraHeaders: Record<string, string> = {}) {
  return new Request("https://app.example.test/api/analytics", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
      ...extraHeaders,
    },
    body: body ?? (payload === undefined ? undefined : JSON.stringify(payload)),
  });
}

const validEvent = {
  vendorId: "vendor-1",
  liveId: "live-1",
  eventType: "product_click",
  payload: { productId: "product-1", ref: "PARTNER_1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.liveViewerTokenFromRequest.mockReturnValue("viewer-token");
  mocks.hasActiveLiveViewerSession.mockResolvedValue(true);
  mocks.hashLiveViewerToken.mockReturnValue("verified-session-1");
  mocks.liveFindFirst.mockResolvedValue({ id: "live-1", slug: "trusted-live" });
  mocks.liveProductFindFirst.mockResolvedValue({ id: "live-product-1" });
  mocks.analyticsCreate.mockResolvedValue({ id: "event-1" });
  mocks.captureProductEvent.mockResolvedValue({ skipped: false });
  mocks.enqueueTracking.mockResolvedValue(null);
  mocks.transaction.mockImplementation(async callback => callback({ analyticsEvent: { create: mocks.analyticsCreate } }));
});
afterEach(() => vi.unstubAllEnvs());

describe("analytics route", () => {
  it("queues ViewContent in the same transaction only after tenant and viewer admission, using the actual browser context", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    const response = await POST(analyticsRequest(validEvent, undefined, { "user-agent": "SyntheticTrackingBrowser/1.0" }));
    expect(response.status).toBe(200);
    expect(mocks.hasActiveLiveViewerSession).toHaveBeenCalledWith(expect.anything(), { vendorId: "vendor-1", liveId: "live-1", token: "viewer-token" });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.enqueueTracking).toHaveBeenCalledWith(expect.objectContaining({ analyticsEvent: { create: mocks.analyticsCreate } }), {
      vendorId: "vendor-1", eventName: "ViewContent", sourceId: "event-1", context: { sourceUrl: "https://app.example.test/live/trusted-live", userAgent: "SyntheticTrackingBrowser/1.0" },
    });
  });
  it("does not create provider events for playback progress or a rejected viewer", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    const headers = { "user-agent": "SyntheticTrackingBrowser/1.0" };
    expect((await POST(analyticsRequest({ vendorId: "vendor-1", liveId: "live-1", eventType: "play_progress", payload: { seconds: 30 } }, undefined, headers))).status).toBe(200);
    expect(mocks.enqueueTracking).not.toHaveBeenCalled();
    mocks.hasActiveLiveViewerSession.mockResolvedValueOnce(false);
    expect((await POST(analyticsRequest(validEvent, undefined, headers))).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.enqueueTracking).not.toHaveBeenCalled();
  });

  it("returns 400 instead of throwing for an empty JSON body", async () => {
    const response = await POST(analyticsRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid payload" });
  });

  it("returns 400 for malformed JSON without calling downstream services", async () => {
    const response = await POST(analyticsRequest(undefined, "{not-json}"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid payload" });
    expect(mocks.liveFindFirst).not.toHaveBeenCalled();
    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for an oversized public analytics payload", async () => {
    const response = await POST(analyticsRequest({ payload: "x".repeat(MAX_JSON_BODY_BYTES) }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid payload" });
  });

  it("rejects unknown event types and sensitive or unlisted payload fields", async () => {
    for (const payload of [
      { ...validEvent, eventType: "custom_event" },
      { ...validEvent, visitorId: "forged-client-visitor" },
      { ...validEvent, payload: { ...validEvent.payload, email: "person@example.test" } },
      { ...validEvent, payload: { ...validEvent.payload, token: "sensitive-token" } },
    ]) {
      const response = await POST(analyticsRequest(payload));
      expect(response.status).toBe(400);
    }

    expect(mocks.liveFindFirst).not.toHaveBeenCalled();
    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.captureProductEvent).not.toHaveBeenCalled();
  });

  it("rejects analytics without an active server-issued playback session", async () => {
    mocks.liveViewerTokenFromRequest.mockReturnValueOnce(null);
    const missingToken = await POST(analyticsRequest(validEvent));
    expect(missingToken.status).toBe(403);
    expect(missingToken.headers.get("cache-control")).toBe("private, no-store");

    mocks.hasActiveLiveViewerSession.mockResolvedValueOnce(false);
    const expiredSession = await POST(analyticsRequest(validEvent));
    expect(expiredSession.status).toBe(403);
    expect(mocks.liveFindFirst).not.toHaveBeenCalled();
    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.captureProductEvent).not.toHaveBeenCalled();
  });

  it("rejects a live outside the supplied tenant before storing or forwarding the event", async () => {
    mocks.liveFindFirst.mockResolvedValue(null);

    const response = await POST(analyticsRequest(validEvent));

    expect(response.status).toBe(404);
    expect(mocks.liveFindFirst).toHaveBeenCalledWith({
      where: {
        id: "live-1",
        vendorId: "vendor-1",
        OR: [
          { status: { in: ["scheduled", "live"] } },
          { status: "ended", replayEnabled: true },
        ],
      },
      select: { id: true, slug: true },
    });
    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.captureProductEvent).not.toHaveBeenCalled();
  });

  it("stores and forwards only the validated analytics shape", async () => {
    const response = await POST(analyticsRequest(validEvent));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, verified: true });
    expect(mocks.hasActiveLiveViewerSession).toHaveBeenCalledWith(expect.anything(), {
      vendorId: "vendor-1",
      liveId: "live-1",
      token: "viewer-token",
    });
    expect(mocks.analyticsCreate).toHaveBeenCalledWith({
      data: {
        ...validEvent,
        visitorId: "verified-session-1",
        trustLevel: "ADMITTED_LIVE_SESSION",
      },
    });
    expect(mocks.captureProductEvent).toHaveBeenCalledWith({
      distinctId: "verified-session-1",
      event: "product_click",
      properties: {
        vendorId: "vendor-1",
        liveId: "live-1",
        sourceTrust: "admitted_live_session",
        productId: "product-1",
        ref: "PARTNER_1",
      },
    });
  });

  it("rejects a product click for an inactive, foreign, or unbound product", async () => {
    mocks.liveProductFindFirst.mockResolvedValue(null);

    const response = await POST(analyticsRequest(validEvent));

    expect(response.status).toBe(404);
    expect(mocks.liveProductFindFirst).toHaveBeenCalledWith({
      where: {
        liveId: "live-1",
        productId: "product-1",
        product: {
          vendorId: "vendor-1",
          isActive: true,
        },
      },
      select: { id: true },
    });
    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.captureProductEvent).not.toHaveBeenCalled();
  });
});
