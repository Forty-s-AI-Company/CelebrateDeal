import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), consume: vi.fn(), setCookie: vi.fn(), vendor: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findFirst: mocks.vendor } }) }));
vi.mock("@/lib/student-portal-auth", () => ({ verifyStudentPortalAccessToken: mocks.verify, consumeStudentPortalAccessToken: mocks.consume, setStudentPortalSessionCookie: mocks.setCookie }));
import { GET } from "./route";

beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockReturnValue({ vendorId: "vendor-1" }); mocks.vendor.mockResolvedValue({ id: "vendor-1" }); mocks.consume.mockResolvedValue({ vendorId: "vendor-1", customerKeyHash: "hash" }); });
describe("student portal access route", () => {
  it("verifies the slug before consuming the one-time token and creates the session", async () => {
    const response = await GET(new Request("https://app.example.test/portal/teacher/access?token=signed"), { params: Promise.resolve({ vendorSlug: "teacher" }) });
    expect(mocks.vendor).toHaveBeenCalledWith({ where: { id: "vendor-1", slug: "teacher" }, select: { id: true } });
    expect(mocks.consume).toHaveBeenCalledAfter(mocks.vendor);
    expect(mocks.setCookie).toHaveBeenCalledWith({ vendorId: "vendor-1", customerKeyHash: "hash" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/portal/teacher");
  });
  it("does not burn a token when its tenant slug does not match", async () => {
    mocks.vendor.mockResolvedValue(null);
    await GET(new Request("https://app.example.test/portal/wrong/access?token=signed"), { params: Promise.resolve({ vendorSlug: "wrong" }) });
    expect(mocks.consume).not.toHaveBeenCalled();
  });
});
