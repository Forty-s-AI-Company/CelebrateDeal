import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMetaTrackingEvent } from "@/lib/tracking-meta-transport";

const input = {
  pixelId: "123456789", apiVersion: "v22.0", token: "synthetic-meta-token", testEventCode: "TEST_SYNTHETIC",
  event: { event_name: "Purchase" as const, event_time: 1791331200, event_id: "purchase:synthetic-payment", action_source: "website" as const, event_source_url: "https://tracking.example.test/checkout/synthetic/product", user_data: { external_id: ["a".repeat(64)], client_user_agent: "SyntheticTrackingBrowser/1.0" } },
  attempt: 1, now: new Date("2026-10-07T00:00:00Z"),
};
afterEach(() => vi.unstubAllGlobals());
describe("Meta test-events transport with simulated HTTP only", () => {
  it("keeps credentials out of the URL and requests one stable event without redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"events_received":1}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTrackingEvent(input)).resolves.toEqual({ outcome: "accepted" });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v22.0/123456789/events");
    expect(url).not.toContain(input.token);
    expect(options.redirect).toBe("manual");
    expect(JSON.parse(options.body)).toEqual({ data: [input.event], test_event_code: input.testEventCode });
  });
  it.each(["", "not/json", '{"events_received":0}', '"accepted"', "a".repeat(65_537)])("cannot accept malformed, empty or oversized success bodies", async body => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200 })));
    await expect(sendMetaTrackingEvent(input)).resolves.toEqual({ outcome: "rejected" });
  });
  it("retries network failure and provider throttling, but rejects redirects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic failure")));
    await expect(sendMetaTrackingEvent(input)).resolves.toMatchObject({ outcome: "retry" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429 })));
    await expect(sendMetaTrackingEvent(input)).resolves.toMatchObject({ outcome: "retry" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 302 })));
    await expect(sendMetaTrackingEvent(input)).resolves.toEqual({ outcome: "rejected" });
  });
  it("rejects absent test mode, arbitrary endpoints and invalid attempt before network", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    for (const change of [{ testEventCode: "" }, { pixelId: "../other" }, { apiVersion: "https://example.org" }, { attempt: 0 }]) {
      await expect(sendMetaTrackingEvent({ ...input, ...change })).rejects.toThrow(TypeError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
