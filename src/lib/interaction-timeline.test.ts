import { describe, expect, it } from "vitest";
import { reorderInteractionEvents } from "./interaction-timeline";

describe("reorderInteractionEvents", () => {
  it("moves an event without changing its time or content", () => {
    const events = [
      { triggerSec: 5, message: "開場", ctaLabel: null },
      { triggerSec: 45, message: "主打商品", ctaLabel: "看商品" },
      { triggerSec: 90, message: "優惠提醒", ctaLabel: "立即購買" },
    ];

    const reordered = reorderInteractionEvents(events, 2, 0);

    expect(reordered.map((event) => event.message)).toEqual(["優惠提醒", "開場", "主打商品"]);
    expect(reordered[0]).toBe(events[2]);
    expect(reordered[0]).toMatchObject({ triggerSec: 90, message: "優惠提醒", ctaLabel: "立即購買" });
    expect(events.map((event) => event.message)).toEqual(["開場", "主打商品", "優惠提醒"]);
  });

  it("keeps the sequence unchanged for invalid or identical positions", () => {
    const events = [{ title: "第一則" }, { title: "第二則" }];

    expect(reorderInteractionEvents(events, -1, 0)).toEqual(events);
    expect(reorderInteractionEvents(events, 0, 2)).toEqual(events);
    expect(reorderInteractionEvents(events, 1, 1)).toEqual(events);
  });
});
