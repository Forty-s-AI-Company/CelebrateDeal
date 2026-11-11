import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  videoFindFirst: vi.fn(),
  videoUpdate: vi.fn(),
  videoCreate: vi.fn(),
  resolveReadyImageAsset: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ video: { findFirst: mocks.videoFindFirst, update: mocks.videoUpdate, create: mocks.videoCreate } }),
}));
vi.mock("@/lib/image-assets", () => ({ resolveReadyImageAsset: mocks.resolveReadyImageAsset }));

import { saveVideo } from "./video-save";

function input(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const createdUrlRow = {
  id: "video-new",
  sourceType: "url",
  status: "ready",
  cloudflareReadyToStream: false,
  cloudflareLiveInputUid: null,
  liveInputStatus: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveReadyImageAsset.mockResolvedValue(null);
  mocks.videoCreate.mockResolvedValue(createdUrlRow);
  mocks.videoUpdate.mockResolvedValue({ id: "video-1" });
});

describe("saveVideo", () => {
  it("creates a ready external URL video for the given vendor and reports it as live ready", async () => {
    const result = await saveVideo("vendor-1", input({ title: " 週五講座 ", videoUrl: "https://media.example.test/a.mp4", durationSec: "0", estimatedMinutes: "0" }));

    expect(result).toEqual({ ok: true, video: { id: "video-new", title: "週五講座", created: true, liveReady: true } });
    expect(mocks.videoCreate).toHaveBeenCalledWith({
      data: {
        title: "週五講座",
        description: null,
        thumbnailUrl: null,
        thumbnailAssetId: null,
        durationSec: 0,
        estimatedMinutes: 0,
        vendorId: "vendor-1",
        sourceType: "url",
        videoUrl: "https://media.example.test/a.mp4",
        status: "ready",
      },
    });
  });

  it("ignores a forged vendorId and provider fields in the form data", async () => {
    await saveVideo("vendor-1", input({
      title: "x",
      videoUrl: "https://media.example.test/a.mp4",
      vendorId: "vendor-forged",
      sourceType: "cloudflare_live",
      status: "processing",
      cloudflareStreamUid: "forged",
      cloudflareReadyToStream: "true",
    }));

    const data = mocks.videoCreate.mock.calls[0]![0].data;
    expect(data).toMatchObject({ vendorId: "vendor-1", sourceType: "url", status: "ready" });
    expect(data).not.toHaveProperty("cloudflareStreamUid");
    expect(data).not.toHaveProperty("cloudflareReadyToStream");
  });

  it.each([
    ["javascript:alert(1)"],
    ["//cdn.example.test/a.mp4"],
    ["https://user:pass@cdn.example.test/a.mp4"],
    [""],
  ])("refuses the unsafe or missing URL %j without writing", async (videoUrl) => {
    const result = await saveVideo("vendor-1", input({ title: "x", videoUrl }));

    expect(result).toEqual({ ok: false, reason: "invalid_video" });
    expect(mocks.videoCreate).not.toHaveBeenCalled();
  });

  it("refuses invalid manual metadata without writing", async () => {
    const result = await saveVideo("vendor-1", input({ title: "x", videoUrl: "https://media.example.test/a.mp4", durationSec: "-1" }));

    expect(result).toEqual({ ok: false, reason: "invalid_video" });
    expect(mocks.videoCreate).not.toHaveBeenCalled();
  });

  it("reports a thumbnail asset outside the vendor as invalid_image_asset", async () => {
    mocks.resolveReadyImageAsset.mockRejectedValueOnce(new Error("not this vendor's asset"));

    const result = await saveVideo("vendor-1", input({ title: "x", videoUrl: "https://media.example.test/a.mp4", thumbnailAssetId: "asset-foreign" }));

    expect(result).toEqual({ ok: false, reason: "invalid_image_asset" });
    expect(mocks.resolveReadyImageAsset).toHaveBeenCalledWith(expect.anything(), { vendorId: "vendor-1", assetId: "asset-foreign" });
    expect(mocks.videoCreate).not.toHaveBeenCalled();
  });

  it("updates only a video of the given vendor and reports a foreign id as not_found", async () => {
    mocks.videoFindFirst.mockResolvedValueOnce(null);

    const result = await saveVideo("vendor-1", input({ id: "video-foreign", title: "x", videoUrl: "https://media.example.test/a.mp4" }));

    expect(result).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.videoFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "video-foreign", vendorId: "vendor-1" } }));
    expect(mocks.videoUpdate).not.toHaveBeenCalled();
    expect(mocks.videoCreate).not.toHaveBeenCalled();
  });

  it("refuses an over-long id and a processing provider video", async () => {
    expect(await saveVideo("vendor-1", input({ id: "x".repeat(129) }))).toEqual({ ok: false, reason: "invalid_id" });
    mocks.videoFindFirst.mockResolvedValueOnce({ id: "video-1", sourceType: "cloudflare_stream", status: "processing", cloudflareReadyToStream: false, cloudflareLiveInputUid: null, liveInputStatus: null });
    expect(await saveVideo("vendor-1", input({ id: "video-1", title: "x" }))).toEqual({ ok: false, reason: "video_processing" });
    expect(mocks.videoUpdate).not.toHaveBeenCalled();
  });

  it("archives an external URL video and reports it as not live ready", async () => {
    mocks.videoFindFirst.mockResolvedValueOnce({ id: "video-1", sourceType: "url", status: "ready", cloudflareReadyToStream: false, cloudflareLiveInputUid: null, liveInputStatus: null });

    const result = await saveVideo("vendor-1", input({ id: "video-1", title: "x", videoUrl: "https://media.example.test/b.mp4", status: "archived" }));

    expect(result).toEqual({ ok: true, video: { id: "video-1", title: "x", created: false, liveReady: false } });
    expect(mocks.videoUpdate).toHaveBeenCalledWith({
      where: { id: "video-1", vendorId: "vendor-1" },
      data: expect.objectContaining({ status: "archived", videoUrl: "https://media.example.test/b.mp4" }),
    });
  });
});
