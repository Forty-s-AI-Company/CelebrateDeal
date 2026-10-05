import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ load: vi.fn(), csrf: vi.fn(), requireVendorManager: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/funnel-operations-service", () => ({
  FunnelOperationsError: class extends Error {},
  loadFunnelOperations: mocks.load,
}));
vi.mock("@/lib/csrf", () => ({ CSRF_FIELD_NAME: "csrf", getCsrfToken: mocks.csrf }));
vi.mock("@/components/landing-pages/funnel-operations-panel", () => ({ FunnelOperationsPanel: () => <div>private editor</div> }));
import Page from "./page";
import { FunnelOperationsError } from "@/lib/funnel-operations-service";

beforeEach(() => vi.clearAllMocks());

it("renders a generic unavailable state without loading reports or exposing editor data", async () => {
  mocks.load.mockRejectedValue(new FunnelOperationsError("foreign private name"));
  const html = renderToStaticMarkup(await Page({ params: Promise.resolve({ id: "foreign" }), searchParams: Promise.resolve({}) }));
  expect(mocks.requireVendorManager).toHaveBeenCalledOnce();
  expect(html).toContain("無法開啟 Funnel");
  expect(html).not.toContain("foreign private name");
  expect(html).not.toContain("private editor");
  expect(mocks.csrf).not.toHaveBeenCalled();
});

it("does not disguise an unexpected database failure as an unavailable resource", async () => {
  const failure = new Error("database unavailable");
  mocks.load.mockRejectedValue(failure);
  await expect(Page({ params: Promise.resolve({ id: "page" }), searchParams: Promise.resolve({}) })).rejects.toBe(failure);
  expect(mocks.requireVendorManager).toHaveBeenCalledOnce();
});

it("rejects unauthorized access before loading private operations or issuing CSRF", async () => {
  // 權限拒絕必須先於私有資料查詢，不能只依賴服務層補擋。
  const denied = new Error("synthetic authorization denial");
  mocks.requireVendorManager.mockRejectedValueOnce(denied);
  await expect(Page({ params: Promise.resolve({ id: "private-page" }) })).rejects.toBe(denied);
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.csrf).not.toHaveBeenCalled();
});
