import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDirectCreatorUpload,
  createLiveInput,
  createResumableCreatorUpload,
  getStreamVideoStatus,
} from "./cloudflare-stream";

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-fixture-account");
  vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", "test-fixture-token");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Cloudflare Stream API", () => {
  it("fails closed without configuration and never contacts Cloudflare", async () => {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", undefined);
    vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(createDirectCreatorUpload()).rejects.toMatchObject({
      code: "configuration",
      providerStatus: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a bounded request and validates direct-upload responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        uid: "upload-1",
        uploadURL: "https://upload.videodelivery.net/upload-1",
        secretProviderField: "must-not-be-returned",
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createDirectCreatorUpload(120)).resolves.toEqual({
      uid: "upload-1",
      uploadURL: "https://upload.videodelivery.net/upload-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/test-fixture-account/stream/direct_upload",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
  });

  it("creates a direct-creator tus session with bounded server-owned metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, {
      status: 201,
      headers: {
        location: "https://upload.videodelivery.net/tus/upload-1",
        "stream-media-id": "upload-1",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createResumableCreatorUpload({
      fileName: "launch video.mp4",
      mimeType: "video/mp4",
      sizeBytes: 250 * 1024 * 1024,
      maxDurationSeconds: 600,
    })).resolves.toEqual({
      uid: "upload-1",
      uploadURL: "https://upload.videodelivery.net/tus/upload-1",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/test-fixture-account/stream?direct_user=true",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-fixture-token",
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(250 * 1024 * 1024),
          "Upload-Metadata": expect.stringContaining("maxDurationSeconds NjAw"),
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects a tus response that omits the provider media id", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {
      status: 201,
      headers: { location: "https://upload.videodelivery.net/tus/missing-id" },
    })));

    await expect(createResumableCreatorUpload({
      fileName: "launch.mp4",
      mimeType: "video/mp4",
      sizeBytes: 250 * 1024 * 1024,
      maxDurationSeconds: 600,
    })).rejects.toMatchObject({ code: "invalid_response", providerStatus: 201 });
  });

  it("does not expose provider error bodies when Cloudflare rejects a request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      errors: [{ message: "account-token-and-provider-detail" }],
    }), { status: 403 })));

    const promise = createLiveInput("Test live");
    await expect(promise).rejects.toMatchObject({ code: "provider_rejected", providerStatus: 403 });
    await expect(promise).rejects.not.toThrow("account-token-and-provider-detail");
  });

  it("rejects an unknown video payload instead of accepting a partial provider state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { uid: 123, readyToStream: "unknown" },
    }), { status: 200 })));

    await expect(getStreamVideoStatus("video-1")).rejects.toMatchObject({
      code: "invalid_response",
      providerStatus: 200,
    });
  });

  it("maps transport failures to a closed diagnostic category", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network detail with token")));

    await expect(createDirectCreatorUpload()).rejects.toMatchObject({
      code: "network",
      providerStatus: null,
    });
  });
});
