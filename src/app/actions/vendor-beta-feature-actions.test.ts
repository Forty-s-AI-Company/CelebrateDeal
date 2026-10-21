import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  requireFinanceAdmin: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  writeAuditLog: vi.fn(),
  assertServerActionSecurity: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: runtime.requireFinanceAdmin }));
vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: runtime.assertServerActionSecurity }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: runtime.writeAuditLog }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findUnique: runtime.findUnique, updateMany: runtime.updateMany } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { path }); },
}));

import { updateVendorBetaFeatureGrantsAction } from "./vendor-beta-feature-actions";

function form(vendorId: string, grants: string[]) {
  const data = new FormData();
  data.set("vendorId", vendorId);
  for (const grant of grants) data.append("grants", grant);
  return data;
}

async function redirectPath(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return (error as { path?: string }).path;
  }
  return null;
}

beforeEach(() => {
  vi.clearAllMocks();
  runtime.assertServerActionSecurity.mockResolvedValue(undefined);
  runtime.requireFinanceAdmin.mockResolvedValue({ user: { id: "admin-1" }, isPlatformAdmin: true });
  runtime.findUnique.mockResolvedValue({ id: "vendor-1", betaFeatureGrants: [], enabledFeatureModules: ["funnel_builder"] });
  runtime.updateMany.mockResolvedValue({ count: 1 });
});

describe("updateVendorBetaFeatureGrantsAction (F-001 / F-002)", () => {
  it("checks CSRF and the platform-admin guard before reading anything", async () => {
    runtime.requireFinanceAdmin.mockRejectedValueOnce(Object.assign(new Error("NEXT_REDIRECT"), { path: "/dashboard" }));
    await expect(redirectPath(updateVendorBetaFeatureGrantsAction(form("vendor-1", ["billing"])))).resolves.toBe("/dashboard");
    expect(runtime.assertServerActionSecurity).toHaveBeenCalledOnce();
    expect(runtime.findUnique).not.toHaveBeenCalled();
    expect(runtime.updateMany).not.toHaveBeenCalled();
  });

  it("rejects unknown modules and malformed vendor ids without writing", async () => {
    await expect(redirectPath(updateVendorBetaFeatureGrantsAction(form("vendor-1", ["billing", "funnel_builder"])))).resolves.toBe("/admin/vendor-features?error=invalid");
    await expect(redirectPath(updateVendorBetaFeatureGrantsAction(form("../vendor", ["billing"])))).resolves.toBe("/admin/vendor-features?error=invalid");
    expect(runtime.updateMany).not.toHaveBeenCalled();
  });

  it("writes the normalized grants with a compare-and-set and an audit record", async () => {
    await expect(redirectPath(updateVendorBetaFeatureGrantsAction(form("vendor-1", ["danmaku", "billing"])))).resolves.toBe("/admin/vendor-features?saved=1");
    expect(runtime.updateMany).toHaveBeenCalledWith({
      where: { id: "vendor-1", betaFeatureGrants: { equals: [] } },
      data: { betaFeatureGrants: ["billing", "danmaku"] },
    });
    expect(runtime.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      vendorId: "vendor-1", actorId: "admin-1", action: "update_vendor_beta_feature_grants",
      before: { betaFeatureGrants: [] }, after: { betaFeatureGrants: ["billing", "danmaku"] },
    }));
  });

  it("turns the merchant toggle on when consultation booking is first granted", async () => {
    await redirectPath(updateVendorBetaFeatureGrantsAction(form("vendor-1", ["consultation_booking"])));
    expect(runtime.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "vendor-1", betaFeatureGrants: { equals: [] }, enabledFeatureModules: { equals: ["funnel_builder"] } },
      data: { betaFeatureGrants: ["consultation_booking"], enabledFeatureModules: ["funnel_builder", "consultation_booking"] },
    }));
  });

  it("refuses an unknown vendor and a concurrent change", async () => {
    runtime.findUnique.mockResolvedValueOnce(null);
    await expect(redirectPath(updateVendorBetaFeatureGrantsAction(form("vendor-x", [])))).resolves.toBe("/admin/vendor-features?error=not_found");
    runtime.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(redirectPath(updateVendorBetaFeatureGrantsAction(form("vendor-1", ["courses"])))).resolves.toBe("/admin/vendor-features?error=conflict");
    expect(runtime.writeAuditLog).not.toHaveBeenCalled();
  });
});
