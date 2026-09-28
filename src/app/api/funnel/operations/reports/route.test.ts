import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/funnel-operations-service", () => ({
  FunnelOperationsError: class extends Error {},
  loadFunnelReports: mocks.load,
}));
import { GET } from "./route";
import { FunnelOperationsError } from "@/lib/funnel-operations-service";

it("returns only the tenant-scoped report with private no-store caching", async () => {
  const report = { generatedAt: "2026-09-27T00:00:00.000Z", stats: [] };
  mocks.load.mockResolvedValueOnce(report);
  const response = await GET(new Request("https://staging.example/api/funnel/operations/reports?pageId=synthetic_page"));
  expect(mocks.load).toHaveBeenCalledWith("synthetic_page");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual(report);
});

it("does not expose foreign Funnel details", async () => {
  mocks.load.mockRejectedValueOnce(new FunnelOperationsError("private tenant name"));
  const response = await GET(new Request("https://staging.example/api/funnel/operations/reports?pageId=foreign"));
  expect(response.status).toBe(404);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.text()).not.toContain("private tenant name");
});
