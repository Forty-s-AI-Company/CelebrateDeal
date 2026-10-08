import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), csrf: vi.fn(), policy: vi.fn(), export: vi.fn(), csv: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.auth }));
vi.mock("@/lib/csrf", () => ({ CSRF_FIELD_NAME: "csrfToken", verifyCsrfToken: mocks.csrf }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ merchantAffiliatePayoutPolicy: { findUnique: mocks.policy } }) }));
vi.mock("@/lib/affiliate-remuneration-quotes", () => ({ exportAffiliateRemunerationQuote: mocks.export }));
vi.mock("@/lib/affiliate-remuneration-csv", () => ({ affiliateRemunerationCsv: mocks.csv }));
import { POST } from "./route";
const context = { params: Promise.resolve({ affiliateId: "affiliate_a", snapshotId: "snapshot_a" }) };
function request(token = "synthetic-csrf", origin = "https://example.test") {
  return new Request("https://example.test/api/affiliates/affiliate_a/remuneration/snapshot_a/export", { method: "POST", headers: { origin }, body: new URLSearchParams({ csrfToken: token, vendorId: "forged-vendor", bankFeeCents: "0" }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "actual-user", mfaFactor: null }, vendor: { id: "actual-vendor", enabledFeatureModules: ["affiliate_program", "tax_remuneration"] }, isMfaVerified: true });
  mocks.csrf.mockResolvedValue(true); mocks.policy.mockResolvedValue({ bankFeeCents: 1500, enabled: true });
  mocks.export.mockResolvedValue({ snapshotId: "snapshot_a" }); mocks.csv.mockReturnValue("synthetic-private-csv");
});
describe("private remuneration export POST", () => {
  it("uses authenticated tenant/server policy and returns a no-store attachment", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.export).toHaveBeenCalledWith(expect.anything(), { userId: "actual-user" }, { vendorId: "actual-vendor", affiliateId: "affiliate_a" }, "snapshot_a", { bankFeeCents: 1500 });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="affiliate-remuneration-snapshot_a.csv"');
    expect(await response.text()).toBe("synthetic-private-csv");
  });
  it("rejects cross-origin before auth or export", async () => {
    expect((await POST(request("synthetic", "https://foreign.test"), context)).status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.export).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated and unverified MFA requests", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await POST(request(), context)).status).toBe(401);
    mocks.auth.mockResolvedValueOnce({ user: { id: "actual-user", mfaFactor: {} }, vendor: { id: "actual-vendor" }, isMfaVerified: false });
    expect((await POST(request(), context)).status).toBe(401);
    expect(mocks.export).not.toHaveBeenCalled();
  });
  it("rejects missing/invalid CSRF and oversized body", async () => {
    mocks.csrf.mockResolvedValue(false);
    expect((await POST(request(), context)).status).toBe(403);
    expect((await POST(request("x".repeat(5000)), context)).status).toBe(403);
    expect(mocks.export).not.toHaveBeenCalled();
  });
  it("does not emit private data for denied ownership or disabled policy", async () => {
    mocks.export.mockResolvedValueOnce(null);
    const response = await POST(request(), context);
    expect(response.status).toBe(409); expect(await response.text()).not.toContain("synthetic-private-csv");
    mocks.policy.mockResolvedValueOnce({ enabled: false, bankFeeCents: 1500 });
    expect((await POST(request(), context)).status).toBe(409);
    expect(mocks.csv).not.toHaveBeenCalled();
  });
  it("rejects invalid attachment identifiers and disabled module", async () => {
    expect((await POST(request(), { params: Promise.resolve({ affiliateId: "affiliate_a", snapshotId: "../private" }) })).status).toBe(404);
    mocks.auth.mockResolvedValueOnce({ user: { id: "actual-user", mfaFactor: null }, vendor: { id: "actual-vendor", enabledFeatureModules: [] }, isMfaVerified: true });
    expect((await POST(request(), context)).status).toBe(404);
    expect(mocks.export).not.toHaveBeenCalled();
  });
});
