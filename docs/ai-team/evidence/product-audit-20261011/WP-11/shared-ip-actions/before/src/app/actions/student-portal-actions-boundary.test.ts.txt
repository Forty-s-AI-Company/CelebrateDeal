import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ security: vi.fn(), rate: vi.fn(), token: vi.fn(), checkoutToken: vi.fn(), email: vi.fn(), resolveGrant: vi.fn(), order: vi.fn(), vendor: vi.fn(), redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ getAll: () => [] }) }));
vi.mock("next/navigation", () => ({ redirect: m.redirect }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: m.security }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.rate }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
vi.mock("@/lib/automation-workflow", () => ({ automationCustomerKeyHash: () => "synthetic-customer-hash" }));
vi.mock("@/lib/buyer-support-access", () => ({ resolveBuyerSupportGrant: m.resolveGrant }));
vi.mock("@/lib/commerce-order-pii", () => ({ revealCommerceOrderPii: () => ({ buyer: { email: "other-student@example.test" } }) }));
vi.mock("@/lib/email-delivery-pii", () => ({ protectEmailDeliveryPayload: () => ({ payloadEncryptedEnvelope: "synthetic-encrypted-payload" }) }));
vi.mock("@/lib/student-portal-auth", () => ({ createStudentPortalAccessToken: m.token, createCheckoutStudentPortalAccessToken: m.checkoutToken, clearStudentPortalSessionCookie: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findUnique: m.vendor }, commerceOrder: { count: async () => 1, findFirst: m.order }, consultationBooking: { count: async () => 0 }, automationVoucherGrant: { count: async () => 0 }, emailDelivery: { create: m.email } }) }));
import { requestMagicLinkAction, enterStudentPortalFromCheckoutAction } from "@/app/actions/student-portal-actions";
const form = () => { const f = new FormData(); f.set("vendorSlug", "teacher"); f.set("email", "other-student@example.test"); f.set("grantId", "own-order-grant"); return f; };
beforeEach(() => {
  vi.clearAllMocks(); m.rate.mockResolvedValue(null); m.token.mockResolvedValue("synthetic-only-magic-capability"); m.checkoutToken.mockResolvedValue("synthetic-only-checkout-capability");
  m.email.mockResolvedValue({}); m.vendor.mockResolvedValue({ id: "vendor-1", slug: "teacher", name: "Teacher" });
  m.resolveGrant.mockResolvedValue({ id: "own-order-grant", vendorId: "vendor-1", orderId: "new-order", order: { status: "paid" } });
  m.order.mockResolvedValue({ id: "new-order", vendorId: "vendor-1", buyerEncryptedEnvelope: "synthetic", shippingEncryptedEnvelope: null, vendor: { slug: "teacher" } });
  m.redirect.mockImplementation((url: string) => { throw new Error(`redirect:${url}`); });
});
afterEach(() => vi.unstubAllEnvs());
describe("mailbox proof boundary", () => {
  it.each(["development", "test", "production"])("never returns a login capability in %s", async (env) => {
    vi.stubEnv("NODE_ENV", env);
    const result = await requestMagicLinkAction({ status: "idle", message: "" }, form());
    expect(result).not.toHaveProperty("mockLink");
    expect(JSON.stringify(result)).not.toContain("capability");
    expect(m.email).toHaveBeenCalledOnce();
  });
  it("does not elevate an order grant to mailbox-wide authentication", async () => {
    await expect(enterStudentPortalFromCheckoutAction(form())).rejects.toThrow("redirect:/portal/teacher/login");
    expect(m.checkoutToken).not.toHaveBeenCalled();
    expect(m.token).not.toHaveBeenCalled();
    expect(m.order).not.toHaveBeenCalled();
    expect(m.security).toHaveBeenCalledOnce();
  });
  it("rejects missing or invalid order grant before tenant lookup", async () => {
    m.resolveGrant.mockResolvedValue(null);
    await expect(enterStudentPortalFromCheckoutAction(form())).rejects.toThrow("redirect:/checkout/result");
    expect(m.vendor).not.toHaveBeenCalled();
    expect(m.checkoutToken).not.toHaveBeenCalled();
  });
});
