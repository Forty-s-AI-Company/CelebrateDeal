import { describe, expect, it } from "vitest";
import {
  isLiveQuickTemplateTrigger,
  LIVE_QUICK_DURING_LIVE_TEMPLATE_COPY,
  LIVE_QUICK_TEMPLATE_COPY,
  LIVE_QUICK_TEMPLATE_TRIGGERS,
  liveQuickTemplateCopy,
  liveQuickTemplateFieldErrors,
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
