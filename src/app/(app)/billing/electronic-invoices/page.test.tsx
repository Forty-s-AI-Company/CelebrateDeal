import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireFinance: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireFinance }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ electronicInvoice: { findMany: mocks.findMany } }) }));
import ElectronicInvoicesPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinance.mockResolvedValue({ vendor: { id: "vendor-current" } });
  mocks.findMany.mockResolvedValue([{
    id: "invoice-1", invoiceNumber: "AB12345678", invoiceType: "company", buyerDisplay: "測試公司（統編末四碼 5257）",
    amountCents: 10_500, pretaxAmountCents: 10_000, taxAmountCents: 500, currency: "TWD", status: "allowance",
    issuedAt: new Date("2026-09-08T00:00:00Z"), order: { orderNumber: "ORDER-1" }, allowances: [{ id: "allowance-1" }],
  }]);
});

describe("ElectronicInvoicesPage", () => {
  it("queries only the authenticated vendor and renders the legal snapshot fields", async () => {
    const html = renderToStaticMarkup(await ElectronicInvoicesPage());
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-current" } }));
    expect(mocks.requireFinance).toHaveBeenCalledWith("/billing/electronic-invoices");
    for (const text of ["AB12345678", "ORDER-1", "統編末四碼 5257", "已開立折讓", "營業稅", "匯出發票紀錄 CSV", "自動電子發票尚未開放"]) expect(html).toContain(text);
    expect(html).toContain('href="/billing/electronic-invoices/export"');
    expect(html).toContain("付款成功、已儲存發票需求或匯出紀錄，均不代表已開立發票");
    expect(html).not.toContain("匯出開立報表 CSV");
    expect(html).not.toContain("付款後會自動排程開立");
  });

  it("keeps the unavailable notice in the empty state without promising issuance", async () => {
    mocks.findMany.mockResolvedValue([]);
    const html = renderToStaticMarkup(await ElectronicInvoicesPage());
    expect(html).toContain("自動電子發票尚未開放");
    expect(html).toContain("尚無電子發票紀錄");
    expect(html).toContain("付款紀錄與發票開立狀態需分別確認");
    expect(html).toContain("付款成功、已儲存發票需求或匯出紀錄，均不代表已開立發票");
    expect(html).not.toContain("匯出開立報表 CSV");
    expect(html).not.toContain("付款後會自動排程開立");
  });

  it("shows queued requests as pending with no invented invoice number or issue date", async () => {
    const existing = await mocks.findMany();
    mocks.findMany.mockResolvedValue([{ ...existing[0], invoiceNumber: null, issuedAt: null, status: "queued", allowances: [] }]);
    const html = renderToStaticMarkup(await ElectronicInvoicesPage());
    expect(html).toContain("自動電子發票尚未開放");
    expect(html).toContain("尚未開立（僅記錄需求）");
    expect(html).not.toContain("待處理");
    expect(html).toContain("付款成功、已儲存發票需求或匯出紀錄，均不代表已開立發票");
    expect(html).not.toContain("匯出開立報表 CSV");
    expect(html).toContain("尚無號碼");
    expect(html).toContain("尚未開立");
    expect(html).not.toContain("已開立折讓");
    expect(html).not.toContain("AB12345678");
  });

  it("does not query invoices when finance access is denied", async () => {
    mocks.requireFinance.mockRejectedValue(new Error("finance access denied"));
    await expect(ElectronicInvoicesPage()).rejects.toThrow("finance access denied");
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
