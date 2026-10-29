import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FunnelWebinarExperience, type WebinarExperienceResource } from "./funnel-webinar-experience";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { RegistrationRetryProvider } from "@/components/registration-retry-context";

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
  it("submits through the page's own designed form with the same owned resources, and drops the fallback form", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T01:30:00.000Z"));
    const html = renderToStaticMarkup(<FunnelWebinarExperience state={state()} slug="current-slug" stepId="webinar_registration" resource={resource} />);
    expect(html).toContain('action="/api/form-submissions"');
    expect(html).not.toContain('id="webinar-registration"');
    expect(html).not.toContain("此一頁式網站尚未綁定可公開使用的報名表");
    expect(html.match(/action="\/api\/form-submissions"/gu)).toHaveLength(1);
    expect(html).toContain('value="owned_form"');
    expect(html).toContain('value="owned_live"');
    expect(html).toContain('value="/lp/current-slug/thank-you"');
    expect(html).toContain("完成確認");
    // Same labels and submit text as the bound registration form (the release E2E fills them by name).
    expect(html).toContain("Email *</label>");
    expect(html).toContain(">送出報名</button>");
  });
  it("posts the existing owned resources and redirects only to the current funnel thank-you path", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T01:30:00.000Z"));
    const draft = state();
    // A registration page without its own lead form keeps the native fallback form.
    draft.pages.webinar_registration!.root = [];
    const html = renderToStaticMarkup(<FunnelWebinarExperience state={draft} slug="current-slug" stepId="webinar_registration" resource={resource} />);
    expect(html).toContain('action="/api/form-submissions"');
    expect(html).toContain('id="webinar-registration"');
    expect(html).toContain('value="owned_form"');
    expect(html).toContain('value="owned_live"');
    expect(html).toContain('value="/lp/current-slug/thank-you"');
    expect(html).toContain("完成確認");
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

describe("Webinar bound to an evergreen live", () => {
  const evergreenResource: WebinarExperienceResource = { ...resource, live: { ...resource.live, isEvergreen: true } };
  function undatedState() {
    const result = state();
    result.flow.webinar = { timezone: "Asia/Taipei", startsAt: null, endsAt: null, replayEndsAt: null };
    return result;
  }

  it("accepts registrations without fixed dates and explains the per-visitor session", () => {
    const html = renderToStaticMarkup(<FunnelWebinarExperience state={undatedState()} slug="current-slug" stepId="webinar_registration" resource={evergreenResource} />);
    expect(html).toContain('data-webinar-state="waiting"');
    expect(html).toContain("常青場次");
    expect(html).toContain("報名後依你的進場時間安排");
    expect(html).toContain('action="/api/form-submissions"');
    expect(html).not.toContain("請設定開始時間");
  });

  it("always offers the evergreen watch page, which runs its own waiting room", () => {
    const html = renderToStaticMarkup(<FunnelWebinarExperience state={undatedState()} slug="current-slug" stepId="webinar_broadcast" resource={evergreenResource} />);
    expect(html).toContain('href="/lp/current-slug/broadcast/play"');
  });

  it("keeps the fixed-date gate for a non-evergreen live without dates", () => {
    const html = renderToStaticMarkup(<FunnelWebinarExperience state={undatedState()} slug="current-slug" stepId="webinar_broadcast" resource={resource} />);
    expect(html).toContain('data-webinar-state="missing"');
    expect(html).not.toContain("/broadcast/play");
  });
});

it("posts the boundary's validated ref/share attribution in the native webinar form", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T01:30:00.000Z"));
  const attribution = { referralCode: "synthetic-ref", shareCode: `tls1.${"a".repeat(32)}` };
  const html = renderToStaticMarkup(<RegistrationRetryProvider value={{ formId: "owned_form", sourcePath: "/lp/current-slug", draft: null, failed: false, attribution }}>
    <FunnelWebinarExperience state={state()} slug="current-slug" stepId="webinar_registration" resource={resource} />
  </RegistrationRetryProvider>);
  expect(html).toContain('name="referralCode" value="synthetic-ref"');
  expect(html).toContain(`name="shareCode" value="tls1.${"a".repeat(32)}"`);
  expect(html).toContain('name="__registrationReturnPath" value="/lp/current-slug"');
  vi.useRealTimers();
});

