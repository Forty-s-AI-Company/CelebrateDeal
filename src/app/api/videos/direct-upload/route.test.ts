import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAuth: vi.fn(),
  createDirectUploadMapping: vi.fn(),
  writeAuditLog: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.getCurrentAuth }));
vi.mock("@/lib/cloudflare-ops", () => ({ createDirectUploadMapping: mocks.createDirectUploadMapping }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { POST } from "@/app/api/videos/direct-upload/route";

function request(body: unknown) {
  return new Request("https://app.example.test/api/videos/direct-upload", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      "x-celebratedeal-client": "web",
    },
    body: JSON.stringify(body),
  });
}

function auth(role: string) {
  return {
    vendor: { id: "vendor-current" },
    member: { role },
    user: { id: "user-current", platformRole: "none" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkRateLimit.mockResolvedValue(null);
});

describe("merchant Cloudflare direct upload route", () => {
  it.each([null, auth("accountant")])("rejects missing or finance-only merchant auth", async (currentAuth) => {
    mocks.getCurrentAuth.mockResolvedValue(currentAuth);
    const response = await POST(request({ title: "Denied", maxDurationSeconds: 3600 }));
    expect(response.status).toBe(403);
    expect(mocks.createDirectUploadMapping).not.toHaveBeenCalled();
  });

  it("uses the authenticated vendor and returns only the one-time creator upload URL", async () => {
    mocks.getCurrentAuth.mockResolvedValue(auth("owner"));
    mocks.createDirectUploadMapping.mockResolvedValue({
      video: { id: "video-1", sourceType: "cloudflare_stream", status: "processing" },
      upload: { uid: "uid-1", uploadURL: "https://upload.videodelivery.net/one-time" },
    });
    const response = await POST(request({
      vendorId: "vendor-forged",
      title: "Creator upload",
      maxDurationSeconds: 7200,
    }));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(mocks.createDirectUploadMapping).toHaveBeenCalledWith({
      vendorId: "vendor-current",
      title: "Creator upload",
      maxDurationSeconds: 7200,
    });
    expect(body).toMatchObject({ videoId: "video-1", uploadURL: "https://upload.videodelivery.net/one-time" });
    expect(JSON.stringify(body)).not.toContain("streamKey");
  });

  it("returns a generic provider error without leaking upstream details", async () => {
    mocks.getCurrentAuth.mockResolvedValue(auth("staff"));
    mocks.createDirectUploadMapping.mockRejectedValue(new Error("token=secret-provider-value"));
    const response = await POST(request({ title: "Provider failure", maxDurationSeconds: 3600 }));
    const body = await response.json() as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toBe("Cloudflare upload is temporarily unavailable");
    expect(JSON.stringify(body)).not.toContain("secret-provider-value");
  });
});
