import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorOwner: vi.fn(),
  requestAuditMeta: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
  transaction: vi.fn(),
  billingPlanFindFirst: vi.fn(),
  subscriptionFindMany: vi.fn(),
  subscriptionUpdateMany: vi.fn(),
  subscriptionCreate: vi.fn(),
  usageLimitUpsert: vi.fn(),
  auditLogCreate: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.requireVendorOwner }));
vi.mock("@/lib/audit", () => ({
  auditSnapshot: (value: unknown) => value,
  requestAuditMeta: mocks.requestAuditMeta,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ $transaction: mocks.transaction }),
}));

import { selectBillingPlanAction } from "./actions";

const plan = {
  id: "plan-pro",
  code: "PRO",
  name: "專業方案",
  isActive: true,
  monthlyPriceCents: 19900,
  includedStreamMinutes: 6000,
  includedStorageMinutes: 1200,
  includedCredits: 500,
};

const previousSubscription = {
  id: "subscription-old",
  vendorId: "vendor-current",
  planId: "plan-basic",
  paymentMode: "platform",
  billingCycleDay: 8,
  status: "active",
  startedAt: new Date("2026-07-01T00:00:00.000Z"),
};

const createdSubscription = {
  ...previousSubscription,
  id: "subscription-new",
  planId: plan.id,
};

function formData() {
  const data = new FormData();
  data.set("_csrf", "valid-token");
  data.set("planId", plan.id);
  data.set("monthlyPriceCents", "1");
  data.set("vendorId", "vendor-attacker");
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireVendorOwner.mockResolvedValue({
    vendor: { id: "vendor-current" },
    member: { id: "member-owner", role: "owner" },
  });
  mocks.billingPlanFindFirst.mockResolvedValue(plan);
  mocks.subscriptionFindMany.mockResolvedValue([previousSubscription]);
  mocks.subscriptionUpdateMany.mockResolvedValue({ count: 1 });
  mocks.subscriptionCreate.mockResolvedValue(createdSubscription);
  mocks.usageLimitUpsert.mockResolvedValue({ id: "limit-current" });
  mocks.auditLogCreate.mockResolvedValue({ id: "audit-plan-change" });
  mocks.requestAuditMeta.mockResolvedValue({ ipAddress: "203.0.113.5", userAgent: "test-agent" });
  mocks.transaction.mockImplementation(async (callback) => callback({
    billingPlan: { findFirst: mocks.billingPlanFindFirst },
    vendorSubscription: {
      findMany: mocks.subscriptionFindMany,
      updateMany: mocks.subscriptionUpdateMany,
      create: mocks.subscriptionCreate,
    },
    vendorUsageLimit: { upsert: mocks.usageLimitUpsert },
    auditLog: { create: mocks.auditLogCreate },
  }));
});

describe("selectBillingPlanAction", () => {
  it("validates CSRF and owner access before changing the current vendor plan", async () => {
    const data = formData();

    await expect(selectBillingPlanAction(data)).rejects.toThrow("redirect:/billing/plans?status=changed");

    expect(mocks.assertServerActionSecurity).toHaveBeenCalledWith(data);
    expect(mocks.requireVendorOwner).toHaveBeenCalledOnce();
    expect(mocks.billingPlanFindFirst).toHaveBeenCalledWith({
      where: { id: plan.id, isActive: true },
    });
    expect(mocks.subscriptionFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", status: "active" },
      orderBy: { startedAt: "desc" },
    });
    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-current", status: "active" },
      data: { status: "ended", endedAt: expect.any(Date) },
    });
    expect(mocks.subscriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-current",
        planId: plan.id,
        paymentMode: "platform",
        billingCycleDay: 8,
        status: "active",
      }),
    });
    expect(mocks.subscriptionCreate.mock.calls[0]?.[0].data).not.toHaveProperty("monthlyPriceCents");
    expect(mocks.subscriptionCreate.mock.calls[0]?.[0].data.vendorId).not.toBe("vendor-attacker");
    expect(mocks.usageLimitUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-current" },
      update: {
        billingPlanId: plan.id,
        streamMinutesLimit: plan.includedStreamMinutes,
        storageMinutesLimit: plan.includedStorageMinutes,
        creditsLimit: plan.includedCredits,
      },
    }));
    expect(mocks.auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-current",
        actorId: "member-owner",
        action: "select_billing_plan",
        targetId: "subscription-new",
        ipAddress: "203.0.113.5",
        userAgent: "test-agent",
      }),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/billing/plans");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/billing/usage");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("keeps repeated submissions idempotent when the selected plan is already current", async () => {
    mocks.subscriptionFindMany.mockResolvedValue([{ ...previousSubscription, planId: plan.id }]);

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?status=current");

    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled();
    expect(mocks.usageLimitUpsert).not.toHaveBeenCalled();
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing or inactive plan without changing subscriptions", async () => {
    mocks.billingPlanFindFirst.mockResolvedValue(null);

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?error=unavailable");

    expect(mocks.subscriptionFindMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled();
  });

  it("does not access billing data when owner authorization fails", async () => {
    mocks.requireVendorOwner.mockRejectedValue(new Error("redirect:/settings/security?error=owner_required"));

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("owner_required");

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("converges duplicate active subscriptions to one newly selected subscription", async () => {
    mocks.subscriptionFindMany.mockResolvedValue([
      { ...previousSubscription, id: "duplicate-1", planId: plan.id },
      { ...previousSubscription, id: "duplicate-2", planId: plan.id },
    ]);

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?status=changed");

    expect(mocks.subscriptionUpdateMany).toHaveBeenCalledOnce();
    expect(mocks.subscriptionCreate).toHaveBeenCalledOnce();
  });

  it("bounds serialization retries and returns a safe conflict state", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2034" });

    await expect(selectBillingPlanAction(formData())).rejects.toThrow("redirect:/billing/plans?error=conflict");

    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.auditLogCreate).not.toHaveBeenCalled();
  });
});
