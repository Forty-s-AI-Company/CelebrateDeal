import { describe, expect, it } from "vitest";
import {
  isLiveQuickTemplateTrigger,
  LIVE_QUICK_DURING_LIVE_TEMPLATE_COPY,
  LIVE_QUICK_TEMPLATE_COPY,
  LIVE_QUICK_TEMPLATE_TRIGGERS,
  liveQuickTemplateCopy,
  liveQuickTemplateFieldErrors,
  LIVE_QUICK_VIDEO_LIMITS,
  liveQuickVideoFieldErrors,
} from "./live-resource-quick-create";
import { hasUsableMessageTemplateContent, normalizeMessageTemplateDraft } from "./message-template";

describe("live quick template copy", () => {
  it("keeps the before-live and after-live copy for the default entry points", () => {
    for (const trigger of LIVE_QUICK_TEMPLATE_TRIGGERS) {
      expect(liveQuickTemplateCopy(trigger)).toBe(LIVE_QUICK_TEMPLATE_COPY[trigger]);
    }
    expect(liveQuickTemplateCopy("live_reminder", "before_live")).toBe(LIVE_QUICK_TEMPLATE_COPY.live_reminder);
    expect(liveQuickTemplateCopy("post_live_followup", "post_live_followup")).toBe(LIVE_QUICK_TEMPLATE_COPY.post_live_followup);
  });

  it("uses a while-live wording from the 直播中 group for the same live_reminder trigger", () => {
    const copy = liveQuickTemplateCopy("live_reminder", "during_live");

    expect(copy).toBe(LIVE_QUICK_DURING_LIVE_TEMPLATE_COPY);
    expect(copy.label).toBe("直播中通知 Email");
    expect(copy.subject).toBe("{{live_title}} 正在直播中");
    expect(copy.subject).not.toContain("即將開始");
    expect(copy.body).not.toContain("將在");
    expect(isLiveQuickTemplateTrigger("live_reminder")).toBe(true);
  });

  it.each([
    ["registration_confirmed", LIVE_QUICK_TEMPLATE_COPY.registration_confirmed],
    ["live_reminder", LIVE_QUICK_TEMPLATE_COPY.live_reminder],
    ["post_live_followup", LIVE_QUICK_TEMPLATE_COPY.post_live_followup],
    ["live_reminder (during_live)", LIVE_QUICK_DURING_LIVE_TEMPLATE_COPY],
  ])("%s default copy is sendable with only supported variables", (_name, copy) => {
    expect(hasUsableMessageTemplateContent(copy)).toBe(true);
    expect(liveQuickTemplateFieldErrors(copy)).toEqual({});
    expect(normalizeMessageTemplateDraft({
      name: copy.name,
      channel: "email",
      trigger: "live_reminder",
      subject: copy.subject,
      body: copy.body,
      isActive: true,
    }).success).toBe(true);
  });
});

describe("live quick video field errors", () => {
  it("accepts a title and an absolute HTTP(S) URL", () => {
    expect(liveQuickVideoFieldErrors({ title: " 講座 ", videoUrl: " https://media.example.test/a.mp4 " })).toEqual({});
    expect(liveQuickVideoFieldErrors({ title: "講座", videoUrl: "http://media.example.test/a.mp4" })).toEqual({});
  });

  it("points at the field to fix", () => {
    expect(liveQuickVideoFieldErrors({ title: "", videoUrl: "" })).toEqual({ title: "請填寫影片名稱。", videoUrl: "請貼上影片網址。" });
    expect(liveQuickVideoFieldErrors({ title: "x".repeat(LIVE_QUICK_VIDEO_LIMITS.title + 1), videoUrl: "https://a.test/v" }).title).toBeTruthy();
    for (const videoUrl of ["javascript:alert(1)", "/videos/a.mp4", "//cdn.test/a.mp4", "https://user:pass@cdn.test/a.mp4"]) {
      expect(liveQuickVideoFieldErrors({ title: "x", videoUrl }).videoUrl).toBe("影片網址必須是有效的 HTTP 或 HTTPS 完整網址。");
    }
  });
});
