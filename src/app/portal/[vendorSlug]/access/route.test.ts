import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), consume: vi.fn(), setCookie: vi.fn(), vendor: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ vendor: { findFirst: mocks.vendor } }) }));
vi.mock("@/lib/student-portal-auth", () => ({ verifyStudentPortalAccessToken: mocks.verify, consumeStudentPortalAccessToken: mocks.consume, setStudentPortalSessionCookie: mocks.setCookie }));
vi.mock("@/lib/app-url", () => ({ getCanonicalAppUrl: () => "https://app.example.test" }));
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

it("rejects checkout-purpose capabilities before token consumption or session creation", async () => {
  const response = await GET(new Request("https://app.example.test/portal/teacher/access?purpose=checkout&token=synthetic"), { params: Promise.resolve({ vendorSlug: "teacher" }) });
  expect(response.status).toBe(303); expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled(); expect(mocks.setCookie).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});
it("keeps failed token redirects private", async () => {
  mocks.verify.mockReturnValue(null);
  const response = await GET(new Request("https://app.example.test/portal/teacher/access?token=synthetic"), { params: Promise.resolve({ vendorSlug: "teacher" }) });
  expect(mocks.consume).not.toHaveBeenCalled(); expect(mocks.setCookie).not.toHaveBeenCalled();
  expect(response.headers.get("cache-control")).toBe("private, no-store"); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
});

it("uses the configured public origin when the reverse proxy supplies an internal URL", async () => {
  const response = await GET(new Request("http://localhost:31047/portal/teacher/access?token=synthetic"), { params: Promise.resolve({ vendorSlug: "teacher" }) });
  expect(response.headers.get("location")).toBe("https://app.example.test/portal/teacher");
  expect(mocks.setCookie).toHaveBeenCalledOnce();
});
