import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDirectUploadMapping: vi.fn(),
}));

vi.mock("@/lib/cloudflare-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloudflare-ops")>();
  return { ...actual, createDirectUploadMapping: mocks.createDirectUploadMapping };
});

import { POST } from "./route";

const jobSecret = "test-fixture-job-secret";

function authorizedRequest(payload: Record<string, unknown>) {
  return new Request("https://app.example.test/api/admin/ops/cloudflare/direct-upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${jobSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function requestWithJsonSpy(authorization?: string) {
  const json = vi.fn();
  return {
    request: {
      headers: new Headers(authorization ? { authorization } : undefined),
      json,
    } as unknown as Request,
    json,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/ops/cloudflare/direct-upload", () => {
  it.each([
    { name: "is missing", authorization: undefined },
    { name: "is invalid", authorization: "Bearer test-fixture-wrong-job-secret" },
  ])("returns 401 without reading the body or creating an upload when JOB_SECRET $name", async ({ authorization }) => {
    const { request, json } = requestWithJsonSpy(authorization);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("returns 401 without reading the body or creating an upload when JOB_SECRET is not configured", async () => {
    vi.stubEnv("JOB_SECRET", undefined);
    const { request, json } = requestWithJsonSpy(`Bearer ${jobSecret}`);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid payload after JOB_SECRET authorization", async () => {
    const response = await POST(authorizedRequest({ vendorId: "", maxDurationSeconds: 0 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid upload request" });
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("returns only the allowed upload fields without a plaintext upload key", async () => {
    mocks.createDirectUploadMapping.mockResolvedValue({
      video: {
        id: "video-1",
        status: "processing",
        videoUrl: "https://videodelivery.net/video-1/manifest/video.m3u8",
      },
      upload: {
        uid: "upload-1",
        uploadURL: "https://upload.example.test/upload-1",
        streamKey: "test-fixture-plaintext-upload-key",
      },
    });

    const response = await POST(
      authorizedRequest({
        vendorId: "vendor-1",
        title: "Test upload",
        maxDurationSeconds: 120,
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      helper: "admin_ops_cloudflare_direct_upload",
      videoId: "video-1",
      status: "processing",
      playbackUrl: "https://videodelivery.net/video-1/manifest/video.m3u8",
      upload: {
        uid: "upload-1",
        uploadURL: "https://upload.example.test/upload-1",
      },
    });
    expect(JSON.stringify(body)).not.toContain("test-fixture-plaintext-upload-key");
    expect(mocks.createDirectUploadMapping).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      title: "Test upload",
      maxDurationSeconds: 120,
    });
  });

  it("returns a closed diagnostic without exposing raw external errors", async () => {
    mocks.createDirectUploadMapping.mockRejectedValue(new Error("provider-token-and-response"));

    const response = await POST(authorizedRequest({ vendorId: "vendor-1", title: "Test upload" }));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('"diagnostic":"internal_failure"');
    expect(body).not.toContain("provider-token-and-response");
  });
});
