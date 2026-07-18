import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createLiveInputMapping: vi.fn(),
}));

vi.mock("@/lib/cloudflare-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloudflare-ops")>();
  return { ...actual, createLiveInputMapping: mocks.createLiveInputMapping };
});

import { POST } from "./route";

const jobSecret = "test-fixture-job-secret";

function authorizedRequest(payload: Record<string, unknown>) {
  return new Request("https://app.example.test/api/cloudflare/live-inputs", {
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

describe("POST /api/cloudflare/live-inputs", () => {
  it.each([
    { name: "is missing", authorization: undefined },
    { name: "is invalid", authorization: "Bearer test-fixture-wrong-job-secret" },
  ])("returns 401 without reading the body or creating a live input when JOB_SECRET $name", async ({ authorization }) => {
    const { request, json } = requestWithJsonSpy(authorization);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createLiveInputMapping).not.toHaveBeenCalled();
  });

  it("returns 401 without reading the body or creating a live input when JOB_SECRET is not configured", async () => {
    vi.stubEnv("JOB_SECRET", undefined);
    const { request, json } = requestWithJsonSpy(`Bearer ${jobSecret}`);

    const response = await POST(request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(json).not.toHaveBeenCalled();
    expect(mocks.createLiveInputMapping).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid payload after JOB_SECRET authorization", async () => {
    const response = await POST(authorizedRequest({ vendorId: "", name: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid live input request" });
    expect(mocks.createLiveInputMapping).not.toHaveBeenCalled();
  });

  it("returns only the allowed live-input fields without a plaintext stream key", async () => {
    mocks.createLiveInputMapping.mockResolvedValue({
      video: { id: "video-1", liveStreamKey: "test-fixture-plaintext-stream-key" },
      liveInput: {
        uid: "live-input-1",
        rtmps: {
          url: "rtmps://live.example.test/live-input-1",
          streamKey: "test-fixture-plaintext-stream-key",
        },
        webRTC: { url: "https://webrtc.example.test/live-input-1" },
      },
    });

    const response = await POST(authorizedRequest({ vendorId: "vendor-1", name: "Test live input" }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      videoId: "video-1",
      liveInput: {
        uid: "live-input-1",
        rtmpsUrl: "rtmps://live.example.test/live-input-1",
        webRTCUrl: "https://webrtc.example.test/live-input-1",
        streamKeyRef: "video-1",
      },
    });
    expect(JSON.stringify(body)).not.toContain("test-fixture-plaintext-stream-key");
    expect(mocks.createLiveInputMapping).toHaveBeenCalledWith({ vendorId: "vendor-1", name: "Test live input" });
  });
});
