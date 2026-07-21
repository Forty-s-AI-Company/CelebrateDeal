import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  analyticsCreate: vi.fn(),
  captureProductEvent: vi.fn(),
  checkRateLimit: vi.fn(),
  liveFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    analyticsEvent: { create: mocks.analyticsCreate },
    live: { findFirst: mocks.liveFindFirst },
  }),
}));
vi.mock("@/lib/product-analytics", () => ({ captureProductEvent: mocks.captureProductEvent }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { POST } from "@/app/api/analytics/route";
import { MAX_JSON_BODY_BYTES } from "@/lib/api-security";

function analyticsRequest(payload?: unknown, body?: string) {
  return new Request("https://app.example.test/api/analytics", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-celebratedeal-client": "web",
    },
    body: body ?? (payload === undefined ? undefined : JSON.stringify(payload)),
  });
}

const validEvent = {
  vendorId: "vendor-1",
  liveId: "live-1",
  visitorId: "visitor-1",
  eventType: "product_click",
  payload: { productId: "product-1", ref: "PARTNER_1" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(null);
  mocks.liveFindFirst.mockResolvedValue({ id: "live-1" });
  mocks.analyticsCreate.mockResolvedValue({ id: "event-1" });
  mocks.captureProductEvent.mockResolvedValue({ skipped: false });
});

describe("analytics route", () => {
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

  it("rejects a live outside the supplied tenant before storing or forwarding the event", async () => {
    mocks.liveFindFirst.mockResolvedValue(null);

    const response = await POST(analyticsRequest(validEvent));

    expect(response.status).toBe(404);
    expect(mocks.liveFindFirst).toHaveBeenCalledWith({
      where: { id: "live-1", vendorId: "vendor-1" },
      select: { id: true },
    });
    expect(mocks.analyticsCreate).not.toHaveBeenCalled();
    expect(mocks.captureProductEvent).not.toHaveBeenCalled();
  });

  it("stores and forwards only the validated analytics shape", async () => {
    const response = await POST(analyticsRequest(validEvent));

    expect(response.status).toBe(200);
    expect(mocks.analyticsCreate).toHaveBeenCalledWith({ data: validEvent });
    expect(mocks.captureProductEvent).toHaveBeenCalledWith({
      distinctId: "visitor-1",
      event: "product_click",
      properties: {
        vendorId: "vendor-1",
        liveId: "live-1",
        productId: "product-1",
        ref: "PARTNER_1",
      },
    });
  });
});
