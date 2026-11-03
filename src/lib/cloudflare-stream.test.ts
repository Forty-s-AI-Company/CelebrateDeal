import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDirectCreatorUpload,
  createLiveInput,
  createResumableCreatorUpload,
  getStreamVideoStatus,
  updateLiveInputRecordingSecurity,
  updateStreamVideoPlaybackSecurity,
} from "./cloudflare-stream";

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-fixture-account");
  vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", "test-fixture-token");
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", undefined);
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", undefined);
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_JWK", undefined);
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

  it("accepts Cloudflare's current cloudflarestream.com direct-upload host", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        uid: "upload-current-host",
        uploadURL: "https://upload.cloudflarestream.com/upload-current-host",
      },
    }), { status: 200 })));

    await expect(createDirectCreatorUpload()).resolves.toEqual({
      uid: "upload-current-host",
      uploadURL: "https://upload.cloudflarestream.com/upload-current-host",
    });
  });

  it("rejects lookalike upload hosts even when the response otherwise looks valid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: {
        uid: "upload-lookalike",
        uploadURL: "https://upload.cloudflarestream.com.attacker.invalid/upload-lookalike",
      },
    }), { status: 200 })));

    await expect(createDirectCreatorUpload()).rejects.toMatchObject({
      code: "invalid_response",
      providerStatus: 200,
    });
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

// Synthetic key generated per run; never a real Cloudflare signing key.
const syntheticSigningPem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
  .export({ format: "pem", type: "pkcs8" }).toString();

function enableStreamSigning() {
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", "0123456789abcdef0123456789abcdef");
  vi.stubEnv("CLOUDFLARE_STREAM_SIGNING_KEY_PEM", syntheticSigningPem);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv("STREAM_ALLOWED_ORIGINS", "*.preview.example.test");
  vi.stubEnv("CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS", "true");
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
}

function directUploadResponse() {
  return new Response(JSON.stringify({
    success: true,
    result: { uid: "upload-1", uploadURL: "https://upload.videodelivery.net/upload-1" },
  }), { status: 200 });
}

function liveInputResponse() {
  return new Response(JSON.stringify({ success: true, result: { uid: "live-input-1" } }), { status: 200 });
}

function tusResponse() {
  return new Response(null, {
    status: 201,
    headers: { location: "https://upload.videodelivery.net/tus/upload-1", "stream-media-id": "upload-1" },
  });
}

const tusInput = { fileName: "launch.mp4", mimeType: "video/mp4", sizeBytes: 1024, maxDurationSeconds: 600 };

