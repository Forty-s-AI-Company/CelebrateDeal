import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FunnelPageDocumentRenderer } from "@/components/landing-pages/funnel-page-document-renderer";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { previewFunnelTemplate } from "@/lib/funnel-template-gallery";
import { template } from "./12-sustainability-ondemand";
import { webinarTemplateIssues, webinarTemplateNodeSignature } from "./template-checks";

describe("webinar template: 12-sustainability-ondemand", () => {
  it("passes the shared template checks (qa-standards §5.3)", () => {
    expect(webinarTemplateIssues(template)).toEqual([]);
  });

  it("keeps node ids, types and order stable", () => {
    expect(webinarTemplateNodeSignature(template)).toMatchSnapshot();
  });

  // specs/12 §11：四種狀態各自顯示正確的膠囊與按鈕，且不會出現其他狀態的 CTA。
  describe("switches the hero and footer copy by webinar state", () => {
    const webinar = { timezone: "Asia/Taipei", startsAt: "2026-11-05T12:00:00.000Z", endsAt: "2026-11-05T13:30:00.000Z", replayEndsAt: "2026-11-08T12:00:00.000Z" };
    const flow = createGoalFunnelStepPages({ id: "state_flow", name: "Webinar", goal: "webinar", domain: "demo" })!.flow;
    const document = { ...previewFunnelTemplate(template.id), flow: { ...flow, webinar } };
    const render = (now: number) => renderToStaticMarkup(createElement(FunnelPageDocumentRenderer, { document, event: { renderedAt: now } }));
    const CTAS = { upcoming: "免費報名直播", live: "立即進入直播", replay: "立即觀看回放", ended: "通知我下一場" } as const;
    const cases = [
      ["upcoming", Date.parse("2026-11-03T08:00:00.000Z"), "即將開播"],
      ["live", Date.parse(webinar.startsAt) + 60_000, "直播進行中"],
      ["replay", Date.parse(webinar.endsAt) + 60_000, "回放開放中"],
      ["ended", Date.parse(webinar.replayEndsAt) + 60_000, "本場已結束"],
    ] as const;

    it.each(cases)("%s", (state, now, pill) => {
      const html = render(now);
      expect(html).toContain(pill);
      expect(html).toContain(CTAS[state]);
      for (const [other, label] of Object.entries(CTAS)) if (other !== state) expect(html).not.toContain(label);
      // 回放章節只在回放期出現。
      expect(html.includes("回放章節")).toBe(state === "replay");
      // 報名表在每個狀態都存在（文案與狀態無關）。
      expect(html).toContain("留下 Email，取得講座連結");
    });
  });
});
