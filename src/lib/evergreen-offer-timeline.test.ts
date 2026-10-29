import { describe, expect, it } from "vitest";
import {
  EVERGREEN_CONSULTATION_EVENT_TYPE,
  evergreenSettingEvents,
  revealEvergreenProducts,
  revealEvergreenTimeline,
} from "@/lib/evergreen-offer-timeline";

const events = [
  { id: "cta-early", eventType: "cta_switch", triggerSec: 30, productId: null },
  { id: "spotlight-a", eventType: "product_spotlight", triggerSec: 60, productId: "product-a" },
  { id: "poll", eventType: "poll", triggerSec: 70, productId: null },
  { id: "flash", eventType: "flash_sale", triggerSec: 80, productId: "product-b" },
  { id: "spotlight-b", eventType: "product_spotlight", triggerSec: 120, productId: "product-b" },
  { id: "consult", eventType: EVERGREEN_CONSULTATION_EVENT_TYPE, triggerSec: 200, productId: null },
];
const products = [{ id: "product-a" }, { id: "product-b" }];

describe("evergreen offer reveal", () => {
  it("ships only offers the session already reached and the next reveal second", () => {
    const reveal = revealEvergreenTimeline(events, 65);
    expect(reveal.events.map(({ id }) => id)).toEqual(["cta-early", "spotlight-a"]);
    expect(reveal.nextRevealAtSec).toBe(120);
    expect(revealEvergreenProducts(products, reveal.events, 65)).toEqual([{ id: "product-a" }]);
  });

  it("reveals an offer exactly at its trigger second", () => {
    expect(revealEvergreenTimeline(events, 120).events.map(({ id }) => id)).toEqual(["cta-early", "spotlight-a", "spotlight-b"]);
    expect(revealEvergreenTimeline(events, 119.9).nextRevealAtSec).toBe(120);
    expect(revealEvergreenTimeline(events, 200).nextRevealAtSec).toBeNull();
  });

  it("withholds every offer and product before the session starts", () => {
    const reveal = revealEvergreenTimeline(events, "none");
    expect(reveal).toEqual({ events: [], nextRevealAtSec: null });
    expect(revealEvergreenProducts(products, reveal.events, "none")).toEqual([]);
  });

  it("ships every offer in replay but never shared-run interactions", () => {
    const reveal = revealEvergreenTimeline(events, "all");
    expect(reveal.events.map(({ id }) => id)).toEqual(["cta-early", "spotlight-a", "spotlight-b", "consult"]);
    expect(revealEvergreenProducts(products, reveal.events, "all")).toEqual(products);
  });
});

describe("evergreen setting events", () => {
  it("turns the coupon and consultation seconds into timeline events", () => {
    expect(evergreenSettingEvents({
      pitchAtSeconds: 90,
      consultationAtSeconds: 300,
      pitchProduct: { id: "product-a", offerLabel: " 早鳥價 " },
      consultationFormAvailable: true,
    })).toEqual([
      expect.objectContaining({ id: "evergreen-pitch", eventType: "product_spotlight", triggerSec: 90, productId: "product-a", title: "早鳥價" }),
      expect.objectContaining({ id: "evergreen-consultation", eventType: EVERGREEN_CONSULTATION_EVENT_TYPE, triggerSec: 300, ctaUrl: null }),
    ]);
  });

  it("skips settings without a product, a form or a valid second", () => {
    expect(evergreenSettingEvents({ pitchAtSeconds: 90, consultationAtSeconds: 300, pitchProduct: null, consultationFormAvailable: false })).toEqual([]);
    expect(evergreenSettingEvents({ pitchAtSeconds: null, consultationAtSeconds: -1, pitchProduct: { id: "product-a", offerLabel: null }, consultationFormAvailable: true })).toEqual([]);
  });
});
