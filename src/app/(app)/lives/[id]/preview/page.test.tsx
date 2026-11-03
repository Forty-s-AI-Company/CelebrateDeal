import { generateKeyPairSync } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  findFirst: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ live: { findFirst: mocks.findFirst } }) }));
vi.mock("@/components/evergreen-preview-player", () => ({
  EvergreenPreviewPlayer: ({ videoUrl }: { videoUrl: string }) => <div data-testid="evergreen-preview" data-src={videoUrl} />,
}));
vi.mock("@/components/ui", () => ({
  ButtonLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
  Card: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  PageHeader: ({ title }: { title: string }) => <header><h1>{title}</h1></header>,
}));

import LivePreviewPage from "./page";

const uid = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const streamUrl = `https://videodelivery.net/${uid}/manifest/video.m3u8`;

function liveRecord(videoOverrides: Record<string, unknown> = {}) {
  return {
    id: "live-1",
    slug: "launch",
    title: "新品發表",
    description: "說明",
    isEvergreen: true,
    evergreenPreviewEnabled: true,
    evergreenPreviewRate: 1,
    presenterLayout: null,
    heroImageUrl: null,
    streamMode: "vod",
    cloudflareLiveInputUid: null,
    liveReminderOffsetMinutes: 10,
    products: [],
    form: null,
    messageTemplate: null,
    liveReminderTemplate: null,
    interactionScript: null,
    video: {
      vendorId: "vendor-1",
      title: "主影片",
      durationSec: 600,
      sourceType: "cloudflare_stream",
      videoUrl: streamUrl,
      cloudflareStreamUid: uid,
      cloudflarePlaybackId: uid,
      cloudflareLiveInputUid: null,
      ...videoOverrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  // Synthetic key generated per run; never a real Cloudflare signing key.
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "0123456789abcdef0123456789abcdef");
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
    .export({ format: "pem", type: "pkcs1" }).toString());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function render() {
  return renderToStaticMarkup(await LivePreviewPage({ params: Promise.resolve({ id: "live-1" }) }));
}

describe("live merchant preview (F-093)", () => {
  it("loads the live in the vendor scope and previews its own Cloudflare video through a token URL", async () => {
    mocks.findFirst.mockResolvedValue(liveRecord());
    const html = await render();

    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "live-1", vendorId: "vendor-1" } }));
    expect(html).toMatch(/data-src="https:\/\/videodelivery\.net\/[\w-]+\.[\w-]+\.[\w-]+\/manifest\/video\.m3u8"/);
    expect(html).not.toContain(uid);
  });

  it("shows no player for a bound video owned by another vendor", async () => {
    mocks.findFirst.mockResolvedValue(liveRecord({ vendorId: "vendor-2" }));
    const html = await render();
    expect(html).not.toContain('data-testid="evergreen-preview"');
  });

  it("leaves a merchant-entered url video unsigned", async () => {
    mocks.findFirst.mockResolvedValue(liveRecord({ sourceType: "url", cloudflareStreamUid: null, cloudflarePlaybackId: null }));
    const html = await render();
    expect(html).toContain(`data-src="${streamUrl}"`);
  });
});
