import { describe, expect, it } from "vitest";
import type { LivePageData } from "@/components/live-playback";
import { createPlaybackSession, playbackIdentity, sessionMatchesPath } from "@/components/persistent-live-playback";

function fixture(overrides: Partial<LivePageData> = {}): LivePageData {
  return {
    id: "live-a",
    vendorId: "vendor-a",
    slug: "webinar-a",
    title: "研討會 A",
    status: "live",
    description: null,
    accentCopy: null,
    heroImageUrl: null,
    brand: { name: "品牌 A", logoUrl: null, primaryColor: "#000000", ctaColor: "#ffffff" },
    form: null,
    interactionEvents: [],
    products: [
      { id: "product-a", name: "商品 A", description: null, priceCents: 100, compareAtCents: null, currency: "TWD", imageUrl: null, checkoutUrl: null, offerLabel: null },
      { id: "external", name: "外部商品", description: null, priceCents: 200, compareAtCents: null, currency: "TWD", imageUrl: null, checkoutUrl: "https://merchant.example.test/buy", offerLabel: null },
    ],
    ...overrides,
  };
}

describe("persistent live playback scope", () => {
  it("keeps playback only for the exact live and its internal checkout paths", () => {
    const session = createPlaybackSession(fixture());
    expect(sessionMatchesPath(session, "/live/webinar-a")).toBe(true);
    expect(sessionMatchesPath(session, "/checkout/vendor-a/product-a")).toBe(true);
    expect(sessionMatchesPath(session, "/checkout/vendor-a/external")).toBe(false);
    expect(sessionMatchesPath(session, "/checkout/vendor-b/product-a")).toBe(false);
    expect(sessionMatchesPath(session, "/checkout/vendor-a/another-product")).toBe(false);
    expect(sessionMatchesPath(session, "/")).toBe(false);
  });

  it("uses a distinct identity when the live changes", () => {
    expect(playbackIdentity(fixture())).not.toBe(playbackIdentity(fixture({ id: "live-b" })));
  });
});
