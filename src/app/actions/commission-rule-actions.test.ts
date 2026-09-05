import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => {
  const tx = {
    commissionRuleSet: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    commissionRateTier: { createMany: vi.fn() },
    commissionUplineLevel: { createMany: vi.fn() },
  };
  return {
    tx,
    db: { $transaction: vi.fn() },
    auth: {
      vendor: { id: "vendor-current" },
      user: { id: "user-owner" },
      member: { role: "owner" },
    },
    assertServerActionSecurity: vi.fn(),
    requireVendorOwner: vi.fn(),
    writeAuditLog: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: runtime.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: runtime.redirect }));
vi.mock("@/lib/auth", () => ({ requireVendorOwner: runtime.requireVendorOwner }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: runtime.assertServerActionSecurity }));
vi.mock("@/lib/db", () => ({ getDb: () => runtime.db }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: runtime.writeAuditLog }));

import { saveCommissionRuleAction } from "@/app/actions/commission-rule-actions";

function validForm() {
  const data = new FormData();
  data.set("currency", "TWD");
  data.set("maxTotalRateBps", "2000");
  data.append("tierMinAmount", "0");
  data.append("tierRateBps", "800");
  data.append("uplineBonusRateBps", "300");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.requireVendorOwner.mockResolvedValue(runtime.auth);
  runtime.tx.commissionRuleSet.findFirst.mockResolvedValue({ version: 4 });
  runtime.tx.commissionRuleSet.updateMany.mockResolvedValue({ count: 1 });
  runtime.tx.commissionRuleSet.create.mockResolvedValue({ id: "rule-5", version: 5 });
  runtime.tx.commissionRuleSet.findUniqueOrThrow.mockResolvedValue({ id: "rule-5", version: 5, tiers: [], uplineLevels: [] });
  runtime.db.$transaction.mockImplementation(async (callback: (tx: typeof runtime.tx) => Promise<unknown>) => callback(runtime.tx));
});

describe("saveCommissionRuleAction", () => {
  it("archives and creates rules only inside the authenticated tenant", async () => {
    await expect(saveCommissionRuleAction(validForm())).rejects.toThrow("redirect:/settings/commissions?updated=rule_saved");

    expect(runtime.assertServerActionSecurity).toHaveBeenCalledWith(expect.any(FormData));
    expect(runtime.tx.commissionRuleSet.findFirst).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current" },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    expect(runtime.tx.commissionRuleSet.updateMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", currency: "TWD", status: "ACTIVE" },
      data: { status: "ARCHIVED", archivedAt: expect.any(Date) },
    });
    expect(runtime.tx.commissionRuleSet.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ vendorId: "vendor-current", version: 5, currency: "TWD" }),
    }));
    expect(runtime.tx.commissionRateTier.createMany).toHaveBeenCalledWith({
      data: [{ vendorId: "vendor-current", commissionRuleSetId: "rule-5", minMonthlySalesCents: 0, rateBps: 800 }],
    });
    expect(runtime.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: "vendor-current",
      action: "activate_commission_rule",
      targetId: "rule-5",
    }));
  });

  it("rejects invalid configuration before opening a transaction", async () => {
    const data = validForm();
    data.set("maxTotalRateBps", "500");
    await expect(saveCommissionRuleAction(data)).rejects.toThrow("redirect:/settings/commissions?error=invalid_rule");
    expect(runtime.db.$transaction).not.toHaveBeenCalled();
  });
});
