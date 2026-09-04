import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
import NewAffiliatePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
});

describe("/affiliates/new route", () => {
  it("requires a vendor manager and renders the MVP creation-disabled boundary", async () => {
    const html = renderToStaticMarkup(await NewAffiliatePage());

    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(html).toContain("新增聯盟夥伴目前停用");
    expect(html).toContain("暫停建立新的聯盟佣金負債");
    expect(html).not.toContain("affiliate-form");
  });
});
