import { describe, expect, it } from "vitest";
import { FUNNEL_NODE_TYPES, type FunnelNode } from "./funnel-page-document";
import { createFunnelInspectorUpdate, funnelInspectorDateTime, getFunnelElementInspectorDefinition, getFunnelInspectorFieldValue } from "./funnel-element-inspector";

const node = (type: FunnelNode["type"], props: Record<string, unknown> = {}, overrides: FunnelNode["overrides"] = {}): FunnelNode => ({ schemaVersion: 1, id: "n", type, props, style: {}, overrides, visible: true, actions: [], attributes: {} });
const field = (type: FunnelNode["type"], id: string) => getFunnelElementInspectorDefinition(type).fields.find((candidate) => candidate.id === id)!;
const WEBINAR_TYPES = ["event_facts", "speaker_profiles", "agenda_timeline", "callout", "fit_compare", "add_to_calendar", "announcement_bar", "value_stack", "session_schedule", "deadline_notice", "webinar_state", "media_frame", "image_gallery", "code_snippet"] as const;

describe("inspector for webinar elements", () => {
  it("registers fields for every new node type", () => {
    for (const type of WEBINAR_TYPES) {
      expect(FUNNEL_NODE_TYPES).toContain(type);
      expect(getFunnelElementInspectorDefinition(type).fields.length).toBeGreaterThan(0);
    }
  });

  it("stores date-time picker values as UTC in the node's time zone and never asks for ISO strings", () => {
    expect(funnelInspectorDateTime("2026-11-05T20:00")).toBe("2026-11-05T12:00:00.000Z");
    expect(funnelInspectorDateTime("2026-11-05T20:00", "Asia/Tokyo")).toBe("2026-11-05T11:00:00.000Z");
    expect(funnelInspectorDateTime("2026-11-05T20:00:00+08:00")).toBe("2026-11-05T12:00:00.000Z");
    expect(funnelInspectorDateTime("")).toBe("");
    expect(funnelInspectorDateTime("下週二")).toBeNull();
    const countdown = node("countdown");
    expect(createFunnelInspectorUpdate(countdown, "base", field("countdown", "targetDate"), "2026-12-31T23:59")).toEqual({ type: "update", nodeId: "n", patch: { props: { targetDate: "2026-12-31T15:59:00.000Z" } } });
    expect(createFunnelInspectorUpdate(countdown, "base", field("countdown", "targetDate"), "not a date")).toBeNull();
    const facts = node("event_facts", { timezone: "America/New_York" });
    expect(createFunnelInspectorUpdate(facts, "base", field("event_facts", "startsAt"), "2026-07-01T09:30")).toMatchObject({ patch: { props: { startsAt: "2026-07-01T13:30:00.000Z" } } });
  });

  it("converts repeater date-times (session schedule) and keeps already stored ISO values", () => {
    const sessions = field("session_schedule", "items");
    const command = createFunnelInspectorUpdate(node("session_schedule"), "base", sessions, [{ title: "第 1 堂", startsAt: "2026-11-05T20:00" }, { title: "第 2 堂", startsAt: "2026-11-12T12:00:00.000Z" }, { title: "第 3 堂", startsAt: "亂填" }]);
    expect(command).toMatchObject({ patch: { props: { items: [{ title: "第 1 堂", startsAt: "2026-11-05T12:00:00.000Z" }, { title: "第 2 堂", startsAt: "2026-11-12T12:00:00.000Z" }, { title: "第 3 堂" }] } } });
  });

  it("writes and reads tablet overrides on top of the desktop override", () => {
    const fontSize = getFunnelElementInspectorDefinition("headline").fields.find((candidate) => candidate.id === "fontSize")!;
    const headline = node("headline", { text: "標題" }, { desktop: { style: { fontSize: 52 } } });
    expect(createFunnelInspectorUpdate(headline, "tablet", fontSize, 42)).toEqual({ type: "update", nodeId: "n", patch: { overrides: { tablet: { style: { fontSize: 42 } } } } });
    expect(getFunnelInspectorFieldValue({ ...headline, overrides: { ...headline.overrides, tablet: { style: { fontSize: 42 } } } }, "tablet", fontSize)).toBe(42);
  });

  it("offers column ratio, tablet stacking and stacked order (C-05)", () => {
    const ids = getFunnelElementInspectorDefinition("columns_2").fields.map((candidate) => candidate.id);
    expect(ids).toEqual(expect.arrayContaining(["ratio", "stackOn", "mobileOrder"]));
    expect(getFunnelElementInspectorDefinition("columns_3").fields.map((candidate) => candidate.id)).not.toContain("ratio");
  });
});
