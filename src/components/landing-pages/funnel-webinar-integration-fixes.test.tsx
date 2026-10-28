import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { findFunnelContrastIssues } from "@/lib/funnel-design-contrast";
import { funnelEventPhase, funnelEventSchedule, resolveFunnelEventFields } from "@/lib/funnel-event-time";
import { FUNNEL_HARNESS_SCHEDULES, funnelHarnessSchedule } from "@/lib/funnel-harness-schedule";
import { createEmptyPageDocument, explainPageDocumentIssue, parsePageDocument, type FunnelNode } from "@/lib/funnel-page-document";
import { resolveFunnelTypography, type FunnelTypographyViewport } from "@/lib/funnel-typography";
import { FunnelEventContext } from "./funnel-event-context";
import { IconListElement, SectionTitleElement, StatsElement, TestimonialWallElement } from "./funnel-showcase-elements";
import { AnnouncementBarElement, EventFactsElement } from "./funnel-webinar-elements";

const webinar = { timezone: "Asia/Taipei", startsAt: "2026-11-05T12:00:00.000Z", endsAt: "2026-11-05T13:30:00.000Z", replayEndsAt: "2026-11-08T15:59:00.000Z" };
const scheduled = funnelEventSchedule({ webinar, title: "AI 講座" });
const NOW = Date.parse("2026-11-03T08:47:15.000Z");

type AnyElement = (props: { props: Record<string, unknown>; tokens: ReturnType<typeof resolveFunnelTypography>; viewport: FunnelTypographyViewport; interactive: boolean; inheritColor: boolean; align: "left" | "center" | "right" | "justify" }) => ReactElement;
function render(Element: AnyElement, props: Record<string, unknown>, options: { viewport?: FunnelTypographyViewport; align?: "left" | "center"; bodySize?: number } = {}) {
  const viewport = options.viewport ?? "desktop";
  const settings = createEmptyPageDocument().settings;
  const tokens = resolveFunnelTypography({ ...settings, typography: { ...settings.typography, ...(options.bodySize ? { bodySize: options.bodySize } : {}) } }, viewport);
  return renderToStaticMarkup(<FunnelEventContext.Provider value={{ schedule: scheduled, initialNow: NOW }}><Element props={props} tokens={tokens} viewport={viewport} interactive inheritColor={false} align={options.align ?? "left"} /></FunnelEventContext.Provider>);
}

