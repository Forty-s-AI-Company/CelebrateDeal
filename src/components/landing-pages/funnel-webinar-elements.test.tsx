import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { funnelEventSchedule, type FunnelEventSchedule } from "@/lib/funnel-event-time";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { resolveFunnelTypography, type FunnelTypographyViewport } from "@/lib/funnel-typography";
import { FunnelEventContext } from "./funnel-event-context";
import { FunnelPageDocumentRenderer } from "./funnel-page-document-renderer";
import { CountdownElement, WEBINAR_ELEMENTS, googleCalendarUrl, icsDocument, type WebinarElementType } from "./funnel-webinar-elements";

const webinar = { timezone: "Asia/Taipei", startsAt: "2026-11-05T12:00:00.000Z", endsAt: "2026-11-05T13:30:00.000Z", replayEndsAt: "2026-11-08T12:00:00.000Z" };
const scheduled = funnelEventSchedule({ webinar, title: "AI 講座", registrationClosesAt: "2026-11-05T10:00:00.000Z" });
const BEFORE = Date.parse("2026-11-03T08:47:15.000Z");

function render(type: WebinarElementType | "countdown", props: Record<string, unknown>, options: { viewport?: FunnelTypographyViewport; schedule?: FunnelEventSchedule; now?: number | null; interactive?: boolean } = {}) {
  const viewport = options.viewport ?? "desktop";
  const Element = type === "countdown" ? CountdownElement : WEBINAR_ELEMENTS[type];
  const element: ReactElement = <Element props={props} tokens={resolveFunnelTypography(createEmptyPageDocument().settings, viewport)} viewport={viewport} interactive={options.interactive ?? true} inheritColor={false} align="left" />;
  return renderToStaticMarkup(<FunnelEventContext.Provider value={{ schedule: options.schedule ?? scheduled, initialNow: options.now === undefined ? BEFORE : options.now }}>{element}</FunnelEventContext.Provider>);
}

