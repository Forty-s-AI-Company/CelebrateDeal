import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDirectCreatorUpload,
  createLiveInput,
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
        uploadURL: "https://upload.example.test/upload-1",
        secretProviderField: "must-not-be-returned",
      },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(createDirectCreatorUpload(120)).resolves.toEqual({
      uid: "upload-1",
      uploadURL: "https://upload.example.test/upload-1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/test-fixture-account/stream/direct_upload",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
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
