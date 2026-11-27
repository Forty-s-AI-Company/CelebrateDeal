// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  detach: vi.fn(),
  attachHlsPlayback: vi.fn(),
}));

vi.mock("@/lib/hls-playback-attachment", () => ({ attachHlsPlayback: mocks.attachHlsPlayback }));

import { fetchLiveWaitingSource, LiveWaitingBackdrop, projectWaitingVideoSource, waitingVideoFetchDelayMs } from "./live-waiting-backdrop";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function render(props: Partial<Parameters<typeof LiveWaitingBackdrop>[0]> = {}) {
  await act(async () => {
    root.render(
      <LiveWaitingBackdrop vendorId="vendor-1" liveId="live-1" heroImageUrl="https://img.example.test/poster.jpg" hasWaitingVideo {...props} />,
    );
  });
  // Let the source fetch resolve and the attach effect run.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.attachHlsPlayback.mockReturnValue(mocks.detach);
  fetchMock.mockResolvedValue(jsonResponse({ playbackUrl: "https://video.example.test/waiting-loop.mp4" }));
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LiveWaitingBackdrop", () => {
  it("shows only the poster, full-bleed, and requests nothing without a waiting video", async () => {
    await render({ hasWaitingVideo: false });
    const backdrop = container.querySelector('[data-testid="live-waiting-backdrop"]') as HTMLElement;
    expect(backdrop.dataset.waitingVideo).toBe("off");
    expect(backdrop.innerHTML).toContain("poster.jpg");
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector('[data-testid="live-waiting-sound"]')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the current room when there is no poster either", async () => {
    await render({ hasWaitingVideo: false, heroImageUrl: null });
    expect(container.querySelector('[data-testid="live-waiting-backdrop"]')).not.toBeNull();
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("asks only for this Live's waiting source and plays it muted, looped and inline with no controls", async () => {
    await render();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/live-waiting-source?vendorId=vendor-1&liveId=live-1");
    expect(String(url)).not.toContain("video");
    expect((init as RequestInit).headers).toMatchObject({ "X-CelebrateDeal-Client": "web" });

    const video = container.querySelector('[data-testid="live-waiting-video"]') as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.hasAttribute("controls")).toBe(false);
    expect(video.getAttribute("poster")).toBe("https://img.example.test/poster.jpg");
    expect(video.getAttribute("src")).toBe("https://video.example.test/waiting-loop.mp4");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(mocks.attachHlsPlayback).not.toHaveBeenCalled();
    // No pause, seek bar or progress UI: the only control is the sound toggle.
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(container.querySelector('input[type="range"], progress')).toBeNull();
  });

  it("turns the sound on and off from the one button", async () => {
    await render();
    const button = container.querySelector('[data-testid="live-waiting-sound"]') as HTMLButtonElement;
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(button.textContent).toBe("開啟聲音");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    await act(async () => { button.click(); });
    expect(video.muted).toBe(false);
    expect(button.textContent).toBe("關閉聲音");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    await act(async () => { button.click(); });
    expect(video.muted).toBe(true);
    expect(button.textContent).toBe("開啟聲音");
  });

  it("attaches a signed HLS source through the shared player and renews through the same endpoint", async () => {
    const manifest = "https://customer-abc.cloudflarestream.com/token.a.b/manifest/video.m3u8";
    fetchMock.mockResolvedValue(jsonResponse({ playbackUrl: manifest, expiresInSeconds: 600 }));
    await render();
    expect(mocks.attachHlsPlayback).toHaveBeenCalledOnce();
    const options = mocks.attachHlsPlayback.mock.calls[0]![0];
    expect(options).toMatchObject({ url: manifest, expiresInSeconds: 600 });
    expect(options.video).toBe(container.querySelector("video"));
    // Renewal (and Safari native HLS recovery inside attachHlsPlayback) asks the waiting endpoint again.
    fetchMock.mockResolvedValue(jsonResponse({ playbackUrl: manifest, expiresInSeconds: 600 }));
    await expect(options.fetchSource()).resolves.toEqual({ playbackUrl: manifest, expiresInSeconds: 600 });
    expect(fetchMock).toHaveBeenLastCalledWith("/api/live-waiting-source?vendorId=vendor-1&liveId=live-1", expect.any(Object));
  });

  it("stops and releases the waiting video when the room closes for the show", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ playbackUrl: "https://customer-abc.cloudflarestream.com/t.a.b/manifest/video.m3u8", expiresInSeconds: 600 }));
    await render();
    const video = container.querySelector("video") as HTMLVideoElement;
    const removeAttribute = vi.spyOn(video, "removeAttribute");
    await act(async () => root.render(<div data-testid="main-player" />));
    expect(mocks.detach).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(removeAttribute).toHaveBeenCalledWith("src");
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    expect(container.querySelector('[data-testid="live-waiting-backdrop"]')).toBeNull();
  });

  it("falls back to the poster when the server refuses the waiting source", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Waiting video unavailable" }, 403));
    await render();
    expect(container.querySelector("video")).toBeNull();
    expect((container.querySelector('[data-testid="live-waiting-backdrop"]') as HTMLElement).dataset.waitingVideo).toBe("off");
    fetchMock.mockRejectedValue(new Error("offline"));
    await render({ liveId: "live-2" });
    expect(container.querySelector("video")).toBeNull();
  });
});

