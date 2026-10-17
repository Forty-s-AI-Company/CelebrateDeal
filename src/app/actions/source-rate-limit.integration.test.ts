import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInMemoryRateLimitForTests } from "@/lib/rate-limit";
import { LIVE_CHAT_INGRESS_PROOF_HEADER } from "@/lib/request-client-ip";
import { STUDENT_PORTAL_INITIAL_STATE } from "@/lib/student-portal-action-state";

const mock = vi.hoisted(() => ({
  incoming: new Headers(), vendor: vi.fn(), delivery: vi.fn(), link: vi.fn(), hash: vi.fn(),
  transaction: vi.fn(), session: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => mock.incoming, cookies: async () => ({ set: vi.fn(), delete: vi.fn() }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: async () => undefined }));
vi.mock("@/lib/auth", () => ({ AUTH_COOKIE: "synthetic-auth", LEGACY_VENDOR_COOKIE: "synthetic-legacy", createUserSession: mock.session, sessionCookieOptions: () => ({}) }));
vi.mock("@/lib/password", () => ({ hashPasswordAsync: mock.hash }));
vi.mock("@/lib/automation-workflow", () => ({ automationCustomerKeyHash: (vendor: string, email: string) => `${vendor}:${email}` }));
vi.mock("@/lib/email-delivery-pii", () => ({ protectEmailDeliveryPayload: () => ({ payloadEncryptedEnvelope: "synthetic-ciphertext" }) }));
vi.mock("@/lib/student-portal-auth", () => ({ createStudentPortalAccessToken: mock.link }));
vi.mock("@/lib/db", () => ({ getDb: () => ({
  vendor: { findUnique: mock.vendor }, $transaction: mock.transaction,
  commerceOrder: { count: async () => 1 }, consultationBooking: { count: async () => 0 },
  automationVoucherGrant: { count: async () => 0 }, emailDelivery: { create: mock.delivery },
}) }));

import { requestMagicLinkAction } from "./student-portal-actions";
import { registerAction } from "./registration-actions";

const proof = "synthetic-action-ingress-proof-0000000000";
function setSource(index: number, valid = true) {
  mock.incoming = new Headers({
    "cf-connecting-ip": `192.0.2.${index}`,
    "x-forwarded-for": `203.0.113.${index}`,
    ...(valid ? { [LIVE_CHAT_INGRESS_PROOF_HEADER]: proof } : {}),
  });
}
function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.clearAllMocks(); resetInMemoryRateLimitForTests();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubEnv("RATE_LIMIT_PROVIDER", "memory");
  vi.stubEnv("ENTRY_CLIENT_IP_TRUST_MODE", "cloudflare");
  vi.stubEnv("ENTRY_CLIENT_IP_DEPLOYMENT_SOURCE", "cloudflare");
  vi.stubEnv("ENTRY_CLIENT_IP_INGRESS_SECRET", proof);
  mock.vendor.mockResolvedValue({ id: "synthetic-vendor", slug: "teacher", name: "Synthetic" });
  mock.link.mockResolvedValue("synthetic-link");
  mock.delivery.mockResolvedValue({ id: "synthetic-delivery" });
});
afterEach(() => { resetInMemoryRateLimitForTests(); vi.unstubAllEnvs(); });

describe("actual actions with real source and recipient limiters", () => {
  it("rejects forged source metadata before registration hashing or writes", async () => {
    setSource(1, false);
    await expect(registerAction(form({ name: "Synthetic", workspaceName: "Synthetic", email: "owner@example.test", password: "synthetic-password-only" })))
      .rejects.toThrow("redirect:/register?error=temporarily_unavailable");
    expect(mock.hash).not.toHaveBeenCalled();
    expect(mock.transaction).not.toHaveBeenCalled();
    expect(mock.session).not.toHaveBeenCalled();
  });
  it("rejects untrusted magic-link requests before recipient lookup or mail queueing", async () => {
    setSource(1, false);
    const result = await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email: "student@example.test", vendorSlug: "teacher" }));
    expect(result.status).toBe("rate_limited");
    expect(mock.vendor).not.toHaveBeenCalled();
    expect(mock.delivery).not.toHaveBeenCalled();
  });
  it("enforces the recipient bucket across different trusted sources without requiring recipient IP", async () => {
    for (let index = 1; index <= 3; index++) {
      setSource(index);
      expect((await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email: "student@example.test", vendorSlug: "teacher" }))).status).toBe("sent");
    }
    setSource(4);
    expect((await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email: "student@example.test", vendorSlug: "teacher" }))).status).toBe("rate_limited");
    expect(mock.delivery).toHaveBeenCalledTimes(3);
    expect(mock.link).toHaveBeenCalledTimes(3);
    // A different recipient is not throttled by the first student's allowance.
    expect((await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email: "other@example.test", vendorSlug: "teacher" }))).status).toBe("sent");
    expect(mock.delivery).toHaveBeenCalledTimes(4);
  });
});
