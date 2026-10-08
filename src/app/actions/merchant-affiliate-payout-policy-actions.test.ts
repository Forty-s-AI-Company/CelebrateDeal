import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ csrf: vi.fn(), auth: vi.fn(), save: vi.fn(), revalidate: vi.fn(), db: {} }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.csrf }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.auth }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/lib/merchant-affiliate-payout-policy", async original => ({ ...await original<typeof import("@/lib/merchant-affiliate-payout-policy")>(), setMerchantAffiliatePayoutPolicy: mocks.save }));
import { saveMerchantAffiliatePayoutPolicyAction } from "./merchant-affiliate-payout-policy-actions";
function form() {
  const result = new FormData();
  for (const [key, value] of Object.entries({ vendorId: "forged-vendor", userId: "forged-user", expectedRevision: "2", bankFeeCents: "1500", enabled: "on" })) result.set(key, value);
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.csrf.mockResolvedValue(undefined);
  mocks.auth.mockResolvedValue({ vendor: { id: "actual-vendor", enabledFeatureModules: ["affiliate_program", "tax_remuneration"] }, auth: { user: { id: "actual-user" } } });
  mocks.save.mockResolvedValue({ revision: 3 });
});
describe("merchant payout policy protected action", () => {
  it("uses authenticated identities and exact integer fee/revision", async () => {
    await expect(saveMerchantAffiliatePayoutPolicyAction(form())).rejects.toThrow("redirect:/affiliates/payout-policy?saved=1");
    expect(mocks.save).toHaveBeenCalledWith(mocks.db, { userId: "actual-user" }, "actual-vendor", { expectedRevision: 2, bankFeeCents: 1500, enabled: true });
    expect(mocks.csrf.mock.invocationCallOrder[0]).toBeLessThan(mocks.auth.mock.invocationCallOrder[0]!);
  });
  it("blocks missing CSRF before auth or mutations", async () => {
    mocks.csrf.mockRejectedValueOnce(new Error("synthetic-csrf-rejection"));
    await expect(saveMerchantAffiliatePayoutPolicyAction(form())).rejects.toThrow("synthetic-csrf-rejection");
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("blocks authorization failure and disabled feature", async () => {
    mocks.auth.mockRejectedValueOnce(new Error("synthetic-auth-rejection"));
    await expect(saveMerchantAffiliatePayoutPolicyAction(form())).rejects.toThrow("synthetic-auth-rejection");
    mocks.auth.mockResolvedValueOnce({ vendor: { id: "actual-vendor", enabledFeatureModules: ["affiliate_program"] }, auth: { user: { id: "actual-user" } } });
    await expect(saveMerchantAffiliatePayoutPolicyAction(form())).rejects.toThrow("not-found");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(["", "-1", "1.5", "NaN"])("rejects non-integer fee %j without mutation", async bankFeeCents => {
    const input = form(); input.set("bankFeeCents", bankFeeCents);
    await expect(saveMerchantAffiliatePayoutPolicyAction(input)).rejects.toThrow("redirect:/affiliates/payout-policy?error=conflict");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
