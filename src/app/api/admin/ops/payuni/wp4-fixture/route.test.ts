import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureFixture: vi.fn(),
  database: {},
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/wp4-sandbox-fixture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/wp4-sandbox-fixture")>();
  return { ...actual, ensureWp4SandboxFixture: mocks.ensureFixture };
});

import {
  Wp4SandboxFixtureConflictError,
} from "@/lib/wp4-sandbox-fixture";
import { POST } from "./route";

const jobSecret = "test-fixture-job-secret";
const sourceSha = "a".repeat(40);

function request(options: { authorization?: string; sha?: string; body?: BodyInit } = {}) {
  return new Request("https://app.example.test/api/admin/ops/payuni/wp4-fixture", {
    method: "POST",
    headers: {
      ...(options.authorization ? { authorization: options.authorization } : {}),
      "x-celebratedeal-source-sha": options.sha ?? sourceSha,
    },
    ...(options.body === undefined ? {} : { body: options.body, duplex: "half" }),
  } as RequestInit);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
  mocks.ensureFixture.mockResolvedValue({ createdCount: 6, reusedCount: 0 });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/ops/payuni/wp4-fixture", () => {
  it("authenticates before any fixture write", async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.ensureFixture).not.toHaveBeenCalled();
  });

  it.each([
    ["production", "sandbox", "true"],
    ["preview", "production", "true"],
    ["preview", "sandbox", "false"],
  ])("is unavailable for environment %s/%s/%s", async (vercelEnv, payuniEnv, enabled) => {
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.stubEnv("PAYUNI_ENV", payuniEnv);
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", enabled);

    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));

    expect(response.status).toBe(404);
    if (vercelEnv === "preview") {
      expect(response.headers.get("x-celebratedeal-wp4-fixture")).toBe("EXECUTOR_DISABLED");
    }
    expect(mocks.ensureFixture).not.toHaveBeenCalled();
  });

  it("rejects source drift and caller-owned body", async () => {
    const drift = await POST(request({ authorization: `Bearer ${jobSecret}`, sha: "b".repeat(40) }));
    const body = await POST(request({ authorization: `Bearer ${jobSecret}`, body: "{}" }));

    expect(drift.status).toBe(404);
    expect(drift.headers.get("x-celebratedeal-wp4-fixture")).toBe("SOURCE_MISMATCH");
    expect(body.status).toBe(404);
    expect(body.headers.get("x-celebratedeal-wp4-fixture")).toBe("BODY_REJECTED");
    expect(mocks.ensureFixture).not.toHaveBeenCalled();
  });

  it("uses the exact server-bound public SHA when Vercel omits its system SHA", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", sourceSha);

    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));

    expect(response.status).toBe(200);
    expect(mocks.ensureFixture).toHaveBeenCalledExactlyOnceWith(mocks.database);
  });

  it("accepts a proxy-provided zero-byte request stream", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const response = await POST(request({ authorization: `Bearer ${jobSecret}`, body }));

    expect(response.status).toBe(200);
    expect(mocks.ensureFixture).toHaveBeenCalledExactlyOnceWith(mocks.database);
  });

  it("fails closed when system and bound source identities conflict", async () => {
    vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", "b".repeat(40));

    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));

    expect(response.status).toBe(503);
    expect(response.headers.get("x-celebratedeal-wp4-fixture")).toBe("SOURCE_CONFIGURATION_UNAVAILABLE");
    expect(mocks.ensureFixture).not.toHaveBeenCalled();
  });

  it("returns only bounded fixture counters", async () => {
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ready: true, createdCount: 6, reusedCount: 0 });
    expect(mocks.ensureFixture).toHaveBeenCalledExactlyOnceWith(mocks.database);
  });

  it("fails closed on identity conflict without leaking fixture details", async () => {
    mocks.ensureFixture.mockRejectedValueOnce(new Wp4SandboxFixtureConflictError());

    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Conflict" });
  });

  it("fails closed on database errors", async () => {
    mocks.ensureFixture.mockRejectedValueOnce(new Error("raw database detail"));

    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Service unavailable" });
  });
});
