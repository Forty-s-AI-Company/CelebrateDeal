import { afterEach, describe, expect, it, vi } from "vitest";
import { partnerProductClickEndpoint, TrackedTeamFunnelProductLink } from "./tracked-team-funnel-product-link";

async function flushNavigation() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("TrackedTeamFunnelProductLink", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a source-page-bound click endpoint", () => {
    expect(partnerProductClickEndpoint("partner b")).toBe("/api/affiliate-clicks?sourcePage=partner+b");
  });

  it("records the server-owned page context before normal navigation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    const assign = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", { crypto: { randomUUID: () => "visitor-1" }, location: { assign } });

    const tree = TrackedTeamFunnelProductLink({
      href: "https://shop.example.test/product",
      vendorId: "vendor-1",
      liveId: "live-1",
      sourcePageSlug: "partner-b",
      referralCode: "B-CODE",
      slotKey: "main_product",
      children: "推薦商品",
    }) as unknown as { props: { onClick: (event: unknown) => Promise<void> | void } };
    const preventDefault = vi.fn();

    await tree.props.onClick({
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault,
    });
    await flushNavigation();

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/affiliate-clicks?sourcePage=partner-b", expect.objectContaining({
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      body: JSON.stringify({
        vendorId: "vendor-1",
        liveId: "live-1",
        visitorId: "visitor-1",
        landingPath: "/p/partner-b?product=main_product",
        referralCode: "B-CODE",
      }),
    }));
    expect(assign).toHaveBeenCalledWith("https://shop.example.test/product");
  });

  it("still navigates when the tracking request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("tracking unavailable")));
    const assign = vi.fn();
    vi.stubGlobal("window", { crypto: { randomUUID: () => "visitor-2" }, location: { assign } });

    const tree = TrackedTeamFunnelProductLink({
      href: "https://shop.example.test/product",
      vendorId: "vendor-1",
      liveId: "live-1",
      sourcePageSlug: "partner-b",
      referralCode: null,
      slotKey: "bundle_product",
      children: "組合",
    }) as unknown as { props: { onClick: (event: unknown) => Promise<void> | void } };
    await tree.props.onClick({
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      preventDefault: vi.fn(),
    });
    await flushNavigation();

    expect(assign).toHaveBeenCalledWith("https://shop.example.test/product");
  });
});
