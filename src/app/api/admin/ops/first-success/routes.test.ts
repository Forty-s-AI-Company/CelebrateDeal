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
    vendor: { findUnique: mocks.findVendor },
    userPolicyConsent: { count: mocks.countConsent },
    emailDelivery: { findMany: mocks.findDeliveries },
    formSubmission: { count: mocks.countSubmissions },
  }),
}));

import { POST as invite } from "./invite/route";
import { POST as status } from "./status/route";
import { verifyMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";
import { MERCHANT_INVITATION_AUDIT_ACTION } from "@/lib/merchant-invitation-admin";
import {
  extractOwnLinkPath,
  FIRST_SUCCESS_RUN_ID_HEADER,
  firstSuccessBuyerEmail,
  firstSuccessOwnerEmail,
  isFirstSuccessTurnstileExempt,
  lookupProviderEmail,
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

describe("first-success helpers", () => {
  it("exempts only this runner's owner mailbox on the bound staging runtime from Turnstile", () => {
    expect(isFirstSuccessTurnstileExempt(firstSuccessOwnerEmail(runId))).toBe(true);
    for (const email of [firstSuccessBuyerEmail(runId), "owner@example.test", "delivered@resend.dev", `${firstSuccessOwnerEmail(runId)}.evil.test`, `x${firstSuccessOwnerEmail(runId)}`]) {
      expect(isFirstSuccessTurnstileExempt(email)).toBe(false);
    }
    for (const [name, value] of [["VERCEL_ENV", "production"], ["PAYUNI_ENV", "production"], ["WP4_SANDBOX_EXECUTOR_ENABLED", "false"], ["VERCEL_PROJECT_ID", "prj_other"], ["NEXT_PUBLIC_APP_URL", "https://celebratedeal.carry-digital-nomad.in.net"]] as const) {
      vi.stubEnv(name, value);
      expect(isFirstSuccessTurnstileExempt(firstSuccessOwnerEmail(runId))).toBe(false);
      vi.unstubAllEnvs();
      vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("PAYUNI_ENV", "sandbox"); vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
      vi.stubEnv("VERCEL_PROJECT_ID", "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn"); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ocbugvgojrunvenozsbx.supabase.co");
      vi.stubEnv("DATABASE_URL", "postgresql://db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres");
      vi.stubEnv("DIRECT_URL", "postgresql://db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres");
      vi.stubEnv("STAGING_DATABASE_URL", "postgresql://db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres");
    }
    expect(isFirstSuccessTurnstileExempt(firstSuccessOwnerEmail(runId))).toBe(true);
  });

  it("keeps only same-origin links to the expected path with a single token parameter", () => {
    expect(extractOwnLinkPath(`${origin}/verify-registration?token=abcdefghijklmnopqrst`, "/verify-registration", origin)).toBe("/verify-registration?token=abcdefghijklmnopqrst");
    expect(extractOwnLinkPath(`<a href="${origin}/verify-registration?token=abcdefghijklmnopqrst&amp;next=/x">`, "/verify-registration", origin)).toBeNull();
    expect(extractOwnLinkPath(`${origin}/verify-email?token=abcdefghijklmnopqrst`, "/verify-registration", origin)).toBeNull();
    expect(extractOwnLinkPath("https://other.example/verify-registration?token=abcdefghijklmnopqrst", "/verify-registration", origin)).toBeNull();
    expect(extractOwnLinkPath(`${origin}/verify-registration?token=short`, "/verify-registration", origin)).toBeNull();
  });

  it("maps provider responses to fixed events", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_synthetic_key");
    expect((await lookupProviderEmail(null)).event).toBe("NOT_LOOKED_UP");
    expect((await lookupProviderEmail("../../domains", vi.fn() as unknown as typeof fetch)).event).toBe("LOOKUP_UNAVAILABLE");
    expect((await lookupProviderEmail("msg-12345678", (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch)).event).toBe("LOOKUP_UNAVAILABLE");
    expect((await lookupProviderEmail("msg-12345678", (async () => Response.json({ last_event: "<script>" })) as unknown as typeof fetch)).event).toBe("OTHER");
    expect((await lookupProviderEmail("msg-12345678", (async () => Response.json({ last_event: "bounced" })) as unknown as typeof fetch)).event).toBe("BOUNCED");
    vi.stubEnv("RESEND_API_KEY", "");
    expect((await lookupProviderEmail("msg-12345678")).event).toBe("LOOKUP_UNAVAILABLE");
  });
});
