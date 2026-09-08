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
    for (const text of ["AB12345678", "ORDER-1", "統編末四碼 5257", "已開立折讓", "營業稅", "匯出開立報表 CSV"]) expect(html).toContain(text);
  });
});