describe("Cloudflare Stream signed playback settings (F-093)", () => {
  it("keeps upload and live input requests unchanged while signing keys are not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(directUploadResponse())
      .mockResolvedValueOnce(liveInputResponse())
      .mockResolvedValueOnce(tusResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createDirectCreatorUpload(120);
    await createLiveInput("Launch");
    await createResumableCreatorUpload(tusInput);

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ maxDurationSeconds: 120 });
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body))).toEqual({
      meta: { name: "Launch" },
      recording: { mode: "automatic" },
    });
    const metadata = String(fetchMock.mock.calls[2]![1].headers["Upload-Metadata"]);
    expect(metadata).not.toContain("requiresignedurls");
    expect(metadata).not.toContain("allowedorigins");
  });

  it("keeps new uploads public while CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS is not on, even with signing keys", async () => {
    enableStreamSigning();
    vi.stubEnv("CLOUDFLARE_STREAM_LOCK_NEW_UPLOADS", undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(directUploadResponse())
      .mockResolvedValueOnce(liveInputResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createDirectCreatorUpload(120);
    await createLiveInput("Launch");

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1].body))).toEqual({ maxDurationSeconds: 120 });
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body))).toEqual({ meta: { name: "Launch" }, recording: { mode: "automatic" } });
  });

  it("requires signed URLs and restricts origins on new direct uploads once signing and the lock flag are on", async () => {
    enableStreamSigning();
    const fetchMock = vi.fn().mockResolvedValue(directUploadResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createDirectCreatorUpload(120);

    expect(requestBody(fetchMock)).toEqual({
      maxDurationSeconds: 120,
      requireSignedURLs: true,
      allowedOrigins: ["app.example.test", "*.preview.example.test"],
    });
  });

  it("adds the Cloudflare tus metadata for signed URLs and allowed origins", async () => {
    enableStreamSigning();
    const fetchMock = vi.fn().mockResolvedValue(tusResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createResumableCreatorUpload(tusInput);

    const entries = String(fetchMock.mock.calls[0]![1].headers["Upload-Metadata"]).split(",");
    expect(entries).toContain("requiresignedurls");
    const allowed = entries.find((entry) => entry.startsWith("allowedorigins "));
    expect(Buffer.from(allowed!.slice("allowedorigins ".length), "base64").toString("utf8"))
      .toBe("app.example.test,*.preview.example.test");
  });

  it("records live inputs with signed URLs required", async () => {
    enableStreamSigning();
    const fetchMock = vi.fn().mockResolvedValue(liveInputResponse());
    vi.stubGlobal("fetch", fetchMock);

    await createLiveInput("Launch");

    expect(requestBody(fetchMock)).toEqual({
      meta: { name: "Launch" },
      recording: {
        mode: "automatic",
        requireSignedURLs: true,
        allowedOrigins: ["app.example.test", "*.preview.example.test"],
      },
    });
  });

  it("locks an existing video with a POST carrying its uid", async () => {
    const security = { requireSignedURLs: true as const, allowedOrigins: ["app.example.test"] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { uid: "a1b2c3d4e5f60718293a4b5c6d7e8f90", requireSignedURLs: true, allowedOrigins: ["app.example.test"] },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await updateStreamVideoPlaybackSecurity("a1b2c3d4e5f60718293a4b5c6d7e8f90", security);

    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/test-fixture-account/stream/a1b2c3d4e5f60718293a4b5c6d7e8f90",
    );
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: "POST" });
    expect(requestBody(fetchMock)).toEqual({
      uid: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
      requireSignedURLs: true,
      allowedOrigins: ["app.example.test"],
    });
  });

  it("unlocks an existing video by turning signing off and clearing allowedOrigins", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { uid: "a1b2c3d4e5f60718293a4b5c6d7e8f90", requireSignedURLs: false },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await updateStreamVideoPlaybackSecurity("a1b2c3d4e5f60718293a4b5c6d7e8f90", { requireSignedURLs: false, allowedOrigins: [] });

    expect(requestBody(fetchMock)).toEqual({ uid: "a1b2c3d4e5f60718293a4b5c6d7e8f90", requireSignedURLs: false, allowedOrigins: [] });
  });

  it("reads a live input first and PUTs it back with only the recording security changed", async () => {
    const liveInputUrl = "https://api.cloudflare.com/client/v4/accounts/test-fixture-account/stream/live_inputs/f0e1d2c3b4a5968778695a4b3c2d1e0f";
    const existing = {
      uid: "f0e1d2c3b4a5968778695a4b3c2d1e0f",
      meta: { name: "Launch" },
      defaultCreator: "creator-1",
      deleteRecordingAfterDays: 45,
      recording: { mode: "automatic", timeoutSeconds: 30, requireSignedURLs: false, allowedOrigins: [] },
      rtmps: { url: "rtmps://live.example.test", streamKey: "must-not-be-sent-back" },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: existing }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: { ...existing, recording: { mode: "automatic", requireSignedURLs: true } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await updateLiveInputRecordingSecurity("f0e1d2c3b4a5968778695a4b3c2d1e0f", {
      requireSignedURLs: true,
      allowedOrigins: ["app.example.test"],
    });

    expect(fetchMock.mock.calls[0]![0]).toBe(liveInputUrl);
    expect(fetchMock.mock.calls[0]![1]?.method).toBeUndefined();
    expect(fetchMock.mock.calls[1]![0]).toBe(liveInputUrl);
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body))).toEqual({
      meta: { name: "Launch" },
      defaultCreator: "creator-1",
      deleteRecordingAfterDays: 45,
      recording: { mode: "automatic", timeoutSeconds: 30, requireSignedURLs: true, allowedOrigins: ["app.example.test"] },
    });
  });

  it("unlocks a live input recording by clearing allowedOrigins as well", async () => {
    const existing = {
      uid: "f0e1d2c3b4a5968778695a4b3c2d1e0f",
      meta: { name: "Launch" },
      recording: { mode: "automatic", requireSignedURLs: true, allowedOrigins: ["app.example.test"] },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: existing }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, result: existing }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await updateLiveInputRecordingSecurity("f0e1d2c3b4a5968778695a4b3c2d1e0f", { requireSignedURLs: false, allowedOrigins: [] });

    expect(JSON.parse(String(fetchMock.mock.calls[1]![1].body))).toEqual({
      meta: { name: "Launch" },
      recording: { mode: "automatic", requireSignedURLs: false, allowedOrigins: [] },
    });
  });

  it("never PUTs a live input whose current settings could not be read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateLiveInputRecordingSecurity("f0e1d2c3b4a5968778695a4b3c2d1e0f", { requireSignedURLs: false, allowedOrigins: [] }))
      .rejects.toMatchObject({ code: "provider_rejected", providerStatus: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a missing video as a provider rejection with its status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 404 })));
    await expect(updateStreamVideoPlaybackSecurity("a1b2c3d4e5f60718293a4b5c6d7e8f90", {
      requireSignedURLs: true,
      allowedOrigins: [],
    })).rejects.toMatchObject({ code: "provider_rejected", providerStatus: 404 });
  });
});
