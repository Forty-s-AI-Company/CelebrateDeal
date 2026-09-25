import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const probe = vi.hoisted(() => vi.fn());
vi.mock("@/lib/provider-readonly-probe", () => ({ probeProviderReadOnly: probe }));

const jobSecret = "synthetic-job-secret-123";
const sourceSha = "a".repeat(40);
const request = (secret = jobSecret, live = false, sha = sourceSha) => new Request(`https://preview.example.test/api/admin/ops/provider-runtime${live ? "?probe=read-only" : ""}`, {
  headers: { authorization: `Bearer ${secret}`, "x-celebratedeal-source-sha": sha },
});

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
  vi.stubEnv("CLOUDFLARE_R2_ACCOUNT_ID", "synthetic-r2-account");
  vi.stubEnv("CLOUDFLARE_R2_ACCESS_KEY_ID", "synthetic-r2-key-id");
  vi.stubEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY", "synthetic-r2-key");
  vi.stubEnv("CLOUDFLARE_R2_BUCKET", "synthetic-preview-bucket");
  vi.stubEnv("CLOUDFLARE_R2_PUBLIC_BASE_URL", "https://assets.example.test");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "synthetic-stream-account");
  vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", "synthetic-stream-token");
  vi.stubEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", "synthetic-webhook-secret");
});

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("GET /api/admin/ops/provider-runtime", () => {
  it("rejects unauthorized requests without disclosing runtime bindings", async () => {
    const response = await GET(request("wrong-secret", true));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("rejects non-Preview runtimes", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await GET(request(jobSecret, true));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Preview runtime required" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("returns only presence and stable, separated opaque resource digests", async () => {
    const first = await GET(request());
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
    expect((await (await GET(request())).json()).r2.resourceDigest).toBe(body.r2.resourceDigest);
    expect(probe).not.toHaveBeenCalled();
    const serialized = JSON.stringify(body);
    for (const value of ["synthetic-r2-account", "synthetic-preview-bucket", "synthetic-r2-key-id", "synthetic-r2-key", "synthetic-stream-account", "synthetic-stream-token", jobSecret]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("changes only the affected resource digest and reports missing bindings", async () => {
    const original = await (await GET(request())).json();
    vi.stubEnv("CLOUDFLARE_R2_BUCKET", "other-synthetic-bucket");
    vi.stubEnv("CLOUDFLARE_STREAM_TOKEN", undefined);
    const changed = await (await GET(request())).json();
    expect(changed.r2.resourceDigest).not.toBe(original.r2.resourceDigest);
    expect(changed.stream.resourceDigest).toBe(original.stream.resourceDigest);
    expect(changed.stream.configured.token).toBe(false);
    vi.stubEnv("CLOUDFLARE_R2_ACCOUNT_ID", undefined);
    expect((await (await GET(request())).json()).r2.resourceDigest).toBeNull();
  });

  it("fails closed before provider access when deployed source is absent or mismatched", async () => {
    const wrong = await GET(request(jobSecret, true, "b".repeat(40)));
    expect(wrong.status).toBe(403);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    const absent = await GET(request(jobSecret, true));
    expect(absent.status).toBe(403);
    expect(probe).not.toHaveBeenCalled();
  });

  it("returns only bounded read-only probe enums and leaves scope unverified", async () => {
    probe.mockResolvedValue({ r2: "ok", stream: "forbidden" });
    const response = await GET(request(jobSecret, true));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      evidence: "provider_read_only_probe",
      providerProbe: "completed",
      nonProductionScope: "unverified",
      probe: { r2: "ok", stream: "forbidden" },
    });
    expect(probe).toHaveBeenCalledTimes(1);
  });
});
