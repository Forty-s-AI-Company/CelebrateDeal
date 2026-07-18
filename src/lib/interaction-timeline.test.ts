import { describe, expect, it } from "vitest";
import { parseInteractionTriggerSeconds, reorderInteractionEvents } from "./interaction-timeline";

describe("parseInteractionTriggerSeconds", () => {
  it.each([
    ["0", 0],
    ["59", 59],
    ["3600", 3600],
    ["00:00", 0],
    ["00:59", 59],
    ["59:59", 3599],
    ["00:00:00", 0],
    ["23:59:59", 86399],
    ["99:00:00", 356400],
  ])("parses the valid timestamp %s", (value, expected) => {
    expect(parseInteractionTriggerSeconds(value)).toBe(expected);
  });

  it.each([
    "",
    " 10",
    "10 ",
    "-1",
    "+1",
    "1.5",
    "one",
    "1second",
    "60:00",
    "00:60",
    "00:60:00",
    "00:00:60",
    "1:02",
    "1:02:03",
    "00:00:00:00",
    "999999999999999999999999999999",
  ])("rejects the invalid timestamp %s", (value) => {
    expect(parseInteractionTriggerSeconds(value)).toBeNull();
  });
});

describe("reorderInteractionEvents", () => {
  const events = [
    { triggerSec: 5, message: "開場", ctaLabel: null },
    { triggerSec: 45, message: "主打商品", ctaLabel: "看商品" },
    { triggerSec: 90, message: "優惠提醒", ctaLabel: "立即購買" },
  ];

  it("reassigns ordered time slots when moving an event up", () => {
    const reordered = reorderInteractionEvents(events, 2, 1);

    expect(reordered).toEqual([
      { triggerSec: 5, message: "開場", ctaLabel: null },
      { triggerSec: 45, message: "優惠提醒", ctaLabel: "立即購買" },
      { triggerSec: 90, message: "主打商品", ctaLabel: "看商品" },
    ]);
    expect(events).toEqual([
      { triggerSec: 5, message: "開場", ctaLabel: null },
      { triggerSec: 45, message: "主打商品", ctaLabel: "看商品" },
      { triggerSec: 90, message: "優惠提醒", ctaLabel: "立即購買" },
    ]);
  });

  it("reassigns ordered time slots when moving an event down", () => {
    const reordered = reorderInteractionEvents(events, 0, 2);

    expect(reordered).toEqual([
      { triggerSec: 5, message: "主打商品", ctaLabel: "看商品" },
      { triggerSec: 45, message: "優惠提醒", ctaLabel: "立即購買" },
      { triggerSec: 90, message: "開場", ctaLabel: null },
    ]);
  });

  it("reassigns ordered time slots after a drag-and-drop reorder", () => {
    const reordered = reorderInteractionEvents(events, 2, 0);

    expect(reordered).toEqual([
      { triggerSec: 5, message: "優惠提醒", ctaLabel: "立即購買" },
      { triggerSec: 45, message: "開場", ctaLabel: null },
      { triggerSec: 90, message: "主打商品", ctaLabel: "看商品" },
    ]);
  });

  it("uses ascending time slots even when the current event array is not time ordered", () => {
    const events = [
      { triggerSec: 90, message: "優惠提醒" },
      { triggerSec: 5, message: "開場" },
      { triggerSec: 45, message: "主打商品" },
    ];

    const reordered = reorderInteractionEvents(events, 1, 2);

    expect(reordered).toEqual([
      { triggerSec: 5, message: "優惠提醒" },
      { triggerSec: 45, message: "主打商品" },
      { triggerSec: 90, message: "開場" },
    ]);
  });

  it("keeps the timeline unchanged for invalid or identical positions", () => {
    const events = [{ triggerSec: 5, title: "第一則" }, { triggerSec: 45, title: "第二則" }];

    expect(reorderInteractionEvents(events, -1, 0)).toEqual(events);
    expect(reorderInteractionEvents(events, 0, 2)).toEqual(events);
    expect(reorderInteractionEvents(events, 1, 1)).toEqual(events);
  });
});
