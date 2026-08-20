import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { isHlsVideoUrl, PromoVideoPlayer, shouldRenderPromoVideo } from "./promo-video-player";

describe("PromoVideoPlayer", () => {
  it("renders a safe video with controls, inline playback and metadata preload without autoplay", () => {
    const html = renderToStaticMarkup(<PromoVideoPlayer src="https://cdn.example.test/promo.mp4" title="活動預告" />);

    expect(html).toContain("controls");
    expect(html).toContain("playsInline");
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('aria-label="活動預告"');
    expect(html).not.toContain("autoplay");
  });

  it("fails closed for unsafe sources and recognises HLS manifests", () => {
    const html = renderToStaticMarkup(<PromoVideoPlayer src="javascript:alert(1)" title="不安全影片" />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("重試播放");
    expect(html).not.toContain("<video");
    expect(isHlsVideoUrl("https://cdn.example.test/path/manifest.m3u8?token=fixture")).toBe(true);
    expect(isHlsVideoUrl("https://cdn.example.test/promo.mp4")).toBe(false);
  });

  it("recovers the player when a new safe source replaces a failed source", () => {
    const firstSource = "https://cdn.example.test/first.mp4";
    const nextSource = "https://cdn.example.test/next.mp4";

    expect(shouldRenderPromoVideo(firstSource, firstSource)).toBe(false);
    expect(shouldRenderPromoVideo(nextSource, firstSource)).toBe(true);
    expect(shouldRenderPromoVideo(firstSource, null)).toBe(true);
  });
});