describe("webinar template integration fixes", () => {
  it("icon_list grid computes its columns with the same gap it renders (no dropped column)", () => {
    const html = render(IconListElement as AnyElement, { layout: "grid", columns: 3, items: [{ title: "一" }, { title: "二" }, { title: "三" }] });
    expect(html).toContain("gap:30px");
    expect(html).toContain("calc((100% - 60px) / 3)");
    const mobile = render(IconListElement as AnyElement, { layout: "grid", columns: 2, items: [{ title: "一" }, { title: "二" }] }, { viewport: "mobile" });
    expect(mobile).toContain("gap:22px");
  });

  it("testimonial carousel dots and arrows keep a 44×44 target and marquee cards are never clamped", () => {
    const items = Array.from({ length: 7 }, (_, index) => ({ name: `學員${index}`, text: `範本示意 ${"很長的評價".repeat(30)}` }));
    const carousel = render(TestimonialWallElement as AnyElement, { layout: "carousel", items });
    expect(carousel).not.toContain("w-8");
    expect(carousel.match(/h-11 w-11 shrink-0/gu)?.length).toBeGreaterThanOrEqual(5);
    expect(render(TestimonialWallElement as AnyElement, { layout: "marquee", items })).not.toContain("line-clamp");
  });

  it("stats keep two columns on tablet and let long numbers wrap", () => {
    const html = render(StatsElement as AnyElement, { items: [{ value: "1", label: "a" }, { value: "2", label: "b" }, { value: "3", label: "c" }, { value: "NT$1,280,000%", label: "d" }] }, { viewport: "tablet" });
    expect(html).toContain("calc((100% - 24px) / 2)");
    expect(html).toContain("overflow-wrap:anywhere");
  });

  it("section_title and announcement_bar resolve {{webinar.*}} fields", () => {
    const title = render(SectionTitleElement as AnyElement, { eyebrow: "{{webinar.weekday}}", title: "直播", subtitle: "開播：{{webinar.startAt}}" });
    expect(title).toContain("開播：11 月 5 日（週四）20:00（台灣時間）");
    expect(title).toContain("週四");
    expect(render(AnnouncementBarElement as AnyElement, { text: "免費直播｜{{webinar.date}}" })).toContain("免費直播｜2026 年 11 月 5 日");
    expect(resolveFunnelEventFields("回放開放至 {{webinar.replayEndsAt}}", scheduled)).toBe("回放開放至 11 月 8 日 23:59");
    expect(resolveFunnelEventFields("{{webinar.replayEndsAt}}", funnelEventSchedule({}))).toBe("時間公布中");
  });

  it("event facts labels stay ≥ 14px, an odd count spans the last cell, and a centred grid stays start-aligned", () => {
    const html = render(EventFactsElement as AnyElement, { showTime: false, showDuration: false, formatLabel: "線上直播", priceLabel: "免費" }, { viewport: "mobile", align: "center", bodySize: 17 });
    expect(html).toContain("font-size:max(14px, 0.8125em)");
    expect(html).toContain("grid-column:1 / -1");
    expect(html).toContain("text-align:left");
    expect(html).toContain("width:fit-content");
  });

  it("contrast check measures a transparent button against its section, not the default fill", () => {
    const button: FunnelNode = { schemaVersion: 1, id: "link", type: "button", props: { label: "先看議程" }, style: { backgroundColor: "transparent", color: "#1d4ed8" }, overrides: {}, visible: true, actions: [], attributes: {} };
    const document = { ...createEmptyPageDocument(), root: [{ schemaVersion: 1 as const, id: "s", type: "section" as const, props: {}, style: { backgroundColor: "#ffffff" }, overrides: {}, visible: true, actions: [], attributes: {}, children: [{ schemaVersion: 1 as const, id: "r", type: "row" as const, props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [button] }] }] };
    expect(findFunnelContrastIssues(document).filter((issue) => issue.nodeId === "link")).toEqual([]);
  });

  it("webinar_state may sit in a content_box, and explainPageDocumentIssue names the failing rule", () => {
    const box = (id: string, children: FunnelNode[] = [], props: Record<string, unknown> = {}): FunnelNode => ({ schemaVersion: 1, id, type: "content_box", props, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children });
    const state: FunnelNode = { schemaVersion: 1, id: "state", type: "webinar_state", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [box("up", [], { webinarState: "upcoming" })] };
    const row = (children: FunnelNode[]): FunnelNode => ({ schemaVersion: 1, id: "row", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children });
    const section = (children: FunnelNode[]): FunnelNode => ({ schemaVersion: 1, id: "sec", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [row(children)] });
    const valid = { ...createEmptyPageDocument(), root: [section([box("col", [state])])] };
    expect(parsePageDocument(valid)).not.toBeNull();
    expect(explainPageDocumentIssue(valid)).toBeNull();
    const nested = { ...createEmptyPageDocument(), root: [section([box("outer", [box("inner")])])] };
    expect(parsePageDocument(nested)).toBeNull();
    expect(explainPageDocumentIssue(nested)).toBeTruthy();
  });

  it("harness sample schedules cover every event phase", () => {
    const phases = FUNNEL_HARNESS_SCHEDULES.map((kind) => {
      const sample = funnelHarnessSchedule(kind, NOW);
      return funnelEventPhase(funnelEventSchedule({ webinar: sample.webinar }), sample.renderedAt);
    });
    expect(phases).toEqual(["upcoming", "upcoming", "live", "replay", "ended"]);
    const far = funnelHarnessSchedule("far", NOW);
    expect((Date.parse(far.webinar.startsAt!) - far.renderedAt) / 86_400_000).toBeGreaterThanOrEqual(100);
    expect(Date.parse(funnelHarnessSchedule("sample", NOW).registrationClosesAt)).toBeLessThan(Date.parse(funnelHarnessSchedule("sample", NOW).webinar.startsAt!));
  });
});

describe("self-hosted funnel fonts", () => {
  it("declares every font variable and only references woff2 files that exist in public/fonts/funnel", async () => {
    const { readFileSync, existsSync } = await import("node:fs");
    const path = await import("node:path");
    const css = readFileSync(path.join(process.cwd(), "src/components/landing-pages/funnel-fonts.css"), "utf8");
    for (const variable of ["--funnel-font-sans-tc", "--funnel-font-serif-tc", "--funnel-font-wenkai-tc", "--funnel-font-display-latin"]) expect(css).toContain(`${variable}:`);
    const files = [...css.matchAll(/url\(\/fonts\/funnel\/([^)]+)\)/gu)].map((match) => match[1]!);
    expect(files.length).toBeGreaterThan(400);
    expect(files.filter((file) => !existsSync(path.join(process.cwd(), "public/fonts/funnel", file)))).toEqual([]);
    // The build must never need the network: no remote font URLs.
    expect(css).not.toMatch(/https?:\/\//u);
  });
});
