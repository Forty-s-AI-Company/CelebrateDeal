import { describe, expect, it, vi } from "vitest";
import { trackClientAnalytics, type ClientAnalyticsEvent, type ClientAnalyticsFetcher } from "./client-analytics";

const event: ClientAnalyticsEvent = {
  liveId: "live-1",
  vendorId: "vendor-1",
  visitorId: "visitor-1",
  eventType: "product_click",
  payload: { productId: "product-1", ref: "partner-1" },
};

describe("trackClientAnalytics", () => {
  it("returns true and sends the required analytics request shape on success", async () => {
    const fetchMock: ClientAnalyticsFetcher = vi.fn(async () => ({ ok: true }));

    await expect(trackClientAnalytics(event, fetchMock)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/analytics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CelebrateDeal-Client": "web",
      },
      body: JSON.stringify(event),
    });
  });

  it("returns false for a non-successful response", async () => {
    const fetchMock: ClientAnalyticsFetcher = vi.fn(async () => ({ ok: false }));

    await expect(trackClientAnalytics(event, fetchMock)).resolves.toBe(false);
  });

  it("returns false when fetch throws synchronously", async () => {
    const fetchMock: ClientAnalyticsFetcher = vi.fn(() => {
      throw new Error("Network unavailable");
    });

    await expect(trackClientAnalytics(event, fetchMock)).resolves.toBe(false);
  });

  it("returns false when fetch rejects", async () => {
    const fetchMock: ClientAnalyticsFetcher = vi.fn(async () => Promise.reject(new Error("Network unavailable")));

    await expect(trackClientAnalytics(event, fetchMock)).resolves.toBe(false);
  });
});
