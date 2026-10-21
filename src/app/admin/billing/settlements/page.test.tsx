import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCsrfToken: vi.fn(),
  requireFinanceAdmin: vi.fn(),
  settlementFindMany: vi.fn(),
  vendorFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/csrf", () => ({
  CSRF_FIELD_NAME: "_csrf",
  getCsrfToken: mocks.getCsrfToken,
}));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    settlement: { findMany: mocks.settlementFindMany },
    vendor: { findMany: mocks.vendorFindMany },
  }),
}));

import AdminBillingSettlementsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCsrfToken.mockResolvedValue("synthetic-csrf-token");
  mocks.requireFinanceAdmin.mockResolvedValue({ member: { id: "finance-admin" } });
  mocks.settlementFindMany.mockResolvedValue([]);
  mocks.vendorFindMany.mockResolvedValue([]);
});

describe("/admin/billing/settlements feedback", () => {
  it.each([
    ["negative_payout", "調整後的結算金額不可小於 0 元，資料未儲存。"],
    ["conflict", "月結資料已被其他操作更新，請重新整理後再試一次。"],
    ["invalid_payout_account", "每個商家都必須恰好設定一筆有效的平台出款帳戶。"],
    ["invalid_adjustment", "調整金額必須是整數新台幣"],
    ["adjustment_reason_required", "請填寫調整原因"],
    ["same_approver", "申請人不能自行核准"],
    ["unclassified_payment_purpose", "無法判定用途的付款"],
    ["stale_settlement", "請先重新產生月結再鎖定"],
    ["carry_forward_target_locked", "下一期已經鎖定，因此不能再重新計算或調整。資料未變更"],
  ])("renders safe feedback for %s", async (error, expectedMessage) => {
    const html = renderToStaticMarkup(await AdminBillingSettlementsPage({
      searchParams: Promise.resolve({ error }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain(expectedMessage);
    expect(html).not.toContain("synthetic-account-number");
  });

  it("does not reflect an unknown error value", async () => {
    const html = renderToStaticMarkup(await AdminBillingSettlementsPage({
      searchParams: Promise.resolve({ error: "raw-provider-error" }),
    }));

    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("raw-provider-error");
  });
});