describe("LiveWaitingBackdrop 60-minute window", () => {
  const serverNow = "2026-11-27T08:00:00.000Z";

  it("shows only the poster to an early visitor and asks for the loop by itself when the window opens", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      vi.setSystemTime(new Date(serverNow));
      // Starts in 90 minutes: the window opens in 30.
      await render({ scheduledAt: "2026-11-27T09:30:00.000Z", serverNow });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(container.querySelector("video")).toBeNull();
      expect(container.innerHTML).toContain("poster.jpg");

      await act(async () => { await vi.advanceTimersByTimeAsync(30 * 60_000 - 5_000); });
      expect(fetchMock).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(fetchMock).toHaveBeenCalledOnce();
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });
      expect(container.querySelector('[data-testid="live-waiting-video"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("asks at once inside the window and stops waiting when the room closes early", async () => {
    await render({ scheduledAt: "2026-11-27T08:30:00.000Z", serverNow });
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      vi.setSystemTime(new Date(serverNow));
      fetchMock.mockClear();
      // Starts in 4 hours: the request is only armed, then the room closes before it fires.
      await act(async () => root.render(<LiveWaitingBackdrop vendorId="vendor-1" liveId="live-9" heroImageUrl={null} hasWaitingVideo scheduledAt="2026-11-27T12:00:00.000Z" serverNow={serverNow} />));
      expect(fetchMock).not.toHaveBeenCalled();
      await act(async () => root.render(<div />));
      await act(async () => { await vi.advanceTimersByTimeAsync(4 * 60 * 60_000); });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("measures the wait on the server clock the page was rendered with", () => {
    expect(waitingVideoFetchDelayMs("2026-11-27T09:30:00.000Z", serverNow)).toBe(30 * 60_000 + 1_000);
    expect(waitingVideoFetchDelayMs("2026-11-27T09:00:00.000Z", serverNow)).toBe(0);
    expect(waitingVideoFetchDelayMs("2026-11-27T08:10:00.000Z", serverNow)).toBe(0);
    // Without both times the server alone decides.
    expect(waitingVideoFetchDelayMs(null, serverNow)).toBe(0);
    expect(waitingVideoFetchDelayMs("2026-11-27T09:30:00.000Z", undefined)).toBe(0);
    expect(waitingVideoFetchDelayMs("not a date", serverNow)).toBe(0);
  });
});

describe("LiveWaitingBackdrop rerenders (#736 M-1)", () => {
  const start = "2026-11-27T10:00:00.000Z";
  // Past the start of a manually started show: the room still waits and the page refreshes every 2 seconds.
  const refreshes = (count: number) => Array.from({ length: count }, (_, index) => (
    new Date(Date.parse(start) + 10 * 60_000 + index * 2_000).toISOString()
  ));

  it("asks once and never reattaches a served file however often the page refreshes", async () => {
    let served = 0;
    fetchMock.mockImplementation(async () => jsonResponse({ playbackUrl: `https://video.example.test/loop.mp4?n=${served++}` }));
    for (const serverNow of refreshes(5)) await render({ scheduledAt: start, serverNow });

    expect(fetchMock).toHaveBeenCalledOnce();
    const video = container.querySelector('[data-testid="live-waiting-video"]') as HTMLVideoElement;
    expect(video.getAttribute("src")).toBe("https://video.example.test/loop.mp4?n=0");
    // Attached once, never released and reloaded from the start.
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    // The same element keeps playing.
    await render({ scheduledAt: start, serverNow: refreshes(6)[5] });
    expect(container.querySelector('[data-testid="live-waiting-video"]')).toBe(video);
  });

  it("leaves renewal of a signed HLS source to the shared player", async () => {
    const manifest = "https://customer-abc.cloudflarestream.com/token.a.b/manifest/video.m3u8";
    fetchMock.mockImplementation(async () => jsonResponse({ playbackUrl: manifest, expiresInSeconds: 600 }));
    for (const serverNow of refreshes(5)) await render({ scheduledAt: start, serverNow });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.attachHlsPlayback).toHaveBeenCalledOnce();
    expect(mocks.detach).not.toHaveBeenCalled();
  });

  it("does not ask again when only the start changes after the source was served", async () => {
    await render({ scheduledAt: start, serverNow: refreshes(1)[0] });
    await render({ scheduledAt: "2026-11-27T10:15:00.000Z", serverNow: refreshes(2)[1] });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="live-waiting-video"]')).not.toBeNull();
  });

  it("asks afresh for another Live", async () => {
    await render({ scheduledAt: start, serverNow: refreshes(1)[0] });
    await render({ liveId: "live-2", scheduledAt: start, serverNow: refreshes(2)[1] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/live-waiting-source?vendorId=vendor-1&liveId=live-2");
  });
});

describe("LiveWaitingBackdrop retries (review m-C)", () => {
  const refused = () => jsonResponse({ error: "Waiting video unavailable" }, 403);
  const served = () => jsonResponse({ playbackUrl: "https://video.example.test/waiting-loop.mp4" });
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks again after 5 seconds and then after 30 more, and plays once a source arrives", async () => {
    fetchMock
      .mockImplementationOnce(async () => refused())
      .mockImplementationOnce(async () => { throw new Error("offline"); })
      .mockImplementationOnce(async () => served());
    await render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector("video")).toBeNull();

    await advance(4_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await flush();

    await advance(29_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await flush();
    expect(container.querySelector('[data-testid="live-waiting-video"]')?.getAttribute("src")).toBe("https://video.example.test/waiting-loop.mp4");
    for (const [url] of fetchMock.mock.calls) expect(url).toBe("/api/live-waiting-source?vendorId=vendor-1&liveId=live-1");
  });

  it("stops after 3 requests in all and keeps the poster", async () => {
    fetchMock.mockImplementation(async () => refused());
    await render();
    await advance(5_000);
    await flush();
    await advance(30_000);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector("video")).toBeNull();
    expect((container.querySelector('[data-testid="live-waiting-backdrop"]') as HTMLElement).dataset.waitingVideo).toBe("off");
  });

  it("does not retry after a source is served", async () => {
    fetchMock.mockImplementation(async () => served());
    await render();
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the retry count across rerenders: at most 3 requests in all (#736 M-1)", async () => {
    fetchMock.mockImplementation(async () => refused());
    const start = "2026-11-27T10:00:00.000Z";
    vi.setSystemTime(new Date(Date.parse(start) + 10 * 60_000));
    // The watch page refreshes every 2 seconds once the start has passed; each render brings a new serverNow.
    for (let second = 0; second < 60; second += 2) {
      const serverNow = new Date(Date.parse(start) + 10 * 60_000 + second * 1_000).toISOString();
      await render({ scheduledAt: start, serverNow });
      await advance(2_000);
      await flush();
    }
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.querySelector("video")).toBeNull();
  });

  it("starts over for a postponed show after giving up at the old start (#736 re-review m-1)", async () => {
    const oldStart = Date.parse("2026-11-27T12:00:00.000Z");
    const newStart = oldStart + 90 * 60_000;
    // The server already knows the new start: it serves only from 60 minutes before it.
    fetchMock.mockImplementation(async () => (Date.now() >= newStart - 60 * 60_000 ? served() : refused()));
    const iso = (ms: number) => new Date(ms).toISOString();
    // This page was rendered before the postponement: it plans for the old start.
    vi.setSystemTime(oldStart - 50 * 60_000);
    await render({ scheduledAt: iso(oldStart), serverNow: iso(Date.now()) });
    await advance(60_000);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Refreshes that only bring a new serverNow keep the given-up state.
    await render({ scheduledAt: iso(oldStart), serverNow: iso(Date.now()) });
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // At the old start the countdown refreshes the page, which now brings the new start.
    await advance(oldStart - Date.now());
    await render({ scheduledAt: iso(newStart), serverNow: iso(Date.now()) });
    // The new window opens 30 minutes later; nothing is asked before it.
    await advance(29 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(2 * 60_000);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(container.querySelector('[data-testid="live-waiting-video"]')?.getAttribute("src")).toBe("https://video.example.test/waiting-loop.mp4");

    // Served: later refreshes, even with another start, never ask again.
    await render({ scheduledAt: iso(newStart + 60_000), serverNow: iso(Date.now()) });
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("starts over when the start changes while still retrying", async () => {
    const start = Date.parse("2026-11-27T10:00:00.000Z");
    const iso = (ms: number) => new Date(ms).toISOString();
    fetchMock.mockImplementation(async () => refused());
    vi.setSystemTime(start - 10 * 60_000);
    await render({ scheduledAt: iso(start), serverNow: iso(Date.now()) });
    await advance(5_000);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // A new start inside the window: asked at once, with a fresh budget of 3.
    await render({ scheduledAt: iso(start + 15 * 60_000), serverNow: iso(Date.now()) });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(5_000);
    await flush();
    await advance(30_000);
    await flush();
    await advance(10 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("clears a pending retry when the room closes", async () => {
    fetchMock.mockImplementation(async () => refused());
    await render();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<div data-testid="main-player" />));
    await advance(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("waiting source projection", () => {
  it("accepts only a safe http(s) URL and a positive lifetime", () => {
    expect(projectWaitingVideoSource({ playbackUrl: "https://v.example.test/a.mp4" })).toEqual({ playbackUrl: "https://v.example.test/a.mp4" });
    expect(projectWaitingVideoSource({ playbackUrl: "https://v.example.test/a.m3u8", expiresInSeconds: 90.7 }))
      .toEqual({ playbackUrl: "https://v.example.test/a.m3u8", expiresInSeconds: 90 });
    expect(projectWaitingVideoSource({ playbackUrl: "https://v.example.test/a.mp4", expiresInSeconds: -1 })).toEqual({ playbackUrl: "https://v.example.test/a.mp4" });
    for (const payload of [null, [], "x", {}, { playbackUrl: "javascript:alert(1)" }, { playbackUrl: "/api/live-media?direction=read", protocol: "whep" }]) {
      expect(projectWaitingVideoSource(payload)).toBeNull();
    }
  });

  it("returns null for a refused request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 403)));
    await expect(fetchLiveWaitingSource("vendor-1", "live-1")).resolves.toBeNull();
  });
});
