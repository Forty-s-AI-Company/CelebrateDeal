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

import { POST as status } from "./route";
import {
  FIRST_SUCCESS_RUN_ID_HEADER,
  firstSuccessOwnerEmail,
} from "@/lib/staging-first-success";

const origin = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const jobSecret = "test-fixture-job-secret";
const sourceSha = "a".repeat(40);
const runId = "0123456789abcdef01234567";

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

describe("POST /api/admin/ops/first-success/status", () => {
  it("accepts only a well-formed run id header and never reads other mailboxes", async () => {
    expect((await status(request("status", { authorization: null, run: runId }))).status).toBe(401);
    expect((await status(request("status"))).status).toBe(404);
    expect((await status(request("status", { run: "someone@example.test" }))).status).toBe(404);
    expect(mocks.findUser).not.toHaveBeenCalled();
    mocks.findUser.mockResolvedValue(null);
    const response = await status(request("status", { run: runId }));
    expect(response.status).toBe(200);
    expect(mocks.findUser).toHaveBeenCalledWith(expect.objectContaining({ where: { email: firstSuccessOwnerEmail(runId) } }));
    await expect(response.json()).resolves.toMatchObject({ ownerRegistered: false, merchantVerificationLinkPath: null, buyerVerificationLinkPath: null });
  });

  it("reports provider events and this deployment's verification link without other fields", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_synthetic_key");
    const providerFetch = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.resend.com/emails/msg-verification-1");
      return Response.json({
        last_event: "delivered",
        to: [firstSuccessOwnerEmail(runId)],
        text: `請開啟 https://evil.example/verify-email?token=AAAAAAAAAAAAAAAAAAAA 或 ${origin}/verify-email?token=mev1.synthetic-token-value.signature`,
      });
    });
    vi.stubGlobal("fetch", providerFetch);
    mocks.findUser.mockResolvedValue({ id: "user-1", emailVerifiedAt: null });
    mocks.countConsent.mockResolvedValue(1);
    mocks.findAudit.mockResolvedValue({ action: "merchant_email_verification_sent", after: { providerMessageId: "msg-verification-1" } });
    mocks.findVendor.mockResolvedValue(null);
    const response = await status(request("status", { run: runId }));
    const body = await response.json();
    expect(body).toMatchObject({
      ownerRegistered: true,
      ownerConsentRecorded: true,
      ownerEmailVerified: false,
      merchantVerificationEmail: { status: "SENT", providerEvent: "DELIVERED" },
      merchantVerificationLinkPath: "/verify-email?token=mev1.synthetic-token-value.signature",
    });
    expect(JSON.stringify(body)).not.toContain("resend.dev");
    expect(JSON.stringify(body)).not.toContain("evil.example");
  });
});

