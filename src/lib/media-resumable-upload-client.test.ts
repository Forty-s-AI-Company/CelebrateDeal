import { afterEach, describe, expect, it, vi } from "vitest";

const tus = vi.hoisted(() => ({
  abort: vi.fn<() => Promise<void>>(),
  mode: "success" as "success" | "pending" | "provider-error" | "network-error",
  options: null as null | Record<string, unknown>,
}));

vi.mock("tus-js-client", () => ({
  Upload: class {
    constructor(_file: File, options: Record<string, unknown>) {
      tus.options = options;
    }

    start() {
      const onProgress = tus.options?.onProgress as ((sent: number, total: number) => void) | undefined;
      const onSuccess = tus.options?.onSuccess as (() => void) | undefined;
      const onError = tus.options?.onError as ((error: unknown) => void) | undefined;
      if (tus.mode === "success") {
        onProgress?.(25, 100);
        onSuccess?.();
      } else if (tus.mode === "provider-error") {
        onError?.({ originalResponse: { status: 403 } });
      } else if (tus.mode === "network-error") {
        onError?.(new Error("offline"));
      }
    }

    abort() {
      return tus.abort();
    }
  },
}));

import { CLOUDFLARE_TUS_CHUNK_BYTES } from "@/lib/media-upload-limits";
import { uploadResumableFileWithProgress } from "./media-upload-client";

function videoFile() {
  return new File(["video"], "launch.mp4", { type: "video/mp4" });
}

afterEach(() => {
  tus.abort.mockReset();
  tus.abort.mockResolvedValue();
  tus.mode = "success";
  tus.options = null;
});

describe("uploadResumableFileWithProgress", () => {
  it("uses Cloudflare-compatible chunks, retry delays, progress, and fingerprint cleanup", async () => {
    const progress = vi.fn();

    await expect(uploadResumableFileWithProgress({
      url: "https://upload.videodelivery.net/tus/upload-1",
      file: videoFile(),
      videoId: "video-1",
      onProgress: progress,
    })).resolves.toBeUndefined();

    expect(progress).toHaveBeenCalledWith(25);
    expect(tus.options).toMatchObject({
      uploadUrl: "https://upload.videodelivery.net/tus/upload-1",
      chunkSize: CLOUDFLARE_TUS_CHUNK_BYTES,
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      metadata: expect.objectContaining({ celebratedealVideoId: "video-1" }),
    });
  });

  it("keeps cancellation distinct from provider and network failures", async () => {
    tus.mode = "pending";
    const controller = new AbortController();
    const cancelled = uploadResumableFileWithProgress({
      url: "https://upload.videodelivery.net/tus/upload-1",
      file: videoFile(),
      videoId: "video-1",
      signal: controller.signal,
      onProgress: vi.fn(),
    });
    controller.abort();

    await expect(cancelled).rejects.toMatchObject({ code: "cancelled" });
    expect(tus.abort).toHaveBeenCalledOnce();

    tus.mode = "provider-error";
    await expect(uploadResumableFileWithProgress({
      url: "https://upload.videodelivery.net/tus/upload-2",
      file: videoFile(),
      videoId: "video-2",
      onProgress: vi.fn(),
    })).rejects.toMatchObject({ code: "provider_rejected" });

    tus.mode = "network-error";
    await expect(uploadResumableFileWithProgress({
      url: "https://upload.videodelivery.net/tus/upload-3",
      file: videoFile(),
      videoId: "video-3",
      onProgress: vi.fn(),
    })).rejects.toMatchObject({ code: "network_error" });
  });

  it("refuses a tampered resumable destination before reading the file", async () => {
    await expect(uploadResumableFileWithProgress({
      url: "https://attacker.example/upload",
      file: videoFile(),
      videoId: "video-1",
      onProgress: vi.fn(),
    })).rejects.toMatchObject({ code: "invalid_response" });
    expect(tus.options).toBeNull();
  });
});
