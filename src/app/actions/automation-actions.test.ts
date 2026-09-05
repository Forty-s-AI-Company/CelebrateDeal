import { beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({ db: { product: { findFirst: vi.fn() }, automationRule: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() } }, auth: { vendor: { id: "v1" }, user: { id: "u1" }, member: { role: "owner" } }, security: vi.fn(), owner: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/cache", () => ({ revalidatePath: runtime.revalidate })); vi.mock("next/navigation", () => ({ redirect: runtime.redirect })); vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: runtime.security })); vi.mock("@/lib/auth", () => ({ requireVendorOwner: runtime.owner })); vi.mock("@/lib/db", () => ({ getDb: () => runtime.db })); vi.mock("@/lib/audit", () => ({ auditSnapshot: (v: unknown) => v, writeAuditLog: runtime.audit }));
import { createAutomationRuleAction, toggleAutomationRuleAction } from "./automation-actions";
function form() { const f = new FormData(); f.set("name", "付款回購"); f.set("trigger", "payment_paid"); f.set("conditionValue", "100"); f.set("actionLine", "on"); f.set("lineMessage", "謝謝購買"); return f; }
beforeEach(() => { vi.clearAllMocks(); runtime.owner.mockResolvedValue(runtime.auth); runtime.db.automationRule.create.mockResolvedValue({ id: "r1", vendorId: "v1" }); runtime.db.automationRule.findFirst.mockResolvedValue({ id: "r1", isActive: true }); runtime.db.automationRule.update.mockResolvedValue({ id: "r1", isActive: false }); });
describe("automation actions", () => { it("requires CSRF and writes tenant-scoped rules", async () => { await expect(createAutomationRuleAction(form())).rejects.toThrow("redirect:/settings/automations?updated=created"); expect(runtime.security).toHaveBeenCalled(); expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ vendorId: "v1", trigger: "payment_paid" }) })); expect(runtime.audit).toHaveBeenCalled(); }); it("toggles only a rule in the current vendor", async () => { const f = new FormData(); f.set("ruleId", "r1"); await expect(toggleAutomationRuleAction(f)).rejects.toThrow("redirect:/settings/automations?updated=toggled"); expect(runtime.db.automationRule.findFirst).toHaveBeenCalledWith({ where: { id: "r1", vendorId: "v1" }, select: { id: true, isActive: true } }); });

  it("converts fixed voucher dollars to cents and rejects a free-order percentage", async () => {
    runtime.db.product.findFirst.mockResolvedValue({ id: "p1" });
    const fixed = form();
    fixed.delete("actionLine");
    fixed.set("actionVoucher", "on");
    fixed.set("productId", "p1");
    fixed.set("discountType", "fixed");
    fixed.set("discountValue", "100");
    fixed.set("expiresInDays", "30");
    await expect(createAutomationRuleAction(fixed)).rejects.toThrow("redirect:/settings/automations?updated=created");
    expect(runtime.db.automationRule.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ actions: [expect.objectContaining({ discountValue: 10_000 })] }),
    }));

    const freeOrder = new FormData();
    for (const [key, value] of fixed.entries()) freeOrder.set(key, value);
    freeOrder.set("discountType", "percentage");
    await expect(createAutomationRuleAction(freeOrder)).rejects.toThrow("redirect:/settings/automations?error=invalid_rule");
  });
});
