import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  paymentAccountFindMany: vi.fn(),
  requireVendorFinance: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireVendorFinance }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    payoutBatch: { findMany: mocks.findMany },
    paymentAccount: { findMany: mocks.paymentAccountFindMany },
  }),
}));
vi.mock("@/components/csrf-field", () => ({
  CsrfField: () => <input type="hidden" name="_csrf" value="synthetic-csrf" />,
}));
vi.mock("./actions", () => ({ saveVendorPayoutAccountAction: vi.fn() }));

import BillingPayoutsPage from "./page";

const currentVendor = { id: "vendor-current" };
const batch = {
  id: "batch-1",
  batchNumber: "PAYOUT-2026-07",
  batchDate: new Date("2026-07-01T00:00:00.000Z"),
  totalCount: 2,
  totalAmountCents: 30000,
  status: "reviewing",
  items: [
    {
      id: "payout-current",
      vendorId: "vendor-current",
      bankCodeDisplay: "812",
      bankAccountDisplayNumber: "1234567890",
      bankAccountDisplayName: "收款戶名",
      bankAccountEncrypted: null,
      payoutAmountCents: 10000,
      status: "pending",
      failReason: null,
      createdAt: new Date("2026-07-02T00:00:00.000Z"),
      vendor: { name: "目前商家" },
    },
    {
      id: "payout-other",
      vendorId: "vendor-other",
      bankCodeDisplay: "999",
      bankAccountDisplayNumber: "0987654321",
      bankAccountDisplayName: "其他商家戶名",
      bankAccountEncrypted: null,
      payoutAmountCents: 20000,
      status: "paid",
      failReason: "其他商家結算失敗",
      createdAt: new Date("2026-07-03T00:00:00.000Z"),
      vendor: { name: "其他商家" },
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorFinance.mockResolvedValue({ vendor: currentVendor, member: { role: "accountant" } });
  mocks.paymentAccountFindMany.mockResolvedValue([]);
  mocks.findMany.mockImplementation(async (query) => {
    const vendorId = query.include.items.where.vendorId;
    return query.where.items.some.vendorId === vendorId
      ? [{ ...batch, items: batch.items.filter((item) => item.vendorId === vendorId) }]
      : [];
  });
});

describe("/billing/payouts route", () => {
  it("authenticates the current vendor and scopes payout batches and items to it", async () => {
    await BillingPayoutsPage();

    expect(mocks.requireVendorFinance).toHaveBeenCalledExactlyOnceWith("/billing/payouts");
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { items: { some: { vendorId: currentVendor.id } } },
      orderBy: { batchDate: "desc" },
      include: {
        items: {
          where: { vendorId: currentVendor.id },
          include: { vendor: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
  });

  it("does not render a bank export control or another vendor's payout data from a shared batch", async () => {
    const html = renderToStaticMarkup(await BillingPayoutsPage());

    expect(html).toContain("目前商家");
    expect(html).toContain("812");
    expect(html).toContain("****7890");
    expect(html).toContain("收＊＊＊");
    expect(html).not.toContain("1234567890");
    expect(html).not.toContain("收款戶名");
    expect(html).toContain("$100");
    expect(html).toContain("1 筆");
    expect(html).not.toContain("匯出銀行檔");
    expect(html).not.toContain("其他商家");
    expect(html).not.toContain("999");
    expect(html).not.toContain("0987654321");
    expect(html).not.toContain("$300");
    expect(html).not.toContain("其他商家結算失敗");
  });

  it("scopes the payout account read to the session vendor and shows only masked values", async () => {
    mocks.paymentAccountFindMany.mockResolvedValue([{
      status: "active",
      bankAccountEncrypted: "v2.synthetic.envelope",
      bankAccountLegacyName: "王＊＊",
      bankCodeLegacy: "812",
      bankAccountLegacyNumber: "****4321",
    }]);
    const html = renderToStaticMarkup(await BillingPayoutsPage());

    expect(mocks.paymentAccountFindMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { vendorId: currentVendor.id, mode: "platform" },
    }));
    expect(html).toContain("撥款帳號");
    expect(html).toContain("****4321");
    expect(html).toContain("啟用中");
    expect(html).not.toContain("v2.synthetic.envelope");
  });

  it("re-masks a pre-backfill plaintext legacy row instead of rendering it", async () => {
    mocks.paymentAccountFindMany.mockResolvedValue([{
      status: "active",
      bankAccountEncrypted: null,
      bankAccountLegacyName: "測試商家",
      bankCodeLegacy: "700",
      bankAccountLegacyNumber: "00123456789",
    }]);
    const html = renderToStaticMarkup(await BillingPayoutsPage());

    expect(html).toContain("****6789");
    expect(html).not.toContain("00123456789");
    expect(html).not.toContain("測試商家");
  });

  it("shows the edit form only to the vendor owner", async () => {
    const accountantHtml = renderToStaticMarkup(await BillingPayoutsPage());
    expect(accountantHtml).not.toContain('name="accountNumber"');
    expect(accountantHtml).toContain("只有商家擁有者可以修改撥款帳號");

    mocks.requireVendorFinance.mockResolvedValue({ vendor: currentVendor, member: { role: "owner" } });
    const ownerHtml = renderToStaticMarkup(await BillingPayoutsPage());
    expect(ownerHtml).toContain('name="accountNumber"');
    expect(ownerHtml).toContain('name="_csrf"');
    expect(ownerHtml).not.toContain('name="vendorId"');
  });

  it("renders a localized result message from the action redirect", async () => {
    const html = renderToStaticMarkup(await BillingPayoutsPage({
      searchParams: Promise.resolve({ payoutAccount: "invalid_bank_code" }),
    }));
    expect(html).toContain("銀行代碼請填 3 碼數字");
  });

  it("refuses to pick one of several platform accounts", async () => {
    const row = { status: "active", bankAccountEncrypted: null, bankAccountLegacyName: "甲＊", bankCodeLegacy: "812", bankAccountLegacyNumber: "****1111" };
    mocks.paymentAccountFindMany.mockResolvedValue([row, { ...row, bankAccountLegacyNumber: "****2222" }]);
    const html = renderToStaticMarkup(await BillingPayoutsPage());
    expect(html).toContain("此商家有多筆撥款帳號紀錄");
    expect(html).not.toContain("****1111");
  });
});