describe("webinar elements (C-01～C-18)", () => {
  it.each(Object.keys(WEBINAR_ELEMENTS) as WebinarElementType[])("%s renders a placeholder without data on every viewport", (type) => {
    for (const viewport of ["desktop", "tablet", "mobile"] as const) {
      const html = render(type, {}, { viewport, schedule: funnelEventSchedule({}), now: null, interactive: false });
      expect(html.length).toBeGreaterThan(20);
      expect(html).not.toContain("undefined");
    }
  });

  it("event facts read the funnel schedule and fall back to 時間公布中", () => {
    const html = render("event_facts", { formatLabel: "線上直播", priceLabel: "免費" }).replace(/<[^>]+>/gu, "");
    expect(html).toContain("2026 年 11 月 5 日（週四）");
    expect(html).toContain("20:00–21:30（台灣時間）");
    // Phones drop the year so the date fits a half-width cell.
    expect(render("event_facts", {}, { viewport: "mobile" }).replace(/<[^>]+>/gu, "")).toContain("日期11 月 5 日（週四）");
    expect(html).toContain("90 分鐘");
    expect(html).toContain("線上直播");
    const pending = render("event_facts", {}, { schedule: funnelEventSchedule({}) });
    expect(pending).toContain("時間公布中");
    expect(pending).not.toContain("20:00");
  });

  it("countdown renders the server time on first render, switches text by phase and never restarts", () => {
    const blocks = render("countdown", { source: "webinar_start", variant: "blocks" });
    expect(blocks).toContain('role="timer"');
    expect(blocks).toContain(">02<"); // days
    expect(blocks).toContain("2 天 3 小時 12 分鐘");
    expect(render("countdown", { source: "webinar_start", variant: "bar" }, { now: Date.parse(webinar.startsAt) + 60_000 })).toContain("直播進行中");
    expect(render("countdown", { source: "webinar_start", variant: "inline" }, { now: Date.parse(webinar.endsAt) + 60_000 })).toContain("回放開放至 11 月 8 日");
    expect(render("countdown", { source: "webinar_start", expiredText: "本場已結束" }, { now: Date.parse(webinar.replayEndsAt) + 1 })).toContain("本場已結束");
    expect(render("countdown", { source: "registration_close" }, { now: Date.parse(scheduled.registrationClosesAt!) })).toContain("本場報名已截止");
    expect(render("countdown", { source: "webinar_start" }, { schedule: funnelEventSchedule({}) })).toContain("時間公布中");
    expect(render("countdown", { source: "fixed", targetDate: "2026-11-03T08:47:14.000Z", expiredText: "早鳥已截止" })).toContain("早鳥已截止");
  });

  it("speaker cards fall back to gradient initials and lay out featured, grid and duo", () => {
    const featured = render("speaker_profiles", { items: [{ name: "林予安", role: "顧問" }] });
    expect(featured).toContain("linear-gradient");
    expect(featured).toContain(">林<");
    expect(render("speaker_profiles", { layout: "duo", items: [{ name: "甲" }, { name: "乙" }] })).toContain("×");
    expect(render("speaker_profiles", { layout: "grid", columns: 4, items: [{ name: "甲" }, { name: "乙" }, { name: "丙" }, { name: "丁" }] }, { viewport: "tablet" })).toContain("calc((100% - 32px) / 2)");
  });

  it("value stack is display text with the default disclaimer", () => {
    const html = render("value_stack", { items: [{ title: "講義", value: "NT$1,980" }], offerLabel: "本場免費", originalPrice: "NT$3,980" });
    expect(html).toContain("價值為講者自訂參考，非售價承諾");
    expect(html).toContain("<s");
    expect(html).toContain("本場免費");
  });

  it("deadline notice shows only a real server deadline", () => {
    expect(render("deadline_notice", {})).toContain("報名截止：11 月 5 日（週四）18:00");
    expect(render("deadline_notice", {}, { schedule: funnelEventSchedule({}) })).toBe("");
  });

  it("calendar entries carry only the title and page URL, never a personal link", () => {
    const url = googleCalendarUrl(scheduled, "https://example.com/lp/demo");
    expect(url).toContain("dates=20261105T120000Z%2F20261105T133000Z");
    expect(url).toContain("text=AI+%E8%AC%9B%E5%BA%A7");
    const ics = icsDocument(scheduled, "https://example.com/lp/demo", "2026-11-01T00:00:00.000Z")!;
    expect(ics).toContain("DTSTART:20261105T120000Z");
    expect(ics).toContain("SUMMARY:AI 講座");
    expect(ics.split("\r\n").filter((line) => line.startsWith("URL:"))).toEqual(["URL:https://example.com/lp/demo"]);
    expect(googleCalendarUrl(funnelEventSchedule({}), "")).toBeNull();
  });

  it("code snippet shows code as text inside its own horizontal scroller", () => {
    const html = render("code_snippet", { code: "<script>alert(1)</script>", language: "html" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script");
    expect(html).toContain("overflow-x-auto");
  });

  it("session schedule never shows a hand-written status", () => {
    const html = render("session_schedule", { items: [{ title: "第 1 堂", startsAt: "2026-11-01T12:00:00Z", status: "額滿" }, { title: "第 2 堂", startsAt: "2026-11-20T12:00:00Z" }] });
    expect(html).toContain("已結束");
    expect(html).toContain("報名中");
    expect(html).not.toContain("額滿");
  });
});

describe("webinar_state (C-15) in the renderer", () => {
  const box = (id: string, state?: string): FunnelNode => ({ schemaVersion: 1, id, type: "content_box", props: state ? { webinarState: state } : {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: `${id}_text`, type: "text", props: { text: `內容-${state ?? "all"}` }, style: {}, overrides: {}, visible: true, actions: [], attributes: {} }] });
  function documentWith(nodes: FunnelNode[]): PageDocument {
    const flow = createGoalFunnelStepPages({ id: "state_flow", name: "Webinar", goal: "webinar", domain: "demo" })!.flow;
    const root: FunnelNode = { schemaVersion: 1, id: "s", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "r", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1, id: "switch", type: "webinar_state", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: nodes }] }] };
    return { ...createEmptyPageDocument("state", "狀態"), flow: { ...flow, webinar }, root: [root] };
  }
  const boxes = [box("b1", "upcoming"), box("b2", "live"), box("b3", "replay"), box("b4", "ended"), box("b5")];

  it("shows only the boxes for the current state on preview and public pages", () => {
    const live = renderToStaticMarkup(<FunnelPageDocumentRenderer document={documentWith(boxes)} event={{ renderedAt: Date.parse(webinar.startsAt) + 1 }} />);
    expect(live).toContain("內容-live");
    expect(live).toContain("內容-all");
    expect(live).not.toContain("內容-upcoming");
    const before = renderToStaticMarkup(<FunnelPageDocumentRenderer document={documentWith(boxes)} event={{ renderedAt: BEFORE }} />);
    expect(before).toContain("內容-upcoming");
    expect(before).not.toContain("內容-replay");
  });

  it("shows every state with a label on the editor canvas", () => {
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={documentWith(boxes)} mode="editor" />);
    for (const label of ["內容-upcoming", "內容-live", "內容-replay", "內容-ended", "直播中", "所有狀態"]) expect(html).toContain(label);
  });
});
