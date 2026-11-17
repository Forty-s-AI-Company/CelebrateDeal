import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findVendors: vi.fn(),
  countVendors: vi.fn(),
  createAudit: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    vendor: { findMany: mocks.findVendors, count: mocks.countVendors },
    auditLog: { create: mocks.createAudit },
    $transaction: mocks.transaction,
  }),
}));

import { POST as cleanup } from "./route";
import { FIRST_SUCCESS_CLEANUP_MODE_HEADER, FIRST_SUCCESS_CLEANUP_REASON } from "@/lib/staging-first-success-cleanup";

const origin = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const jobSecret = "test-fixture-job-secret";
const sourceSha = "a".repeat(40);

function request({ authorization = `Bearer ${jobSecret}`, sha = sourceSha, mode, search = "", body }: { authorization?: string | null; sha?: string; mode?: string; search?: string; body?: string } = {}) {
  return new Request(`${origin}/api/admin/ops/first-success/cleanup${search}`, {
    method: "POST",
    headers: {
      ...(authorization ? { authorization } : {}),
      "x-celebratedeal-source-sha": sha,
      ...(mode !== undefined ? { [FIRST_SUCCESS_CLEANUP_MODE_HEADER]: mode } : {}),
    },
    ...(body ? { body } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("CSRF_SECRET", "synthetic-first-success-secret-32-bytes-long");
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ocbugvgojrunvenozsbx.supabase.co");
  vi.stubEnv("DATABASE_URL", "postgresql://db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres");
  vi.stubEnv("DIRECT_URL", "postgresql://db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres");
  vi.stubEnv("STAGING_DATABASE_URL", "postgresql://db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
  mocks.findVendors.mockResolvedValue([]);
  mocks.countVendors.mockResolvedValue(0);
  mocks.createAudit.mockResolvedValue({ id: "audit-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/ops/first-success/cleanup", () => {
  it("rejects a missing or wrong Bearer, Production and other runtimes before any query", async () => {
    for (const authorization of [null, "Bearer wrong-job-secret", `Bearer ${jobSecret}x`, `Basic ${jobSecret}`, jobSecret]) {
      expect((await cleanup(request({ authorization }))).status, String(authorization)).toBe(401);
    }
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await cleanup(request({ mode: "delete" }))).status).toBe(404);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PAYUNI_ENV", "production");
    expect((await cleanup(request({ mode: "delete" }))).status).toBe(404);
    vi.stubEnv("PAYUNI_ENV", "sandbox");
    vi.stubEnv("VERCEL_PROJECT_ID", "prj_some_other_project");
    expect((await cleanup(request()))).toHaveProperty("status", 404);
    expect(mocks.findVendors).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });

  it("accepts only the two fixed modes and no query, body or other deployment", async () => {
    for (const mode of ["", "DELETE", "purge", "delete,deactivate", "all"]) {
      expect((await cleanup(request({ mode }))).status, mode).toBe(404);
    }
    expect((await cleanup(request({ search: "?mode=delete" }))).status).toBe(404);
    expect((await cleanup(request({ body: '{"vendorId":"v1"}' }))).status).toBe(404);
    expect((await cleanup(request({ sha: "b".repeat(40) }))).status).toBe(404);
    expect(mocks.findVendors).not.toHaveBeenCalled();
  });

  it("defaults to deactivate and finds only the runner's own mailboxes", async () => {
    const response = await cleanup(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ mode: "deactivate", result: "COMPLETED", examined: 0, deactivated: 0, deleted: 0, retentionDays: 7 });
    expect(mocks.findVendors).toHaveBeenCalledWith(expect.objectContaining({
      where: { email: { startsWith: "delivered+cdfs-owner-", endsWith: "@resend.dev" }, suspendedAt: null },
    }));
    expect(mocks.createAudit).toHaveBeenCalledWith({ data: expect.objectContaining({ vendorId: null, action: "staging_first_success_cleanup", targetId: "deactivate" }) });
  });

  it("delete mode looks only at vendors this cleanup suspended before the retention window", async () => {
    const response = await cleanup(request({ mode: "delete" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: "delete", result: "COMPLETED" });
    const where = mocks.findVendors.mock.calls[0]?.[0]?.where;
    expect(where).toMatchObject({ suspendedReason: FIRST_SUCCESS_CLEANUP_REASON, suspendedAt: { lte: expect.any(Date) } });
    expect(Date.now() - where.suspendedAt.lte.getTime()).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1_000);
  });

  it("answers 503 without detail when the database fails", async () => {
    mocks.findVendors.mockRejectedValue(new Error("connection refused at db.internal"));
    const response = await cleanup(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("db.internal");
  });
});
