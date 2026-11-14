import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAudit: vi.fn(),
  findUser: vi.fn(),
  findVendor: vi.fn(),
  countConsent: vi.fn(),
  findAudit: vi.fn(),
  findDeliveries: vi.fn(),
  countSubmissions: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    auditLog: { create: mocks.createAudit, findFirst: mocks.findAudit },
    user: { findUnique: mocks.findUser },
    vendor: { findFirst: mocks.findVendor },
    userPolicyConsent: { count: mocks.countConsent },
    emailDelivery: { findMany: mocks.findDeliveries },
    formSubmission: { count: mocks.countSubmissions },
  }),
}));

import { POST as invite } from "./route";
import { verifyMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";
import { MERCHANT_INVITATION_AUDIT_ACTION } from "@/lib/merchant-invitation-admin";
import {
  FIRST_SUCCESS_RUN_ID_HEADER,
  firstSuccessOwnerEmail,
} from "@/lib/staging-first-success";

const origin = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const jobSecret = "test-fixture-job-secret";
const sourceSha = "a".repeat(40);

function request(path: string, { authorization = `Bearer ${jobSecret}`, sha = sourceSha, run, search = "" }: { authorization?: string | null; sha?: string; run?: string; search?: string } = {}) {
  return new Request(`${origin}/api/admin/ops/first-success/${path}${search}`, {
    method: "POST",
    headers: {
      ...(authorization ? { authorization } : {}),
      "x-celebratedeal-source-sha": sha,
      ...(run ? { [FIRST_SUCCESS_RUN_ID_HEADER]: run } : {}),
    },
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
  vi.stubEnv("RESEND_API_KEY", "");
  mocks.createAudit.mockResolvedValue({ id: "audit-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/admin/ops/first-success/invite", () => {
  it("rejects missing secret, Production, other source SHAs and caller input before signing", async () => {
    expect((await invite(request("invite", { authorization: null }))).status).toBe(401);
    expect((await invite(request("invite", { sha: "b".repeat(40) }))).status).toBe(404);
    expect((await invite(request("invite", { search: "?email=someone%40example.test" }))).status).toBe(404);
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await invite(request("invite"))).status).toBe(404);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "false");
    expect((await invite(request("invite"))).status).toBe(404);
    expect(mocks.createAudit).not.toHaveBeenCalled();
  });

  it("signs a short-lived invite for a Resend test mailbox and records it like an admin invite", async () => {
    const response = await invite(request("invite"));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json() as { runId: string; invitePath: string; expiresAt: string };
    expect(body.runId).toMatch(/^[a-f0-9]{24}$/u);
    const token = new URL(body.invitePath, origin).searchParams.get("invite");
    const verified = verifyMerchantRegistrationInvite(token);
    expect(verified?.email).toBe(firstSuccessOwnerEmail(body.runId));
    expect(verified?.email).toMatch(/^delivered\+cdfs-owner-[a-f0-9]{24}@resend\.dev$/u);
    expect(verified!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(30 * 60 * 1_000);
    const audit = mocks.createAudit.mock.calls[0]![0].data;
    expect(audit).toMatchObject({ vendorId: null, action: MERCHANT_INVITATION_AUDIT_ACTION, targetType: "MerchantRegistrationInvite", targetId: verified!.jti });
    expect(JSON.stringify(audit)).not.toContain(body.runId);
    expect(JSON.stringify(audit)).not.toContain(token!.split(".")[2]!);
  });

  it("returns no link when the audit entry cannot be stored", async () => {
    mocks.createAudit.mockRejectedValue(new Error("database down"));
    const response = await invite(request("invite"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("invite=");
  });
});

