import { renderToStaticMarkup } from "react-dom/server";
import type { Video } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ upsertVideoAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));

import { VideoForm } from "./video-form";

function video(overrides: Partial<Video> = {}): Video {
  return {
    id: "test-fixture-video-1",
    vendorId: "test-fixture-vendor-1",
    title: "測試影片",
    description: null,
    sourceType: "cloudflare_stream",
    videoUrl: "https://media.example.test/provider-playback.m3u8",
    thumbnailUrl: null,
    durationSec: 60,
    status: "processing",
    cloudflareStreamUid: "test-fixture-provider-uid",
    cloudflareLiveInputUid: null,
    cloudflarePlaybackId: "test-fixture-provider-playback-id",
    cloudflareReadyToStream: false,
    liveStreamKey: null,
    liveInputStatus: null,
    estimatedMinutes: 1,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("VideoForm", () => {
  it("renders provider metadata as status only without writable provider fields", () => {
    const markup = renderToStaticMarkup(<VideoForm video={video()} />);

    expect(markup).toContain("Cloudflare 播放來源");
    expect(markup).toContain("Provider 狀態：processing");
    expect(markup).not.toContain('name="sourceType"');
    expect(markup).not.toContain('name="videoUrl"');
    expect(markup).not.toContain('name="cloudflareStreamUid"');
    expect(markup).not.toContain('name="cloudflareLiveInputUid"');
    expect(markup).not.toContain('name="cloudflarePlaybackId"');
    expect(markup).not.toContain('name="cloudflareReadyToStream"');
    expect(markup).not.toContain('name="liveInputStatus"');
  });

  it("keeps URL and archive controls for an external URL video", () => {
    const markup = renderToStaticMarkup(
      <VideoForm video={video({ sourceType: "url", status: "ready" })} />,
    );

    expect(markup).toContain('name="videoUrl"');
    expect(markup).toContain('name="status"');
    expect(markup).not.toContain('value="processing"');
    expect(markup).not.toContain('name="cloudflareStreamUid"');
  });
});
