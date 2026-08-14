import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  templateFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ messageTemplate: { findMany: mocks.templateFindMany } }),
}));

import MessageTemplatesPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.templateFindMany.mockResolvedValue([]);
});

describe("MessageTemplatesPage", () => {
  it("announces that linked live reminders are being updated", async () => {
    const html = renderToStaticMarkup(await MessageTemplatesPage({
      searchParams: Promise.resolve({ notice: "reminders_reconciling" }),
    }));

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("使用這份模板的直播提醒正在分批更新");
  });
});
