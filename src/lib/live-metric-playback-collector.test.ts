import { expect, it, vi } from "vitest";
import { createPlaybackMetricCollector } from "./live-metric-playback-collector";
const source = { metricRequestId: "de305d54-75b4-431b-adb2-eb6b9e546014", metricIssuedAtMs: 1000, metricExpiresAtMs: 90000 };
const media = () => Object.assign(new EventTarget(), { currentTime: 0, playbackRate: 1, paused: true, ended: false, seeking: false, readyState: 4 });
it("does not send requests or invent identity for untracked sources", () => {
  const fetcher = vi.fn(); expect(createPlaybackMetricCollector({ vendorId: "v", liveId: "l" }, {}, media(), () => 0, fetcher)).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
it("opens with the exact server intake UUID and retains it on an ambiguous response", async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("network")).mockResolvedValue(new Response(null, { status: 403 }));
  const collector = createPlaybackMetricCollector({ vendorId: "v", liveId: "l" }, source, media(), () => 0, fetcher)!;
  await collector.tick(); await collector.tick();
  expect(fetcher).toHaveBeenCalledTimes(2);
  for (const [url, init] of fetcher.mock.calls) {
    expect(url).toBe("/api/live-metrics/v/l/sessions"); expect(JSON.parse(init!.body as string)).toEqual({ requestId: source.metricRequestId });
  }
});
