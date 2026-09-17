import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FunnelWebinarExperience, type WebinarExperienceResource } from "./funnel-webinar-experience";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";

const resource: WebinarExperienceResource = {
  live: { id: "owned_live", slug: "owned-live", videoId: "owned_video", videoTitle: "已授權來源" },
  form: { id: "owned_form", fields: [{ key: "name", label: "姓名", required: true }, { key: "email", label: "Email", type: "email", required: true }], submitLabel: "送出報名", successMessage: "待確認" },
};
function state() {
  const result = createGoalFunnelStepPages({ id: "test_flow", name: "Webinar", goal: "webinar", domain: "old-slug" })!;
  result.flow.webinar = { timezone: "Asia/Taipei", startsAt: "2030-01-01T01:00:00.000Z", endsAt: "2030-01-01T02:00:00.000Z", replayEndsAt: "2030-01-02T02:00:00.000Z" };
  return result;
}
afterEach(() => vi.useRealTimers());
describe("Webinar shared preview/public experience", () => {
  it("never renders an arbitrary video URL from a broadcast snapshot", () => {
    const draft = state();
    draft.pages.webinar_broadcast!.root.push({ schemaVersion: 1, id: "raw_video", type: "video", props: { src: "https://untrusted.example/video.mp4" }, visible: true, style: {}, overrides: {}, attributes: {}, actions: [] });
    const html = renderToStaticMarkup(<FunnelWebinarExperience state={draft} slug="current-slug" stepId="webinar_broadcast" resource={resource} />);
    expect(html).toContain("請在編輯器移除");
    expect(html).not.toContain("untrusted.example");
    expect(html).not.toContain("<video");
  });
  it("renders actionable missing configuration without a fake form or playback success", () => {
    const html = renderToStaticMarkup(<FunnelWebinarExperience state={state()} slug="current-slug" stepId="webinar_registration" preview />);
    expect(html).toContain('data-webinar-state="missing"');
    expect(html).toContain("請開啟頁面設定");
    expect(html).not.toContain('action="/api/form-submissions"');
  });
  it("posts the existing owned resources and redirects only to the current funnel thank-you path", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T01:30:00.000Z"));
    const html = renderToStaticMarkup(<FunnelWebinarExperience state={state()} slug="current-slug" stepId="webinar_registration" resource={resource} />);
    expect(html).toContain('action="/api/form-submissions"');
    expect(html).toContain('value="owned_form"');
    expect(html).toContain('value="owned_live"');
    expect(html).toContain('value="/lp/current-slug/thank-you"');
    expect(html).toContain("完成確認");
  });
  it("posts a server-rendered Funnel source for revalidation", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T01:30:00.000Z"));
    const html = renderToStaticMarkup(<FunnelWebinarExperience state={state()} slug="current-slug" stepId="webinar_registration" resource={resource} funnelSource={{ landingPageId: "page_1", stepId: "webinar_registration" }} />);
    expect(html).toContain('name="landingPageId" value="page_1"');
    expect(html).toContain('name="funnelStepId" value="webinar_registration"');
  });
  it("shares mobile rendering and blocks preview submission", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T01:30:00.000Z"));
    const html = renderToStaticMarkup(<FunnelWebinarExperience state={state()} slug="current-slug" stepId="webinar_registration" resource={resource} preview viewport="mobile" />);
    expect(html).toContain('data-viewport="mobile"');
    expect(html).toContain("預覽模式，不送出報名");
    expect(html).toContain("disabled");
  });
  it("offers only the server-validated playback handoff and removes it after expiry", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T03:00:00.000Z"));
    const props = { state: state(), slug: "current-slug", stepId: "webinar_broadcast", resource };
    expect(renderToStaticMarkup(<FunnelWebinarExperience {...props} />)).toContain('href="/lp/current-slug/broadcast/play"');
    vi.setSystemTime(new Date("2030-01-02T02:00:00.000Z"));
    const html = renderToStaticMarkup(<FunnelWebinarExperience {...props} />);
    expect(html).toContain('data-webinar-state="expired"');
    expect(html).not.toContain('/broadcast/play');
  });
});
