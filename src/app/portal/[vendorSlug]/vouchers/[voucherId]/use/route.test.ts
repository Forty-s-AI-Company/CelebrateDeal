import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), find: vi.fn(), update: vi.fn(), csrf: vi.fn(), hash: vi.fn(() => "bearer-hash") }));
vi.mock("@/lib/student-portal-auth", () => ({ requireStudentPortalSession: mocks.session }));
vi.mock("@/lib/live-interaction", () => ({ hashInteractionBearer: mocks.hash }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ automationVoucherGrant: { updateMany: mocks.update, findFirst: mocks.find } }) }));
vi.mock("@/lib/csrf", () => ({ CSRF_FIELD_NAME: "_csrf", verifyCsrfToken: mocks.csrf }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
import { POST } from "./route";

beforeEach(() => { vi.clearAllMocks(); mocks.csrf.mockResolvedValue(true); mocks.find.mockResolvedValue({ currency: "TWD", product: { currency: "TWD", customCheckoutFields: [] } }); mocks.session.mockResolvedValue({ session: { vendorId: "vendor-1", customerKeyHash: "hash" } }); mocks.update.mockResolvedValue({ count: 1 }); });
describe("student portal voucher use route", () => {
  it("rotates only the authenticated tenant's active voucher into the existing checkout exchange", async () => {
    const response = await POST(new Request("https://app.example.test/portal/teacher/vouchers/voucher-1/use", { method: "POST", headers: { origin: "https://app.example.test" }, body: new URLSearchParams({ _csrf: "synthetic-csrf" }) }), { params: Promise.resolve({ vendorSlug: "teacher", voucherId: "voucher-1" }) });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "voucher-1", vendorId: "vendor-1", customerKeyHash: "hash", redeemedAt: null, usedOrderId: null }) }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/api/automation/vouchers/redeem?token=");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});

it("rejects cross-origin voucher rotation before reading any tenant record", async () => {
  const response = await POST(new Request("https://app.example.test/portal/teacher/vouchers/voucher-1/use", { method: "POST", headers: { origin: "https://other.example.test" }, body: new URLSearchParams({ _csrf: "synthetic-csrf" }) }), { params: Promise.resolve({ vendorSlug: "teacher", voucherId: "voucher-1" }) });
  expect(response.status).toBe(403); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it("rejects invalid CSRF before rotating a voucher", async () => {
  mocks.csrf.mockResolvedValue(false);
  const response = await POST(new Request("https://app.example.test/portal/teacher/vouchers/voucher-1/use", { method: "POST", headers: { origin: "https://app.example.test" }, body: new URLSearchParams({ _csrf: "wrong" }) }), { params: Promise.resolve({ vendorSlug: "teacher", voucherId: "voucher-1" }) });
  expect(response.status).toBe(403); expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});

it.each([null, { currency: "TWD", product: { currency: "TWD", customCheckoutFields: [{ invalid: true }] } }, { currency: "TWD", product: { currency: "USD", customCheckoutFields: [] } }])("does not rotate a voucher when its product is unavailable or malformed", async (row) => {
  mocks.find.mockResolvedValue(row);
  const response = await POST(new Request("https://app.example.test/portal/teacher/vouchers/voucher-1/use", { method: "POST", headers: { origin: "https://app.example.test" }, body: new URLSearchParams({ _csrf: "synthetic-csrf" }) }), { params: Promise.resolve({ vendorSlug: "teacher", voucherId: "voucher-1" }) });
  expect(mocks.update).not.toHaveBeenCalled();
  expect(response.headers.get("location")).toBe("https://app.example.test/portal/teacher?voucher=unavailable");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});

it("keeps the voucher exchange on the public origin behind an internal proxy", async () => {
  const response = await POST(new Request("http://localhost:31047/portal/teacher/vouchers/voucher-1/use", { method: "POST", body: new URLSearchParams({ _csrf: "synthetic-csrf" }) }), { params: Promise.resolve({ vendorSlug: "teacher", voucherId: "voucher-1" }) });
  expect(new URL(response.headers.get("location")!).origin).toBe("https://app.example.test");
  const readWhere = mocks.find.mock.calls[0]?.[0].where;
  const updateWhere = mocks.update.mock.calls[0]?.[0].where;
  expect(readWhere.product.is).toMatchObject({ vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true, inventory: { gt: 0 }, priceCents: { gt: 0 } });
  expect(updateWhere.product.is).toEqual({ ...readWhere.product.is, currency: "TWD" });
  expect(updateWhere.currency).toBe("TWD");
});
