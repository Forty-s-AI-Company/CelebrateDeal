import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireFinance: vi.fn(), findMany: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorFinance: mocks.requireFinance }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ electronicInvoice: { findMany: mocks.findMany } }) }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireFinance.mockResolvedValue({
    vendor: { id: "vendor-current" }, user: { mfaFactor: { id: "factor" } }, session: { mfaVerifiedAt: new Date() },
  });
  mocks.findMany.mockResolvedValue([{
    invoiceNumber: "AB12345678", invoiceType: "company", buyerDisplay: "=unsafe",
    amountCents: 10_500, pretaxAmountCents: 10_000, taxAmountCents: 500, status: "issued",
    issuedAt: new Date("2026-09-08T00:00:00Z"), order: { orderNumber: "ORDER-1" },
  }]);
});

describe("GET electronic invoice CSV", () => {
  it.each([
    ["without a factor", null, null, "redirect:/mfa/setup?reason=step_up&next=%2Fbilling%2Felectronic-invoices"],
    ["with a stale verification", { id: "factor" }, new Date(Date.now() - 16 * 60_000), "redirect:/mfa/verify?reason=step_up&next=%2Fbilling%2Felectronic-invoices"],
  ])("does not export buyer data %s (F-027)", async (_label, mfaFactor, mfaVerifiedAt, destination) => {
    mocks.requireFinance.mockResolvedValue({ vendor: { id: "vendor-current" }, user: { mfaFactor }, session: { mfaVerifiedAt } });
    await expect(GET()).rejects.toThrow(destination);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

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
