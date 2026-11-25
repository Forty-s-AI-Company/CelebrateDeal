// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hls = vi.hoisted(() => ({
  supported: true,
  instances: [] as Array<{ loadSource: ReturnType<typeof vi.fn>; attachMedia: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }>,
}));

vi.mock("hls.js", () => ({
  default: class FakeHls {
    static isSupported = () => hls.supported;
    static Events = { ERROR: "hlsError" };
    static ErrorTypes = { NETWORK_ERROR: "networkError" };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    on = vi.fn();
    startLoad = vi.fn();
    constructor() { hls.instances.push(this); }
  },
}));

import { EvergreenPreviewPlayer } from "./evergreen-preview-player";

const HLS_URL = "https://customer-test.cloudflarestream.com/token.fixture/manifest/video.m3u8";
const MP4_URL = "https://cdn.example.test/video.mp4";
const events = [{ id: "e1", triggerSec: 5, title: "優惠", eventType: "offer" }];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  hls.supported = true;
  hls.instances.length = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(url: string) {
  await act(async () => {
    root.render(<EvergreenPreviewPlayer videoUrl={url} playbackRate={2} events={events} />);
  });
  // attachHlsPlayback loads hls.js through a dynamic import.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}
const video = () => container.querySelector("video")!;

describe("EvergreenPreviewPlayer", () => {
  it("HLS 網址在支援 MSE 時改用 hls.js 載入，且不直接設 src", async () => {
    await render(HLS_URL);
    expect(hls.instances).toHaveLength(1);
    expect(hls.instances[0].loadSource).toHaveBeenCalledWith(HLS_URL);
    expect(hls.instances[0].attachMedia).toHaveBeenCalledWith(video());
    expect(video().getAttribute("src")).toBeNull();
  });

  it("不支援 MSE 但可原生播放 HLS（Safari）時直接用原生 src", async () => {
    hls.supported = false;
    vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockImplementation((type) =>
      type === "application/vnd.apple.mpegurl" ? "maybe" : "");
    await render(HLS_URL);
    expect(hls.instances).toHaveLength(0);
    expect(video().getAttribute("src")).toBe(HLS_URL);
  });

  it("mp4 維持原生 src，不載入 hls.js", async () => {
    await render(MP4_URL);
    expect(hls.instances).toHaveLength(0);
    expect(video().getAttribute("src")).toBe(MP4_URL);
  });

  it("換網址或卸載時銷毀 hls 實例", async () => {
    await render(HLS_URL);
    const first = hls.instances[0];
    await render("https://customer-test.cloudflarestream.com/other.fixture/manifest/video.m3u8");
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(hls.instances).toHaveLength(2);
    await act(async () => root.unmount());
    expect(hls.instances[1].destroy).toHaveBeenCalledTimes(1);
    root = createRoot(container);
  });

  it("不安全網址顯示警示且不渲染 video", async () => {
    await render("javascript:alert(1)");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("無法安全預覽");
    expect(container.querySelector("video")).toBeNull();
    expect(hls.instances).toHaveLength(0);
  });

  it("播放速度與時間軸事件觸發仍然有效", async () => {
    await render(MP4_URL);
    const el = video();
    await act(async () => { el.dispatchEvent(new Event("loadedmetadata")); });
    expect(el.playbackRate).toBe(2);
    expect(container.textContent).toContain("尚未觸發時間軸事件");
    Object.defineProperty(el, "currentTime", { value: 6, configurable: true });
    await act(async () => { el.dispatchEvent(new Event("timeupdate")); });
    expect(container.textContent).toContain("已觸發：優惠");
  });
});
