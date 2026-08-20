import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDirectCreatorUpload: vi.fn(),
  createResumableCreatorUpload: vi.fn(),
  getStreamVideoStatus: vi.fn(),
  createLiveInput: vi.fn(),
  liveFindFirst: vi.fn(),
  liveUpdateMany: vi.fn(),
  vendorFindUnique: vi.fn(),
  videoCreate: vi.fn(),
  videoFindFirst: vi.fn(),
  videoUpdate: vi.fn(),
  videoUpdateMany: vi.fn(),
  videoLockQueryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/cloudflare-stream", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloudflare-stream")>();
  return {
    ...actual,
    createDirectCreatorUpload: mocks.createDirectCreatorUpload,
    createResumableCreatorUpload: mocks.createResumableCreatorUpload,
    getStreamVideoStatus: mocks.getStreamVideoStatus,
    createLiveInput: mocks.createLiveInput,
  };
});

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    $transaction: mocks.transaction,
    vendor: { findUnique: mocks.vendorFindUnique },
    video: {
      create: mocks.videoCreate,
      findFirst: mocks.videoFindFirst,
      update: mocks.videoUpdate,
      updateMany: mocks.videoUpdateMany,
    },
    live: {
      findFirst: mocks.liveFindFirst,
      updateMany: mocks.liveUpdateMany,
    },
  }),
}));

