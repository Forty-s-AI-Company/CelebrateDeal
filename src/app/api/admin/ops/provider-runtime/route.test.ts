import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const jobSecret = "synthetic-job-secret-123";
const request = (secret = jobSecret) => new Request("https://preview.example.test/api/admin/ops/provider-runtime", {
  headers: { authorization: `Bearer ${secret}` },
});

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("CLOUDFLARE_R2_ACCOUNT_ID", "synthetic-r2-account");
  vi.stubEnv("CLOUDFLARE_R2_ACCESS_KEY_ID", "synthetic-r2-key-id");
  vi.stubEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY", "synthetic-r2-key");
  vi.stubEnv("CLOUDFLARE_R2_BUCKET", "synthetic-preview-bucket");
  vi.stubEnv("CLOUDFLARE_R2_PUBLIC_BASE_URL", "https://assets.example.test");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "synthetic-stream-account");
  vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", "synthetic-stream-token");
  vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "synthetic-webhook-secret");
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/admin/ops/provider-runtime", () => {
  it("rejects unauthorized requests without disclosing runtime bindings", async () => {
    const response = GET(request("wrong-secret"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects non-Preview runtimes", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Preview runtime required" });
  });

  it("returns only presence and stable, separated opaque resource digests", async () => {
    const first = GET(request());
    const body = await first.json();
    expect(first.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({
      evidence: "runtime_configuration_only",
      providerProbe: "not_run",
      nonProductionScope: "unverified",
      r2: { configured: {
        accountId: true, accessKeyId: true, secretAccessKey: true, bucket: true, publicBaseUrl: true,
      } },
      stream: { configured: { accountId: true, token: true, webhookSecret: true } },
    });
    expect(body.r2.resourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(body.stream.resourceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(body.r2.resourceDigest).not.toBe(body.stream.resourceDigest);
    expect((await GET(request()).json()).r2.resourceDigest).toBe(body.r2.resourceDigest);
    const serialized = JSON.stringify(body);
    for (const value of ["synthetic-r2-account", "synthetic-preview-bucket", "synthetic-r2-key-id", "synthetic-r2-key", "synthetic-stream-account", "synthetic-stream-token", jobSecret]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("changes only the affected resource digest and reports missing bindings", async () => {
    const original = await GET(request()).json();
    vi.stubEnv("CLOUDFLARE_R2_BUCKET", "other-synthetic-bucket");
    vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", undefined);
    const changed = await GET(request()).json();
    expect(changed.r2.resourceDigest).not.toBe(original.r2.resourceDigest);
    expect(changed.stream.resourceDigest).toBe(original.stream.resourceDigest);
    expect(changed.stream.configured.token).toBe(false);
    vi.stubEnv("CLOUDFLARE_R2_ACCOUNT_ID", undefined);
    expect((await GET(request()).json()).r2.resourceDigest).toBeNull();
  });
});
