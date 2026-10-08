import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ csrf: vi.fn(), auth: vi.fn(), publish: vi.fn(), pause: vi.fn(), revalidate: vi.fn(), db: {} }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.csrf }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerContext: mocks.auth }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/merchant-affiliate-policy-service", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/merchant-affiliate-policy-service")>();
  return { ...original, publishMerchantAffiliatePolicy: mocks.publish, pauseMerchantAffiliatePolicy: mocks.pause };
});
import { saveMerchantAffiliatePolicyAction } from "./merchant-affiliate-policy-actions";
import { MerchantAffiliatePolicyConflict } from "@/lib/merchant-affiliate-policy-service";
const previous = { message: "", revision: null };
function form() {
  const value = new FormData();
  for (const [key, input] of Object.entries({ expectedRevision: "2", maxTotalPercent: "20", tierStart: "1", tierEnd: "", tierRate: "10", intent: "publish", vendorId: "forged-tenant" })) value.set(key, input);
  return value;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.csrf.mockResolvedValue(undefined);
  mocks.auth.mockResolvedValue({ vendor: { id: "real-tenant" }, auth: { user: { id: "real-user" } } });
  mocks.publish.mockResolvedValue({ revision: 3 }); mocks.pause.mockResolvedValue({ revision: 3 });
});
describe("merchant commission policy authenticated actions", () => {
  it("uses session tenant/user and exact expected revision instead of forged form identity", async () => {
    expect(await saveMerchantAffiliatePolicyAction(previous, form())).toMatchObject({ revision: 3 });
    expect(mocks.publish).toHaveBeenCalledWith(mocks.db, { vendorId: "real-tenant", userId: "real-user" }, expect.objectContaining({ expectedRevision: 2 }));
    expect(mocks.csrf.mock.invocationCallOrder[0]).toBeLessThan(mocks.auth.mock.invocationCallOrder[0]!);
    expect(mocks.revalidate).toHaveBeenCalledWith("/affiliates/policy");
  });
  it("rejects missing CSRF before authorization or database mutations", async () => {
    mocks.csrf.mockRejectedValueOnce(new Error("Synthetic CSRF rejection"));
    await expect(saveMerchantAffiliatePolicyAction(previous, form())).rejects.toThrow("Synthetic CSRF rejection");
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("does not mutate when manager authorization fails", async () => {
    mocks.auth.mockRejectedValueOnce(new Error("Synthetic authorization rejection"));
    await expect(saveMerchantAffiliatePolicyAction(previous, form())).rejects.toThrow("Synthetic authorization rejection");
    expect(mocks.publish).not.toHaveBeenCalled(); expect(mocks.pause).not.toHaveBeenCalled();
  });
  it("turns domain validation failures into a correctable form message", async () => {
    for (const [key, value] of [["tierStart", "2"], ["tierEnd", "10"], ["maxTotalPercent", "5"]]) {
      const data = form(); data.set(key!, value!);
      expect(await saveMerchantAffiliatePolicyAction(previous, data)).toEqual({ message: "請檢查連續階梯、商品、比例與佣金總上限。", revision: null });
    }
    expect(mocks.publish).not.toHaveBeenCalled();
  });
  it("preserves conflict and unexpected failure boundaries", async () => {
    mocks.publish.mockRejectedValueOnce(new MerchantAffiliatePolicyConflict("Synthetic stale CAS"));
    expect(await saveMerchantAffiliatePolicyAction(previous, form())).toMatchObject({ revision: null, message: "政策已由其他人變更，請重新整理後確認最新設定。" });
    mocks.publish.mockRejectedValueOnce(new Error("Synthetic infrastructure failure"));
    await expect(saveMerchantAffiliatePolicyAction(previous, form())).rejects.toThrow("Synthetic infrastructure failure");
  });
  it("pauses only through the session actor and CAS even with incomplete policy fields", async () => {
    const data = new FormData(); data.set("intent", "pause"); data.set("expectedRevision", "2");
    expect(await saveMerchantAffiliatePolicyAction(previous, data)).toMatchObject({ revision: 3 });
    expect(mocks.pause).toHaveBeenCalledWith(mocks.db, { vendorId: "real-tenant", userId: "real-user" }, 2);
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