import {
  classifyCloudflareOperationError,
  completeResumableUploadMapping,
  createDirectUploadMapping,
  createLiveInputMapping,
  createResumableUploadSession,
} from "./cloudflare-ops";
import { decryptSensitiveValue } from "./sensitive-data";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "test-csrf-secret-for-cloudflare-ops-32-bytes");
  mocks.vendorFindUnique.mockResolvedValue({ id: "vendor-1" });
  mocks.videoFindFirst.mockResolvedValue(null);
  mocks.liveFindFirst.mockResolvedValue(null);
  mocks.createDirectCreatorUpload.mockResolvedValue({
    uid: "upload-1",
    uploadURL: "https://upload.example.test/upload-1",
  });
  mocks.createResumableCreatorUpload.mockResolvedValue({
    uid: "resumable-1",
    uploadURL: "https://upload.videodelivery.net/tus/resumable-1",
  });
  mocks.createLiveInput.mockResolvedValue({ uid: "live-input-1" });
  mocks.getStreamVideoStatus.mockResolvedValue({
    uid: "resumable-1",
    readyToStream: false,
    status: { state: "queued" },
  });
  mocks.videoCreate.mockResolvedValue({ id: "video-new" });
  mocks.videoUpdate.mockResolvedValue({ id: "video-1" });
  mocks.videoUpdateMany.mockResolvedValue({ count: 1 });
  mocks.videoLockQueryRaw.mockResolvedValue([{ id: "video-1", status: "ready" }]);
  mocks.transaction.mockImplementation(async (callback: (transaction: unknown) => unknown) => callback({
    $queryRaw: mocks.videoLockQueryRaw,
    video: {
      updateMany: mocks.videoUpdateMany,
      findFirst: mocks.videoFindFirst,
    },
  }));
  mocks.liveUpdateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Cloudflare tenant resource preflight", () => {
  it.each([
    ["P2022", "database_schema", 503],
    ["P1001", "database_unavailable", 503],
    ["P2003", "database_constraint", 409],
  ])("classifies Prisma %s without exposing database details", (code, expectedCode, status) => {
    expect(classifyCloudflareOperationError({ code, message: "sensitive database details" })).toEqual({
      code: expectedCode,
      providerStatus: null,
      status,
    });
  });
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
      select: { id: true, status: true },
    });
    expect(mocks.createDirectCreatorUpload).not.toHaveBeenCalled();
  });

  it("rejects direct replacement of an archived video before calling Cloudflare", async () => {
    mocks.videoFindFirst.mockResolvedValue({ id: "video-archived", status: "archived" });

    await expect(createDirectUploadMapping({
      vendorId: "vendor-1",
      videoId: "video-archived",
      title: "Archived replacement",
      maxDurationSeconds: 120,
    })).rejects.toMatchObject({ code: "video_archived" });

    expect(mocks.createDirectCreatorUpload).not.toHaveBeenCalled();
    expect(mocks.videoUpdateMany).not.toHaveBeenCalled();
  });

  it("rechecks the row lock before provisioning when archive wins the race", async () => {
    mocks.videoFindFirst.mockResolvedValue({ id: "video-race", status: "ready" });
    mocks.videoLockQueryRaw.mockResolvedValue([{ id: "video-race", status: "archived" }]);

    await expect(createDirectUploadMapping({
      vendorId: "vendor-1",
      videoId: "video-race",
      title: "Race replacement",
      maxDurationSeconds: 120,
    })).rejects.toMatchObject({ code: "video_archived" });

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

    expect(mocks.videoUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "video-1", vendorId: "vendor-1", status: { not: "archived" } },
    }));
    expect(mocks.videoCreate).not.toHaveBeenCalled();
  });

  it("does not replace an existing video until tus completion is provider-verified", async () => {
    mocks.videoFindFirst.mockResolvedValue({ id: "video-1" });

    const session = await createResumableUploadSession({
      vendorId: "vendor-1",
      videoId: "video-1",
      title: "Large launch video",
      fileName: "launch.mp4",
      mimeType: "video/mp4",
      sizeBytes: 250 * 1024 * 1024,
      maxDurationSeconds: 600,
    });

    expect(mocks.createResumableCreatorUpload).toHaveBeenCalledWith({
      fileName: "launch.mp4",
      mimeType: "video/mp4",
      sizeBytes: 250 * 1024 * 1024,
      maxDurationSeconds: 600,
    });
    expect(session).toMatchObject({
      videoId: "video-1",
      uploadURL: "https://upload.videodelivery.net/tus/resumable-1",
    });
    expect(session.uploadTicket).not.toContain("resumable-1");
    expect(mocks.videoUpdate).not.toHaveBeenCalled();
    expect(mocks.videoCreate).not.toHaveBeenCalled();

    mocks.videoFindFirst.mockResolvedValue({ id: "video-1", cloudflareStreamUid: "old-upload" });
    await expect(completeResumableUploadMapping({
      vendorId: "vendor-1",
      uploadTicket: session.uploadTicket,
    })).resolves.toMatchObject({ video: { id: "video-1" } });

    expect(mocks.getStreamVideoStatus).toHaveBeenCalledWith("resumable-1");
    expect(mocks.videoUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "video-1", vendorId: "vendor-1", status: { not: "archived" } },
      data: expect.objectContaining({
        cloudflareStreamUid: "resumable-1",
        status: "processing",
      }),
    }));
  });

  it("rejects a resumable completion that became archived after ticket creation", async () => {
    mocks.videoFindFirst.mockResolvedValue({ id: "video-1", status: "ready" });
    const session = await createResumableUploadSession({
      vendorId: "vendor-1",
      videoId: "video-1",
      title: "Race replacement",
      fileName: "race.mp4",
      mimeType: "video/mp4",
      sizeBytes: 250 * 1024 * 1024,
      maxDurationSeconds: 600,
    });
    mocks.videoFindFirst.mockResolvedValue({ id: "video-1", status: "archived", cloudflareStreamUid: "old-upload" });

    await expect(completeResumableUploadMapping({
      vendorId: "vendor-1",
      uploadTicket: session.uploadTicket,
    })).rejects.toMatchObject({ code: "video_archived" });
    expect(mocks.getStreamVideoStatus).not.toHaveBeenCalled();
  });

  it("creates a deterministic local video id only after tus completion and is replay-safe", async () => {
    const session = await createResumableUploadSession({
      vendorId: "vendor-1",
      title: "New large video",
      fileName: "new.mp4",
      mimeType: "video/mp4",
      sizeBytes: 250 * 1024 * 1024,
      maxDurationSeconds: 600,
    });
    expect(session.videoId).toMatch(/^upload_[0-9a-f-]+$/);
    expect(mocks.videoCreate).not.toHaveBeenCalled();

    mocks.videoCreate.mockResolvedValue({ id: session.videoId });
    await completeResumableUploadMapping({ vendorId: "vendor-1", uploadTicket: session.uploadTicket });
    expect(mocks.videoCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ id: session.videoId, cloudflareStreamUid: "resumable-1" }),
    }));

    vi.clearAllMocks();
    mocks.vendorFindUnique.mockResolvedValue({ id: "vendor-1" });
    mocks.videoFindFirst.mockResolvedValue({ id: session.videoId, cloudflareStreamUid: "resumable-1" });
    mocks.getStreamVideoStatus.mockResolvedValue({
      uid: "resumable-1",
      readyToStream: false,
      status: { state: "queued" },
    });
    await completeResumableUploadMapping({ vendorId: "vendor-1", uploadTicket: session.uploadTicket });
    expect(mocks.videoCreate).not.toHaveBeenCalled();
    expect(mocks.videoUpdate).not.toHaveBeenCalled();
  });

  it("does not create or replace a Video while Cloudflare still reports pendingupload", async () => {
    const session = await createResumableUploadSession({
      vendorId: "vendor-1",
      title: "Pending large video",
      fileName: "pending.mp4",
      mimeType: "video/mp4",
      sizeBytes: 250 * 1024 * 1024,
      maxDurationSeconds: 600,
    });
    mocks.getStreamVideoStatus.mockResolvedValue({
      uid: "resumable-1",
      readyToStream: false,
      status: { state: "pendingupload" },
    });

    await expect(completeResumableUploadMapping({
      vendorId: "vendor-1",
      uploadTicket: session.uploadTicket,
    })).rejects.toMatchObject({ name: "CloudflareUploadNotCompleteError" });
    expect(mocks.videoCreate).not.toHaveBeenCalled();
    expect(mocks.videoUpdate).not.toHaveBeenCalled();
  });

  it("preserves the previous Video when Cloudflare reports a failed asset", async () => {
    mocks.videoFindFirst.mockResolvedValue({ id: "video-1" });
    const session = await createResumableUploadSession({
      vendorId: "vendor-1",
      videoId: "video-1",
      title: "Broken replacement",
      fileName: "broken.mp4",
      mimeType: "video/mp4",
      sizeBytes: 250 * 1024 * 1024,
      maxDurationSeconds: 600,
    });
    mocks.videoFindFirst.mockResolvedValue({ id: "video-1", cloudflareStreamUid: "old-working-upload" });
    mocks.getStreamVideoStatus.mockResolvedValue({
      uid: "resumable-1",
      readyToStream: false,
      status: { state: "error" },
    });

    await expect(completeResumableUploadMapping({
      vendorId: "vendor-1",
      uploadTicket: session.uploadTicket,
    })).rejects.toMatchObject({ name: "CloudflareUploadFailedError" });
    expect(mocks.videoCreate).not.toHaveBeenCalled();
    expect(mocks.videoUpdate).not.toHaveBeenCalled();
  });

  it("encrypts a returned live stream key before database persistence", async () => {
    const plaintextStreamKey = "test-fixture-plaintext-stream-key";
    mocks.createLiveInput.mockResolvedValue({
      uid: "live-input-1",
      rtmps: { url: "rtmps://live.example.test", streamKey: plaintextStreamKey },
    });

    await createLiveInputMapping({ vendorId: "vendor-1", name: "Test live" });

    const stored = mocks.videoCreate.mock.calls[0]?.[0].data.liveStreamKey as string;
    expect(stored).not.toContain(plaintextStreamKey);
    expect(decryptSensitiveValue(stored, "cloudflare-live-stream-key")).toBe(plaintextStreamKey);
  });
});
