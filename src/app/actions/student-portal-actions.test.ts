import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  security: vi.fn(), headers: vi.fn(), rateLimit: vi.fn(), vendor: vi.fn(), orderCount: vi.fn(), bookingCount: vi.fn(), voucherCount: vi.fn(),
  createToken: vi.fn(), emailCreate: vi.fn(), clearCookie: vi.fn(), redirect: vi.fn(), hash: vi.fn(() => "customer-hash"), protect: vi.fn(() => ({ payloadEncryptedEnvelope: "encrypted", recipientHash: "hash", recipientMaskedEmail: "s***@example.test" })),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/automation-workflow", () => ({ automationCustomerKeyHash: mocks.hash }));
vi.mock("@/lib/email-delivery-pii", () => ({ protectEmailDeliveryPayload: mocks.protect }));
vi.mock("@/lib/student-portal-auth", () => ({ createStudentPortalAccessToken: mocks.createToken, clearStudentPortalSessionCookie: mocks.clearCookie }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findUnique: mocks.vendor }, commerceOrder: { count: mocks.orderCount }, consultationBooking: { count: mocks.bookingCount }, automationVoucherGrant: { count: mocks.voucherCount }, emailDelivery: { create: mocks.emailCreate } }) }));

import * as studentPortalActions from "@/app/actions/student-portal-actions";
import { STUDENT_PORTAL_INITIAL_STATE } from "@/lib/student-portal-action-state";
const { logoutStudentPortalAction, requestMagicLinkAction } = studentPortalActions;

function form(values: Record<string, string>) { const data = new FormData(); data.set("_csrf", "csrf"); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(new Headers()); mocks.rateLimit.mockResolvedValue(null);
  mocks.vendor.mockResolvedValue({ id: "vendor-1", slug: "teacher", name: "老師品牌", senderName: null, supportEmail: null, contactUrl: null });
  mocks.orderCount.mockResolvedValue(1); mocks.bookingCount.mockResolvedValue(0); mocks.voucherCount.mockResolvedValue(0);
  mocks.createToken.mockResolvedValue("signed-token"); mocks.emailCreate.mockResolvedValue({ id: "email-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("student portal actions", () => {
  it("validates CSRF and returns a development mock link for an eligible student", async () => {
    const result = await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email: " Student@Example.test ", vendorSlug: "teacher" }));
    expect(mocks.security).toHaveBeenCalledOnce();
    expect(mocks.hash).toHaveBeenCalledWith("vendor-1", "student@example.test");
    expect(mocks.createToken).toHaveBeenCalledWith(expect.anything(), { vendorId: "vendor-1", email: "student@example.test", purpose: "magic_link" });
    expect(result).toMatchObject({ status: "sent", mockLink: "https://app.example.test/portal/teacher/access?token=signed-token" });
  });

  it("uses the same anti-enumeration response when no student data exists", async () => {
    mocks.orderCount.mockResolvedValue(0);
    const result = await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email: "nobody@example.test", vendorSlug: "teacher" }));
    expect(result.status).toBe("sent");
    expect(result.mockLink).toBeUndefined();
    expect(mocks.createToken).not.toHaveBeenCalled();
  });

  it("applies an IP-independent tenant and recipient cooldown before issuing a token", async () => {
    mocks.rateLimit.mockResolvedValueOnce(null).mockResolvedValueOnce(new Response(null, { status: 429 }));
    const result = await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email: "student@example.test", vendorSlug: "teacher" }));
    expect(result.status).toBe("rate_limited");
    expect(mocks.rateLimit).toHaveBeenLastCalledWith(
      expect.objectContaining({ headers: expect.any(Headers) }),
      "student-portal-magic-link-recipient:vendor-1:customer-hash",
      3,
      15 * 60 * 1000,
    );
    expect(mocks.createToken).not.toHaveBeenCalled();
  });

  it("queues only an encrypted payload in production and does not return the bearer URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = await requestMagicLinkAction(STUDENT_PORTAL_INITIAL_STATE, form({ email: "student@example.test", vendorSlug: "teacher" }));
    expect(result).toEqual(expect.objectContaining({ status: "sent" }));
    expect(result.mockLink).toBeUndefined();
    const persisted = mocks.emailCreate.mock.calls[0]?.[0]?.data;
    expect(persisted).toEqual(expect.objectContaining({ payloadEncryptedEnvelope: "encrypted", recipientHash: "hash", recipientMaskedEmail: "s***@example.test" }));
    expect(JSON.stringify(persisted)).not.toContain("student@example.test");
    expect(JSON.stringify(persisted)).not.toContain("signed-token");
  });

  it("clears the encrypted session after CSRF validation and redirects within the validated tenant slug", async () => {
    await logoutStudentPortalAction(form({ vendorSlug: "teacher" }));
    expect(mocks.security).toHaveBeenCalledOnce();
    expect(mocks.clearCookie).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/portal/teacher/login");
  });
});

// Next.js 會在收集頁面資料時檢查 runtime exports；常數不得混入 action 模組。
it("exports only async student portal actions", () => {
  expect(Object.keys(studentPortalActions).sort()).toEqual([
    "enterStudentPortalFromCheckoutAction", "logoutStudentPortalAction", "requestMagicLinkAction",
  ]);
  for (const action of Object.values(studentPortalActions)) expect(action.constructor.name).toBe("AsyncFunction");
});
