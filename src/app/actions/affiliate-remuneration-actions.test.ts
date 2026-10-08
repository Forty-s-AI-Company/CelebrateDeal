import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ csrf: vi.fn(), auth: vi.fn(), manager: vi.fn(), vendor: vi.fn(), policy: vi.fn(), submit: vi.fn(), quote: vi.fn(), sign: vi.fn(), approve: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.csrf }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.auth, requireVendorManagerContext: mocks.manager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findFirst: mocks.vendor }, merchantAffiliatePayoutPolicy: { findUnique: mocks.policy } }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/lib/affiliate-payee-profile", async original => ({ ...await original<typeof import("@/lib/affiliate-payee-profile")>(), submitAffiliatePayeeProfile: mocks.submit, approveAffiliatePayeeProfile: mocks.approve }));
vi.mock("@/lib/affiliate-remuneration-quotes", () => ({ createAffiliateRemunerationQuote: mocks.quote, signAffiliateRemunerationQuote: mocks.sign }));
import { approveAffiliatePayeeProfileAction, createAffiliateRemunerationQuoteAction, signAffiliateRemunerationQuoteAction, submitAffiliatePayeeProfileAction } from "./affiliate-remuneration-actions";
const path = "/affiliate-portal/synthetic-shop/affiliate_a/remuneration";
function form() {
  const result = new FormData();
  for (const [key, value] of Object.entries({ vendorSlug: "synthetic-shop", affiliateId: "affiliate_a", vendorId: "forged-vendor", userId: "forged-user", expectedRevision: "1", accountName: "Synthetic", bankCode: "999", accountNumber: "123456789", taxIdentity: "SYNTHETIC123", recipientType: "resident_individual", nhiTreatment: "subject_execution_business", bankFeeCents: "0", payoutId: "payout_a", snapshotId: "snapshot_a" })) result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.csrf.mockResolvedValue(undefined); mocks.auth.mockResolvedValue({ user: { id: "actual-user" } });
  mocks.manager.mockResolvedValue({ auth: { user: { id: "actual-manager" } }, vendor: { id: "actual-vendor", enabledFeatureModules: ["affiliate_program", "tax_remuneration"] } });
  mocks.vendor.mockResolvedValue({ id: "actual-vendor" }); mocks.policy.mockResolvedValue({ bankFeeCents: 1500, enabled: true });
  mocks.submit.mockResolvedValue({ revision: 2 }); mocks.quote.mockResolvedValue({ id: "snapshot_a" }); mocks.sign.mockResolvedValue({ status: "signed" }); mocks.approve.mockResolvedValue({ approvedRevision: 1 });
});
describe("affiliate remuneration protected actions", () => {
  it("submits only authenticated user and slug-resolved tenant with exact CAS", async () => {
    await expect(submitAffiliatePayeeProfileAction(form())).rejects.toThrow(`redirect:${path}?saved=1`);
    expect(mocks.submit).toHaveBeenCalledWith(expect.anything(), { userId: "actual-user" }, { vendorId: "actual-vendor", affiliateId: "affiliate_a" }, expect.objectContaining({ expectedRevision: 1, bank: { accountName: "Synthetic", bankCode: "999", accountNumber: "123456789" } }));
    expect(mocks.csrf.mock.invocationCallOrder[0]).toBeLessThan(mocks.auth.mock.invocationCallOrder[0]!);
  });
  it("CSRF rejection prevents auth and every mutation", async () => {
    mocks.csrf.mockRejectedValue(new Error("synthetic-csrf-rejection"));
    await expect(submitAffiliatePayeeProfileAction(form())).rejects.toThrow("synthetic-csrf-rejection");
    await expect(approveAffiliatePayeeProfileAction(form())).rejects.toThrow("synthetic-csrf-rejection");
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.manager).not.toHaveBeenCalled(); expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.approve).not.toHaveBeenCalled();
  });
  it("quotes the server's persisted fee instead of the forged form amount", async () => {
    await expect(createAffiliateRemunerationQuoteAction(form())).rejects.toThrow(`redirect:${path}?saved=1`);
    expect(mocks.quote).toHaveBeenCalledWith(expect.anything(), { userId: "actual-user" }, { vendorId: "actual-vendor", affiliateId: "affiliate_a" }, "payout_a", { bankFeeCents: 1500 });
  });
  it("signature requires explicit consent and exact snapshot revision", async () => {
    await expect(signAffiliateRemunerationQuoteAction(form())).rejects.toThrow(`redirect:${path}?error=conflict`);
    expect(mocks.sign).not.toHaveBeenCalled();
    const input = form(); input.set("consent", "on");
    await expect(signAffiliateRemunerationQuoteAction(input)).rejects.toThrow(`redirect:${path}?saved=1`);
    expect(mocks.sign).toHaveBeenCalledWith(expect.anything(), { userId: "actual-user" }, { vendorId: "actual-vendor", affiliateId: "affiliate_a" }, "snapshot_a", 1);
  });
  it("manager approval requires review confirmation and session tenant", async () => {
    await expect(approveAffiliatePayeeProfileAction(form())).rejects.toThrow("redirect:/affiliates/affiliate_a/remuneration?error=conflict");
    expect(mocks.approve).not.toHaveBeenCalled();
    const input = form(); input.set("reviewConfirmed", "on");
    await expect(approveAffiliatePayeeProfileAction(input)).rejects.toThrow("redirect:/affiliates/affiliate_a/remuneration?saved=1");
    expect(mocks.approve).toHaveBeenCalledWith(expect.anything(), { userId: "actual-manager" }, { vendorId: "actual-vendor", affiliateId: "affiliate_a" }, 1);
  });
  it("stale financial state cannot be displayed as a successful signature", async () => {
    mocks.sign.mockResolvedValueOnce({ status: "stale" });
    const input = form(); input.set("consent", "on");
    await expect(signAffiliateRemunerationQuoteAction(input)).rejects.toThrow(`redirect:${path}?error=conflict`);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("missing/disabled tenant prevents member financial actions", async () => {
    mocks.vendor.mockResolvedValueOnce(null);
    await expect(createAffiliateRemunerationQuoteAction(form())).rejects.toThrow("not-found");
    expect(mocks.quote).not.toHaveBeenCalled();
  });
});
