import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDirectCreatorUpload: vi.fn(),
  createLiveInput: vi.fn(),
  liveFindFirst: vi.fn(),
  liveUpdateMany: vi.fn(),
  vendorFindUnique: vi.fn(),
  videoCreate: vi.fn(),
  videoFindFirst: vi.fn(),
  videoUpdate: vi.fn(),
}));

vi.mock("@/lib/cloudflare-stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloudflare-stream")>();
  return {
    ...actual,
    createDirectCreatorUpload: mocks.createDirectCreatorUpload,
    createLiveInput: mocks.createLiveInput,
  };
});

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendor: { findUnique: mocks.vendorFindUnique },
    video: {
      create: mocks.videoCreate,
      findFirst: mocks.videoFindFirst,
      update: mocks.videoUpdate,
    },
    live: {
      findFirst: mocks.liveFindFirst,
      updateMany: mocks.liveUpdateMany,
    },
  }),
}));

import { createDirectUploadMapping, createLiveInputMapping } from "./cloudflare-ops";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.vendorFindUnique.mockResolvedValue({ id: "vendor-1" });
  mocks.videoFindFirst.mockResolvedValue(null);
  mocks.liveFindFirst.mockResolvedValue(null);
  mocks.createDirectCreatorUpload.mockResolvedValue({
    uid: "upload-1",
    uploadURL: "https://upload.example.test/upload-1",
  });
  mocks.createLiveInput.mockResolvedValue({ uid: "live-input-1" });
  mocks.videoCreate.mockResolvedValue({ id: "video-new" });
  mocks.videoUpdate.mockResolvedValue({ id: "video-1" });
  mocks.liveUpdateMany.mockResolvedValue({ count: 1 });
});

describe("Cloudflare tenant resource preflight", () => {
  it("does not create an external upload for an unknown vendor", async () => {
    mocks.vendorFindUnique.mockResolvedValue(null);

    await expect(createDirectUploadMapping({
      vendorId: "unknown-vendor",
      title: "Test upload",
      maxDurationSeconds: 120,
    })).rejects.toMatchObject({ code: "vendor_not_found" });

    expect(mocks.createDirectCreatorUpload).not.toHaveBeenCalled();
    expect(mocks.videoCreate).not.toHaveBeenCalled();
  });

  it("does not create an external upload when the requested video belongs to another tenant", async () => {
    await expect(createDirectUploadMapping({
      vendorId: "vendor-1",
      videoId: "other-tenant-video",
      title: "Test upload",
      maxDurationSeconds: 120,
    })).rejects.toMatchObject({ code: "video_not_found" });

    expect(mocks.videoFindFirst).toHaveBeenCalledWith({
      where: { id: "other-tenant-video", vendorId: "vendor-1" },
      select: { id: true },
    });
    expect(mocks.createDirectCreatorUpload).not.toHaveBeenCalled();
  });

  it("does not create an external live input when the requested live belongs to another tenant", async () => {
    await expect(createLiveInputMapping({
      vendorId: "vendor-1",
      liveId: "other-tenant-live",
      name: "Test live",
    })).rejects.toMatchObject({ code: "live_not_found" });

    expect(mocks.liveFindFirst).toHaveBeenCalledWith({
      where: { id: "other-tenant-live", vendorId: "vendor-1" },
      select: { id: true },
    });
    expect(mocks.createLiveInput).not.toHaveBeenCalled();
  });

  it("updates only the prevalidated tenant video", async () => {
    mocks.videoFindFirst.mockResolvedValue({ id: "video-1" });

    await expect(createDirectUploadMapping({
      vendorId: "vendor-1",
      videoId: "video-1",
      title: "Test upload",
      maxDurationSeconds: 120,
    })).resolves.toMatchObject({ video: { id: "video-1" } });

    expect(mocks.videoUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "video-1", vendorId: "vendor-1" },
    }));
    expect(mocks.videoCreate).not.toHaveBeenCalled();
  });
});
