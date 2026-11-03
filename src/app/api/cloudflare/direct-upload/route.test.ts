import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDirectUploadMapping: vi.fn(),
}));

vi.mock("@/lib/cloudflare-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloudflare-ops")>();
  return { ...actual, createDirectUploadMapping: mocks.createDirectUploadMapping };
});

import { POST } from "./route";

const smokeSecret = "test-fixture-ops-smoke-secret-0123456789abcdef";
const jobSecret = "test-fixture-job-secret-0123456789";

function authorizedRequest(payload: Record<string, unknown>) {
  return new Request("https://app.example.test/api/cloudflare/direct-upload", {
    method: "POST",
    headers: {
      authorization: `Bearer ${smokeSecret}`,
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
  vi.stubEnv("OPS_SMOKE_SECRET", smokeSecret);
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("SMOKE_VENDOR_ID", "vendor-1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/cloudflare/direct-upload", () => {
  it.each([
    { name: "is missing", authorization: undefined },
    { name: "is invalid", authorization: "Bearer test-fixture-wrong-ops-smoke-secret" },
  ])("returns 401 without reading the body or creating an upload when OPS_SMOKE_SECRET $name", async ({ authorization }) => {
    const { request, json } = requestWithJsonSpy(authorization);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("returns 401 without reading the body or creating an upload when OPS_SMOKE_SECRET is not configured", async () => {
    vi.stubEnv("OPS_SMOKE_SECRET", undefined);
    const { request, json } = requestWithJsonSpy(`Bearer ${smokeSecret}`);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it.each([
    { name: "the shared JOB_SECRET", configured: smokeSecret },
    { name: "JOB_SECRET while OPS_SMOKE_SECRET is unset", configured: undefined },
  ])("rejects $name without reading the body or creating an upload", async ({ configured }) => {
    vi.stubEnv("OPS_SMOKE_SECRET", configured);
    const { request, json } = requestWithJsonSpy(`Bearer ${jobSecret}`);

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("refuses a vendorId other than the configured smoke vendor before creating an upload", async () => {
    const response = await POST(authorizedRequest({ vendorId: "vendor-other", title: "Cross-tenant upload" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Vendor is not permitted for smoke operations" });
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("returns 503 without creating an upload when no smoke vendor is configured", async () => {
    vi.stubEnv("SMOKE_VENDOR_ID", undefined);

    const response = await POST(authorizedRequest({ vendorId: "vendor-1", title: "Cross-tenant upload" }));

    expect(response.status).toBe(503);
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid payload after OPS_SMOKE_SECRET authorization", async () => {
    const response = await POST(authorizedRequest({ maxDurationSeconds: 0 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid upload request" });
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("returns only the allowed upload fields", async () => {
    mocks.createDirectUploadMapping.mockResolvedValue({
      video: { id: "video-1" },
      upload: {
        uid: "upload-1",
        uploadURL: "https://upload.example.test/upload-1",
        streamKey: "test-fixture-plaintext-stream-key",
      },
    });

    const response = await POST(authorizedRequest({
      vendorId: "vendor-1",
      title: "Test upload",
      maxDurationSeconds: 120,
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      videoId: "video-1",
      upload: {
        uid: "upload-1",
        uploadURL: "https://upload.example.test/upload-1",
      },
    });
    expect(JSON.stringify(body)).not.toContain("test-fixture-plaintext-stream-key");
    expect(mocks.createDirectUploadMapping).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      title: "Test upload",
      maxDurationSeconds: 120,
    });
  });

  it("returns a closed diagnostic when mapping fails", async () => {
    mocks.createDirectUploadMapping.mockRejectedValue(new Error("raw-provider-response"));

    const response = await POST(authorizedRequest({ vendorId: "vendor-1", title: "Test upload" }));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('"diagnostic":"internal_failure"');
    expect(body).not.toContain("raw-provider-response");
  });
});
