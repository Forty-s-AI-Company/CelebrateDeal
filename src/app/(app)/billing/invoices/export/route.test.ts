import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  requireVendor: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ invoice: { findMany: mocks.findMany } }),
}));

import BillingInvoicesPage from "../page";
import { GET } from "./route";

const currentVendor = { id: "vendor-current" };
const currentInvoice = {
  id: "invoice-current",
  vendorId: "vendor-current",
  invoiceNumber: "INV-2026-07-001",
  monthKey: "2026-07",
  monthlyFeeCents: 10000,
  overflowFeeCents: 2500,
  paymentServiceFeeCents: 300,
  transactionServiceFeeCents: 400,
  affiliateManagementFeeCents: 500,
  subtotalCents: 13700,
  taxCents: 685,
  totalCents: 14385,
  status: "issued",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
};
const otherVendorInvoice = {
  ...currentInvoice,
  id: "invoice-other",
  vendorId: "vendor-other",
  invoiceNumber: "OTHER-VENDOR-INVOICE",
  monthKey: "2026-06",
  status: "paid",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue(currentVendor);
  mocks.findMany.mockResolvedValue([currentInvoice]);
});

describe("/billing/invoices/export route", () => {
  it("authenticates the vendor, queries only its invoices, and exports the required CSV fields", async () => {
    const response = await GET();
    const bytes = new Uint8Array(await response.arrayBuffer());
    const csv = new TextDecoder().decode(bytes);

    expect(mocks.requireVendor).toHaveBeenCalledOnce();
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { vendorId: currentVendor.id },
      orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
    });
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="invoices.csv"');
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toBe(
      '"帳單編號","月份","月費","超額用量費","金流服務費","交易服務費","聯盟結算管理費","小計","稅額","總額","狀態"\n"INV-2026-07-001","2026-07","100","25","3","4","5","137","6.85","143.85","issued"',
    );
  });

  it("excludes other vendors' invoices from the exported content", async () => {
    mocks.findMany.mockResolvedValue([currentInvoice]);

    const response = await GET();
    const csv = await response.text();

    expect(csv).toContain(currentInvoice.invoiceNumber);
    expect(csv).not.toContain(otherVendorInvoice.invoiceNumber);
    expect(csv).not.toContain(otherVendorInvoice.monthKey);
  });

  it("neutralizes spreadsheet formulas in every cell", async () => {
    mocks.findMany.mockResolvedValue([{
      ...currentInvoice,
      invoiceNumber: '=HYPERLINK("https://attacker.example")',
      monthKey: "+2026-07",
      monthlyFeeCents: -100,
      status: "@issued",
    }]);

    const response = await GET();
    const csv = await response.text();

    expect(csv).toContain("\"'=HYPERLINK(\"\"https://attacker.example\"\")\"");
    expect(csv).toContain("\"'+2026-07\"");
    expect(csv).toContain("\"'-1\"");
    expect(csv).toContain("\"'@issued\"");
  });
});

describe("/billing/invoices page", () => {
  it("links the export control to the protected CSV route", async () => {
    const html = renderToStaticMarkup(await BillingInvoicesPage());

    expect(html).toContain('href="/billing/invoices/export"');
    expect(html).toContain("匯出 CSV");
  });
});
