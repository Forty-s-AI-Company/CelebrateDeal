import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorOwner: vi.fn(),
  ruleFindFirst: vi.fn(),
  saveCommissionRuleAction: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorOwner: mocks.requireVendorOwner }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ commissionRuleSet: { findFirst: mocks.ruleFindFirst } }) }));
vi.mock("@/app/actions/commission-rule-actions", () => ({ saveCommissionRuleAction: mocks.saveCommissionRuleAction }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="csrf-token" /> }));

import CommissionSettingsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorOwner.mockResolvedValue({ vendor: { id: "vendor-current" } });
  mocks.ruleFindFirst.mockResolvedValue({
    id: "rule-3",
    version: 3,
    currency: "TWD",
    maxTotalRateBps: 2000,
    tiers: [
      { minMonthlySalesCents: 0, rateBps: 800 },
      { minMonthlySalesCents: 100_000, rateBps: 1000 },
    ],
    uplineLevels: [{ level: 1, bonusRateBps: 300 }],
  });
});

describe("CommissionSettingsPage", () => {
  it("reads only the current tenant policy and renders editable tiers", async () => {
    const html = renderToStaticMarkup(await CommissionSettingsPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.ruleFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId: "vendor-current", currency: "TWD", status: "ACTIVE" },
    }));
    expect(html).toContain("階梯式與團隊分潤");
    expect(html).toContain("版本 3");
    expect(html).toContain('name="tierMinAmount"');
    expect(html).toContain('name="tierRateBps"');
    expect(html).toContain('name="uplineBonusRateBps"');
    expect(html).toContain('name="maxTotalRateBps"');
  });

  it("renders the legacy fallback when no rule is active", async () => {
    mocks.ruleFindFirst.mockResolvedValue(null);
    const html = renderToStaticMarkup(await CommissionSettingsPage({ searchParams: Promise.resolve({ error: "invalid_rule" }) }));
    expect(html).toContain("LEGACY");
    expect(html).toContain("沿用各推廣者的固定佣金率");
    expect(html).toContain("規則格式不正確");
  });
});
