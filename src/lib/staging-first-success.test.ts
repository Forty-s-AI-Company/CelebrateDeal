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

import {
  extractOwnLinkPath,
  firstSuccessBuyerEmail,
  firstSuccessOwnerEmail,
  isFirstSuccessTurnstileExempt,
  lookupProviderEmail,
  readFirstSuccessStatus,
} from "@/lib/staging-first-success";

const origin = "https://celebrate-deal-staging.carry-digital-nomad.in.net";
const jobSecret = "test-fixture-job-secret";
const sourceSha = "a".repeat(40);
const runId = "0123456789abcdef01234567";

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

describe("provider rate limits and lookup scope", () => {
  it("retries a 429 once after Retry-After and then reports the lookup as unavailable", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_synthetic_key");
    vi.useFakeTimers();
    try {
      const limited = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "1" } }));
      const pending = lookupProviderEmail("msg-12345678", limited as unknown as typeof fetch);
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await pending).event).toBe("LOOKUP_UNAVAILABLE");
      expect(limited).toHaveBeenCalledTimes(2);
      const recovered = vi.fn()
        .mockResolvedValueOnce(new Response("{}", { status: 429 }))
        .mockResolvedValueOnce(Response.json({ last_event: "delivered" }));
      const second = lookupProviderEmail("msg-12345678", recovered as unknown as typeof fetch);
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await second).event).toBe("DELIVERED");
    } finally {
      vi.useRealTimers();
    }
  });

  it("binds the vendor to the run's active owner and skips lookups for mail already acted on", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_synthetic_key");
    const providerFetch = vi.fn(async () => Response.json({ last_event: "delivered" }));
    mocks.findUser.mockResolvedValue({ id: "user-1", emailVerifiedAt: new Date() });
    mocks.countConsent.mockResolvedValue(1);
    mocks.findAudit.mockResolvedValue({ action: "merchant_email_verification_sent", after: { providerMessageId: "msg-verification-1" } });
    mocks.findVendor.mockResolvedValue({ id: "vendor-1" });
    mocks.findDeliveries.mockResolvedValue([
      { id: "email_a", vendorId: "vendor-1", trigger: "form_submission_verification", status: "sent", providerMessageId: "msg-buyer-verify", payloadEncryptedEnvelope: "x", sourceFormSubmissionId: "sub-1" },
      { id: "email_b", vendorId: "vendor-1", trigger: "registration_confirmed", status: "sent", providerMessageId: "msg-confirmation", payloadEncryptedEnvelope: "x", sourceFormSubmissionId: "sub-1" },
    ]);
    mocks.countSubmissions.mockResolvedValue(1);
    const result = await readFirstSuccessStatus(runId, providerFetch as unknown as typeof fetch);
    expect(mocks.findVendor).toHaveBeenCalledWith({
      where: { email: firstSuccessOwnerEmail(runId), members: { some: { userId: "user-1", role: "owner", status: "active" } } },
      select: { id: true },
    });
    expect(mocks.findDeliveries).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1" }) }));
    // Owner verified and buyer verified: only the confirmation mail is read back.
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(providerFetch).toHaveBeenCalledWith("https://api.resend.com/emails/msg-confirmation", expect.anything());
    expect(result).toMatchObject({
      ownerEmailVerified: true,
      merchantVerificationEmail: { status: "SENT", providerEvent: "NOT_LOOKED_UP" },
      buyerVerifiedSubmissions: 1,
      buyerVerificationLinkPath: null,
      registrationConfirmationEmail: { status: "SENT", providerEvent: "DELIVERED" },
    });
  });
});
