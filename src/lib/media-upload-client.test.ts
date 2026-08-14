import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_UPLOAD_MAX_BYTES,
  MediaUploadClientError,
  parseImageProvision,
  parseResumableVideoComplete,
  parseResumableVideoProvision,
  parseVideoProvision,
  requestMediaJson,
  uploadFileWithProgress,
  validateMediaFile,
  VIDEO_BASIC_UPLOAD_MAX_BYTES,
  VIDEO_UPLOAD_MAX_BYTES,
} from "./media-upload-client";

function file(type: string, size: number) {
  return { type, size } as File;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("media upload client validation", () => {
  it("accepts bounded image and video formats", () => {
    expect(validateMediaFile("image", file("image/webp", IMAGE_UPLOAD_MAX_BYTES))).toBeNull();
    expect(validateMediaFile("video", file("video/mp4", VIDEO_BASIC_UPLOAD_MAX_BYTES + 1))).toBeNull();
    expect(validateMediaFile("video", file("video/mp4", VIDEO_UPLOAD_MAX_BYTES))).toBeNull();
  });

  it("rejects empty, oversized, and unsupported files before provisioning", () => {
    expect(validateMediaFile("image", file("image/png", 0))).toBe("empty_file");
    expect(validateMediaFile("image", file("image/svg+xml", 10))).toBe("unsupported_image_type");
    expect(validateMediaFile("video", file("application/octet-stream", 10))).toBe("unsupported_video_type");
    expect(validateMediaFile("video", file("video/mp4", VIDEO_UPLOAD_MAX_BYTES + 1))).toBe("video_too_large");
  });

  it("accepts only complete HTTPS upload contracts", () => {
    expect(parseImageProvision({
      assetId: "asset-1",
      uploadUrl: "https://account.r2.cloudflarestorage.com/object?signature=test",
      publicUrl: "https://media.example.test/object.webp",
      method: "PUT",
      headers: { "content-type": "image/webp" },
    })).toEqual({
      assetId: "asset-1",
      uploadUrl: "https://account.r2.cloudflarestorage.com/object?signature=test",
      publicUrl: "https://media.example.test/object.webp",
      headers: { "content-type": "image/webp" },
    });
    expect(parseVideoProvision({ videoId: "video-1", uploadUrl: "https://upload.videodelivery.net/one-time", method: "POST" })).toEqual({
      videoId: "video-1",
      uploadUrl: "https://upload.videodelivery.net/one-time",
    });
    expect(parseResumableVideoProvision({
      videoId: "video-1",
      uploadUrl: "https://upload.videodelivery.net/tus/one-time",
      uploadTicket: "opaque-encrypted-upload-ticket",
      method: "TUS",
    })).toEqual({
      videoId: "video-1",
      uploadUrl: "https://upload.videodelivery.net/tus/one-time",
      uploadTicket: "opaque-encrypted-upload-ticket",
    });
    expect(parseResumableVideoComplete({ videoId: "video-1", status: "processing" })).toEqual({ videoId: "video-1" });
    expect(() => parseImageProvision({ assetId: "asset-1", uploadUrl: "http://unsafe.test", publicUrl: "https://media.test/x", method: "PUT", headers: { "content-type": "image/png" } })).toThrow(MediaUploadClientError);
    expect(() => parseVideoProvision({ videoId: "video-1", uploadUrl: "javascript:alert(1)", method: "POST" })).toThrow(MediaUploadClientError);
    expect(() => parseResumableVideoProvision({
      videoId: "video-1",
      uploadUrl: "https://attacker.example/upload",
      uploadTicket: "opaque-encrypted-upload-ticket",
      method: "TUS",
    })).toThrow(MediaUploadClientError);
    expect(() => parseResumableVideoComplete({ videoId: "video-1", status: "ready" })).toThrow(MediaUploadClientError);
  });
});

describe("requestMediaJson", () => {
  it("sends same-origin CSRF-bound JSON and returns a validated object envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, assetId: "asset-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(requestMediaJson({ path: "/api/media/images/presign", csrfToken: "csrf-test", payload: { sizeBytes: 10 } })).resolves.toMatchObject({ assetId: "asset-1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/media/images/presign", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      headers: expect.objectContaining({
        "content-type": "application/json",
        "x-celebratedeal-client": "web",
        "x-csrf-token": "csrf-test",
      }),
    }));
  });

  it("maps provider diagnostics without exposing an arbitrary response body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ diagnostic: "configuration", detail: "provider-secret" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    })));

    await expect(requestMediaJson({ path: "/api/media/images/presign", csrfToken: "csrf-test", payload: {} })).rejects.toMatchObject({ code: "configuration" });
  });

  it("maps bounded nested route error codes used by merchant media APIs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "REQUIRES_RESUMABLE" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })));

    await expect(requestMediaJson({ path: "/api/media/videos/direct-upload", csrfToken: "csrf-test", payload: {} })).rejects.toMatchObject({ code: "requires_resumable" });
  });
});

class FakeXhr {
  static instances: FakeXhr[] = [];
  status = 200;
  timeout = 0;
  method = "";
  url = "";
  body: Document | XMLHttpRequestBodyInit | null = null;
  headers: Record<string, string> = {};
  listeners = new Map<string, () => void>();
  progressListener?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void;
  upload = {
    addEventListener: (_name: string, listener: (event: { lengthComputable: boolean; loaded: number; total: number }) => void) => {
      this.progressListener = listener;
    },
  };

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  addEventListener(name: string, listener: () => void) {
    this.listeners.set(name, listener);
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.body = body;
    this.progressListener?.({ lengthComputable: true, loaded: 5, total: 10 });
    this.listeners.get("load")?.();
  }

  abort() {
    this.listeners.get("abort")?.();
  }
}

describe("uploadFileWithProgress", () => {
  it("uploads R2 files with signed headers and reports progress", async () => {
    FakeXhr.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const progress = vi.fn();
    const blob = new Blob(["image"], { type: "image/png" }) as File;

    await uploadFileWithProgress({
      url: "https://r2.example.test/signed",
      method: "PUT",
      file: blob,
      headers: { "content-type": "image/png" },
      onProgress: progress,
    });

    const xhr = FakeXhr.instances[0]!;
    expect(xhr.method).toBe("PUT");
    expect(xhr.headers).toEqual({ "content-type": "image/png" });
    expect(xhr.body).toBe(blob);
    expect(progress).toHaveBeenCalledWith(50);
  });

  it("uses multipart form data for the one-time Stream POST URL", async () => {
    FakeXhr.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    const blob = new Blob(["video"], { type: "video/mp4" }) as File;

    await uploadFileWithProgress({
      url: "https://upload.videodelivery.net/one-time",
      method: "POST",
      file: blob,
      onProgress: vi.fn(),
    });

    const xhr = FakeXhr.instances[0]!;
    expect(xhr.method).toBe("POST");
    expect(xhr.body).toBeInstanceOf(FormData);
    const uploaded = (xhr.body as FormData).get("file");
    expect(uploaded).toBeInstanceOf(Blob);
    expect((uploaded as Blob).size).toBe(blob.size);
    expect((uploaded as Blob).type).toBe("video/mp4");
  });
});
