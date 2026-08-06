import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/components/affiliate-form", () => ({ AffiliateForm: () => <div data-testid="affiliate-form" /> }));

import NewAffiliatePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
});

describe("/affiliates/new route", () => {
  it("requires a vendor manager and renders the creation form boundary", async () => {
    const html = renderToStaticMarkup(await NewAffiliatePage());

    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(html).toContain("新增聯盟夥伴");
    expect(html).toContain("建立推廣碼與來源設定");
    expect(html).toContain('data-testid="affiliate-form"');
  });
});
