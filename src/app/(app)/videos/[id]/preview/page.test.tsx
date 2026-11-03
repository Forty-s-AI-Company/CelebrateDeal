import { generateKeyPairSync } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  findFirst: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ video: { findFirst: mocks.findFirst } }) }));
vi.mock("@/components/promo-video-player", () => ({
  PromoVideoPlayer: ({ src, title }: { src: string; title: string }) => <div data-testid="promo-player" data-src={src}>{title}</div>,
}));
vi.mock("@/components/ui", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ButtonLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  PageHeader: ({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) => <header><h1>{title}</h1><p>{description}</p>{action}</header>,
}));

import VideoPreviewPage from "./page";

const baseVideo = {
  id: "video-1",
  vendorId: "vendor-1",
  title: "夏季研討會",
  description: "影片說明",
  sourceType: "cloudflare_stream",
  videoUrl: "https://provider.example.test/video.m3u8",
  status: "ready",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.findFirst.mockResolvedValue(baseVideo);
});

describe("video merchant preview", () => {
  it("requires the vendor scope and renders the player for ready video", async () => {
    const html = renderToStaticMarkup(await VideoPreviewPage({ params: Promise.resolve({ id: "video-1" }) }));
    expect(mocks.findFirst).toHaveBeenCalledWith({ where: { id: "video-1", vendorId: "vendor-1" } });
    expect(html).toContain('data-testid="promo-player"');
    expect(html).toContain('data-src="https://provider.example.test/video.m3u8"');
    expect(html).toContain("夏季研討會");
  });

  it("keeps archived previews playable but warns that the asset is archived", async () => {
    mocks.findFirst.mockResolvedValue({
      ...baseVideo,
      title: "封存研討會回放",
      videoUrl: "https://provider.example.test/archived-video.m3u8",
      status: "archived",
    });
    const html = renderToStaticMarkup(await VideoPreviewPage({ params: Promise.resolve({ id: "video-1" }) }));
    expect(html).toContain('data-testid="promo-player"');
    expect(html).toContain('data-src="https://provider.example.test/archived-video.m3u8"');
    expect(html).toContain("封存研討會回放");
    expect(html).toContain("已封存");
    expect(html).toContain("不建議綁定新的直播場次");
  });

  it.each(["processing", "error", "unknown"])("fails closed for %s status", async (status) => {
    mocks.findFirst.mockResolvedValue({ ...baseVideo, status });
    const html = renderToStaticMarkup(await VideoPreviewPage({ params: Promise.resolve({ id: "video-1" }) }));
    expect(html).not.toContain("data-testid=\"promo-player\"");
    expect(html).toContain("安全停止載入");
  });

  it("fails closed for an empty playback URL", async () => {
    mocks.findFirst.mockResolvedValue({ ...baseVideo, videoUrl: "   " });
    const html = renderToStaticMarkup(await VideoPreviewPage({ params: Promise.resolve({ id: "video-1" }) }));
    expect(html).not.toContain("data-testid=\"promo-player\"");
    expect(html).toContain("影片目前無法播放");
  });

  it("does not return a missing or foreign video", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(VideoPreviewPage({ params: Promise.resolve({ id: "other-video" }) })).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledExactlyOnceWith();
  });

  describe("with Stream signing configured (F-093)", () => {
    const uid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const streamUrl = `https://videodelivery.net/${uid}/manifest/video.m3u8`;

    beforeEach(() => {
      // Synthetic key generated per run; never a real Cloudflare signing key.
      vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "0123456789abcdef0123456789abcdef");
      vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
        .export({ format: "pem", type: "pkcs1" }).toString());
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("plays a token URL for the vendor's own Cloudflare video", async () => {
      mocks.findFirst.mockResolvedValue({ ...baseVideo, videoUrl: streamUrl, cloudflareStreamUid: uid, cloudflarePlaybackId: uid, cloudflareLiveInputUid: null });
      const html = renderToStaticMarkup(await VideoPreviewPage({ params: Promise.resolve({ id: "video-1" }) }));
      expect(html).toMatch(/data-src="https:\/\/videodelivery\.net\/[\w-]+\.[\w-]+\.[\w-]+\/manifest\/video\.m3u8"/);
      expect(html).not.toContain(uid);
    });

    it("leaves a merchant-entered url video with a Stream URL unsigned", async () => {
      mocks.findFirst.mockResolvedValue({ ...baseVideo, sourceType: "url", videoUrl: streamUrl, cloudflareStreamUid: null, cloudflarePlaybackId: null, cloudflareLiveInputUid: null });
      const html = renderToStaticMarkup(await VideoPreviewPage({ params: Promise.resolve({ id: "video-1" }) }));
      expect(html).toContain(`data-src="${streamUrl}"`);
    });
  });
});
