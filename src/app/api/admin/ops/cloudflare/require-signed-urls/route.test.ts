import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudflareStreamError } from "@/lib/cloudflare-stream";

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));

vi.mock("@/lib/cloudflare-stream-signed-url-backfill", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloudflare-stream-signed-url-backfill")>();
  return { ...actual, backfillStreamSignedUrls: mocks.backfill };
});

import { SignedUrlBackfillNotConfiguredError } from "@/lib/cloudflare-stream-signed-url-backfill";
import { maxDuration, POST } from "./route";

const jobSecret = "test-fixture-job-secret";

function request(payload: unknown, authorization: string | null = `Bearer ${jobSecret}`) {
  return new Request("https://app.example.test/api/admin/ops/cloudflare/require-signed-urls", {
    method: "POST",
    headers: {
      ...(authorization ? { authorization } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/ops/cloudflare/require-signed-urls", () => {
  it.each([null, "Bearer test-fixture-wrong-job-secret"])("rejects a missing or wrong JOB_SECRET (%s)", async (authorization) => {
    const response = await POST(request({ vendorId: "vendor-1" }, authorization));
    expect(response.status).toBe(401);
    expect(mocks.backfill).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ vendorId: "vendor-1", limit: 6 }],
    [{ vendorId: "vendor-1", mode: "public" }],
    [{ vendorId: "vendor-1", uids: ["a1b2c3d4e5f60718293a4b5c6d7e8f90"] }],
    [{ vendorId: "vendor-1", apply: "yes" }],
  ])("rejects an invalid request %#", async (payload) => {
    const response = await POST(request(payload));
    expect(response.status).toBe(400);
    expect(mocks.backfill).not.toHaveBeenCalled();
  });

  it("runs one vendor-scoped batch with the parsed defaults", async () => {
    mocks.backfill.mockResolvedValue({ mode: "lock", apply: false, allowedOrigins: null, scannedVideos: 0, results: [], audited: false, nextCursor: null });

    const response = await POST(request({ vendorId: "vendor-1" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.backfill).toHaveBeenCalledWith(
      { vendorId: "vendor-1", mode: "lock", limit: 5, apply: false },
      { audit: expect.any(Function) },
    );
    await expect(response.json()).resolves.toEqual({
      ok: true,
      helper: "admin_ops_cloudflare_require_signed_urls",
      mode: "lock",
      apply: false,
      allowedOrigins: null,
      scannedVideos: 0,
      results: [],
      audited: false,
      nextCursor: null,
    });
  });

  it("passes unlock through and audits applied batches without tokens", async () => {
    mocks.backfill.mockImplementation(async (input, { audit }) => {
      await audit({
        vendorId: input.vendorId,
        mode: input.mode,
        allowedOrigins: null,
        results: [{ videoId: "video-1", kind: "video", uid: "a1b2c3d4e5f60718293a4b5c6d7e8f90", status: "updated" }],
      });
      return { mode: input.mode, apply: true, allowedOrigins: null, scannedVideos: 1, results: [], audited: true, nextCursor: null };
    });

    const response = await POST(request({ vendorId: "vendor-1", mode: "unlock", apply: true }));

    expect(response.status).toBe(200);
    expect(mocks.backfill).toHaveBeenCalledWith(
      { vendorId: "vendor-1", mode: "unlock", limit: 5, apply: true },
      expect.anything(),
    );
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      actorLabel: "ops:job_secret",
      action: "cloudflare_stream.allow_public_urls",
      targetType: "vendor",
      targetId: "vendor-1",
      after: {
        mode: "unlock",
        allowedOrigins: null,
        results: [{ videoId: "video-1", kind: "video", uid: "a1b2c3d4e5f60718293a4b5c6d7e8f90", status: "updated" }],
      },
    });
  });

  it("declares an explicit maxDuration for the sequential provider calls", () => {
    expect(maxDuration).toBe(300);
  });

  it("returns 409 when applying before signing keys are configured", async () => {
    mocks.backfill.mockRejectedValue(new SignedUrlBackfillNotConfiguredError());

    const response = await POST(request({ vendorId: "vendor-1", apply: true }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, diagnostic: "signing_not_configured" });
  });

  it("maps missing Cloudflare credentials to 503 and anything else to a generic 500", async () => {
    mocks.backfill.mockRejectedValueOnce(new CloudflareStreamError("configuration"));
    expect((await POST(request({ vendorId: "vendor-1", apply: true }))).status).toBe(503);

    mocks.backfill.mockRejectedValueOnce(new Error("database detail"));
    const response = await POST(request({ vendorId: "vendor-1", apply: true }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("database detail");
  });
});
