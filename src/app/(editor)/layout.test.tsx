import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ manager: vi.fn(), pathname: vi.fn(() => "/landing-pages/page-1/edit") }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.manager }));
vi.mock("next/navigation", () => ({ usePathname: mocks.pathname }));
vi.mock("@/components/app-shell", () => ({ AppShell: () => { throw new Error("The full-screen editor must not render the AppShell"); } }));

import FullScreenEditorLayout from "./layout";

const vendor = (enabledFeatureModules: string[]) => ({ id: "vendor-1", name: "合成商家", enabledFeatureModules, betaFeatureGrants: [] });

beforeEach(() => vi.clearAllMocks());

it("renders the editor without the app shell for an enabled module", async () => {
  mocks.manager.mockResolvedValue(vendor(["funnel_builder"]));
  const html = renderToStaticMarkup(await FullScreenEditorLayout({ children: <main>編輯器內容</main> }));
  expect(mocks.manager).toHaveBeenCalledOnce();
  expect(html).toContain("編輯器內容");
  expect(html).not.toContain("data-feature-disabled");
});

it("keeps the same module gate as the app shell", async () => {
  mocks.manager.mockResolvedValue(vendor(["live_webinar"]));
  const html = renderToStaticMarkup(await FullScreenEditorLayout({ children: <main>編輯器內容</main> }));
  expect(html).toContain('data-feature-disabled="funnel_builder"');
  expect(html).not.toContain("編輯器內容");
});

it("stops before rendering anything when the manager check fails", async () => {
  const denied = new Error("synthetic authorization denial");
  mocks.manager.mockRejectedValueOnce(denied);
  await expect(FullScreenEditorLayout({ children: "x" })).rejects.toBe(denied);
});
