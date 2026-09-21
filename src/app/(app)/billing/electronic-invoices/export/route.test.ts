import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireFinance: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireFinance }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ electronicInvoice: { findMany: mocks.findMany } }) }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinance.mockResolvedValue({ vendor: { id: "vendor-current" } });
  mocks.findMany.mockResolvedValue([{
    invoiceNumber: "AB12345678", invoiceType: "company", buyerDisplay: "=unsafe",
    amountCents: 10_500, pretaxAmountCents: 10_000, taxAmountCents: 500, status: "issued",
    issuedAt: new Date("2026-09-08T00:00:00Z"), order: { orderNumber: "ORDER-1" },
  }]);
});

describe("GET electronic invoice CSV", () => {
  it("is tenant-bound, no-store, UTF-8 BOM encoded, and neutralizes spreadsheet formulas", async () => {
    const response = await GET();
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    const csv = await response.text();
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-current" } }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv).toContain("\"'=unsafe\"");
    expect(csv).toContain("AB12345678");
  });
});
