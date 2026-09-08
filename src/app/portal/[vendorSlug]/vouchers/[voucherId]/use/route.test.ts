import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), update: vi.fn(), hash: vi.fn(() => "bearer-hash") }));
vi.mock("@/lib/student-portal-auth", () => ({ requireStudentPortalSession: mocks.session }));
vi.mock("@/lib/live-interaction", () => ({ hashInteractionBearer: mocks.hash }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ automationVoucherGrant: { updateMany: mocks.update } }) }));
import { GET } from "./route";

beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ session: { vendorId: "vendor-1", customerKeyHash: "hash" } }); mocks.update.mockResolvedValue({ count: 1 }); });
describe("student portal voucher use route", () => {
  it("rotates only the authenticated tenant's active voucher into the existing checkout exchange", async () => {
    const response = await GET(new Request("https://app.example.test/portal/teacher/vouchers/voucher-1/use"), { params: Promise.resolve({ vendorSlug: "teacher", voucherId: "voucher-1" }) });
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "voucher-1", vendorId: "vendor-1", customerKeyHash: "hash", redeemedAt: null, usedOrderId: null }) }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/api/automation/vouchers/redeem?token=");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
