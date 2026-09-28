import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorContext: mocks.auth }));
vi.mock("@/app/(app)/dashboard/dashboard-details", () => ({ loadDashboardDetails: mocks.load }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    auth: { member: { role: "owner" } },
    vendor: { id: "vendor-synthetic", supportEmail: "help@example.invalid", tracking: { googleTagManagerId: "GTM-SYNTHETIC" } },
  });
});

it("uses only the authenticated tenant and returns a private read-only snapshot", async () => {
  const snapshot = { data: { now: "2026-09-27T00:00:00.000Z" }, measurement: { readOperationCount: 13, totalDurationMs: 10, entries: [] } };
  mocks.load.mockResolvedValue(snapshot);
  const response = await GET(new Request("https://staging.example/api/dashboard/details?vendorId=foreign"));
  expect(mocks.load).toHaveBeenCalledWith({
    vendorId: "vendor-synthetic", memberRole: "owner", supportEmailConfigured: true,
    trackingConfigured: true, diagnosticDelayMs: 0,
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual(snapshot);
});

it("does not run detail reads for support users", async () => {
  mocks.auth.mockResolvedValueOnce({ auth: { member: { role: "support" } }, vendor: { id: "vendor-synthetic" } });
  const response = await GET(new Request("https://staging.example/api/dashboard/details"));
  expect(response.status).toBe(403);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.load).not.toHaveBeenCalled();
  expect(await response.json()).toEqual({ error: "UNAVAILABLE" });
});
