import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMetaTrackingEvent } from "@/lib/tracking-meta-transport";

const input = {
  pixelId: "123456789", apiVersion: "v22.0", token: "synthetic-meta-token", testEventCode: "TEST_SYNTHETIC",
  event: { event_name: "Purchase" as const, event_time: 1791331200, event_id: "purchase:synthetic-payment", action_source: "website" as const, event_source_url: "https://tracking.example.test/checkout/synthetic/product", user_data: { external_id: ["a".repeat(64)], client_user_agent: "SyntheticTrackingBrowser/1.0" } },
  attempt: 1, now: new Date("2026-10-07T00:00:00Z"),
};
beforeEach(() => { vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", "true"); vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", "false"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
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


describe("interrupted successful provider response with simulated streams only", () => {
  it.each(["reset", "timeout"] as const)("%s retries with the same event ID and stops at the eighth attempt", async failure => {
    const actualTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => actualTimeout(5));
    const fetchMock = vi.fn().mockImplementation(async (_url, options) => new Response(new ReadableStream({
      start(controller) {
        if (failure === "reset") controller.error(new TypeError("synthetic stream reset"));
        else options.signal.addEventListener("abort", () => controller.error(options.signal.reason), { once: true });
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendMetaTrackingEvent(input)).resolves.toEqual({ outcome: "retry", retryAt: new Date(input.now.getTime() + 30_000) });
    await expect(sendMetaTrackingEvent({ ...input, attempt: 8 })).resolves.toEqual({ outcome: "rejected" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(timeoutSpy).toHaveBeenNthCalledWith(1, 10_000);
    expect(timeoutSpy).toHaveBeenNthCalledWith(2, 10_000);
    expect(fetchMock.mock.calls.map(call => JSON.parse(call[1].body).data[0].event_id)).toEqual([input.event.event_id, input.event.event_id]);
  });
  it("rejects unsafe URL, plain-text identity and absent browser context before network", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const events = [
      { ...input.event, event_source_url: "https://tracking.example.test/?token=synthetic" },
      { ...input.event, event_source_url: "https://synthetic:synthetic@tracking.example.test/" },
      { ...input.event, event_source_url: "file:///synthetic" },
      { ...input.event, user_data: { ...input.event.user_data, external_id: ["synthetic-user@example.test"] } },
      { ...input.event, user_data: { ...input.event.user_data, client_user_agent: "" } },
      { ...input.event, event_time: 0 },
    ];
    for (const event of events) await expect(sendMetaTrackingEvent({ ...input, event })).rejects.toThrow(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// 僅模擬 HTTP；此案例不執行正式環境或任何實際 provider request。
it("omits test code only for explicitly enabled live binding using simulated HTTP", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response('{"events_received":1}', { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", "false");
  vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", "false");
  await expect(sendMetaTrackingEvent({ ...input, deliveryMode: "live", testEventCode: null })).rejects.toThrow(TypeError);
  expect(fetchMock).not.toHaveBeenCalled();
  vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", "true");
  await expect(sendMetaTrackingEvent({ ...input, deliveryMode: "live", testEventCode: null })).resolves.toEqual({ outcome: "accepted" });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ data: [input.event] });
  await expect(sendMetaTrackingEvent({ ...input, deliveryMode: "live" })).rejects.toThrow(TypeError);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  ["", "", ""], ["preview", "false", "false"], ["preview", "true", "true"], ["production", "true", "false"],
])("rejects direct test transmission with invalid binding %s/%s/%s before fetch", async (environment, testFlag, liveFlag) => {
  vi.stubEnv("VERCEL_ENV", environment); vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", testFlag); vi.stubEnv("META_TRACKING_LIVE_DELIVERY_ENABLED", liveFlag);
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await expect(sendMetaTrackingEvent(input)).rejects.toThrow(TypeError);
  expect(fetchMock).not.toHaveBeenCalled();
});
