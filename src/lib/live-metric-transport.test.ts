import { describe, expect, it, vi } from "vitest";
import { createMetricHttpTransport } from "./live-metric-transport";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const row = { sequence: 0, startElapsedMs: 0, endElapsedMs: 1000, mediaStartMs: 0, mediaEndMs: 1000, rate: 1 };
describe("metric same-origin transport", () => {
  it("keeps transient session errors retryable but disables denied collection", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({}, 503)).mockResolvedValueOnce(reply({}, 403));
    const http = createMetricHttpTransport("v", "l", fetcher);
    await expect(http.open("de305d54-75b4-431b-adb2-eb6b9e546014")).rejects.toThrow("temporarily unavailable");
    expect(await http.open("de305d54-75b4-431b-adb2-eb6b9e546014")).toBeNull();
  });
  it("uses browser credentials and a relative scoped endpoint without identity in the body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ ok: true, accepted: 1, replayed: 0, lastSequence: 0 }));
    const transport = createMetricHttpTransport("vendor", "live", fetcher).session("session");
    expect(await transport.append([row])).toEqual({ ok: true, lastSequence: 0 });
    expect(fetcher.mock.calls[0][0]).toBe("/api/live-metrics/vendor/live/intervals");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store", keepalive: true });
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ sessionId: "session", segments: [row] });
  });
  it.each([403, 409, 422, 429, 503])("classifies append HTTP %i", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({}, status));
    expect(await createMetricHttpTransport("v", "l", fetcher).session("s").append([row]))
      .toEqual({ ok: false, retryable: status === 429 || status >= 500 });
  });
  it("does not accept malformed acknowledgements", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ ok: true, accepted: 0, replayed: 0, lastSequence: 0 }));
    expect(await createMetricHttpTransport("v", "l", fetcher).session("s").append([row])).toEqual({ ok: false, retryable: false });
  });
  it("distinguishes pending and terminal incomplete close receipts", async () => {
    const receipt = { ok: true, sessionId: "s", finalSequence: 1, lastSequence: 0, deliveryComplete: false, appendOpen: true, closedAtMs: null };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(reply(receipt, 202))
      .mockResolvedValueOnce(reply({ ...receipt, appendOpen: false, closedAtMs: 5000 }));
    const session = createMetricHttpTransport("v", "l", fetcher).session("s");
    expect(await session.close(1)).toEqual({ terminal: false });
    expect(await session.close(1)).toEqual({ terminal: true });
  });
  it("rejects a close receipt from another session", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(reply({ ok: true, sessionId: "other", finalSequence: -1, lastSequence: -1, deliveryComplete: true, appendOpen: false, closedAtMs: 5000 }));
    expect(await createMetricHttpTransport("v", "l", fetcher).session("s").close(-1)).toEqual({ terminal: false });
  });
  it("rejects external URLs and scope traversal before sending", () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => createMetricHttpTransport("../other", "l", fetcher)).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
