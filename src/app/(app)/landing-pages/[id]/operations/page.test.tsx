import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), reports: vi.fn(), csrf: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: vi.fn() }));
vi.mock("@/lib/funnel-operations-service", () => ({
  FunnelOperationsError: class extends Error {},
  loadFunnelOperations: mocks.load, loadFunnelReports: mocks.reports,
}));
vi.mock("@/lib/csrf", () => ({ CSRF_FIELD_NAME: "csrf", getCsrfToken: mocks.csrf }));
vi.mock("@/components/landing-pages/funnel-operations-panel", () => ({ FunnelOperationsPanel: () => <div>private editor</div> }));
import Page from "./page";
import { FunnelOperationsError } from "@/lib/funnel-operations-service";

beforeEach(() => vi.clearAllMocks());

it("renders a generic unavailable state without loading reports or exposing editor data", async () => {
  mocks.load.mockRejectedValue(new FunnelOperationsError("foreign private name"));
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "foreign" }), searchParams: Promise.resolve({}) }));
  expect(html).toContain("無法開啟 Funnel");
  expect(html).not.toContain("foreign private name");
  expect(html).not.toContain("private editor");
  expect(mocks.reports).not.toHaveBeenCalled();
  expect(mocks.csrf).not.toHaveBeenCalled();
});

it("does not disguise an unexpected database failure as an unavailable resource", async () => {
  const failure = new Error("database unavailable");
  mocks.load.mockRejectedValue(failure);
  await expect(Page({ params: Promise.resolve({ id: "page" }), searchParams: Promise.resolve({}) })).rejects.toBe(failure);
  expect(mocks.reports).not.toHaveBeenCalled();
});
