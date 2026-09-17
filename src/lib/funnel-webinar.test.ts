import { describe, expect, it } from "vitest";
import { getFunnelWebinarState, parseFunnelWebinarSettings } from "./funnel-webinar";
import { addFunnelStep, parseFunnelFlow } from "./funnel-flow";
import { createGoalFunnelStepPages } from "./funnel-goal-step-pages";
import { deserializeFunnelStepPages, replaceFunnelStepPage, serializeFunnelStepPages } from "./funnel-step-pages";
import { instantiateFunnelTemplate } from "./funnel-template-gallery";
import { createFunnelStepPagesHistory, recordFunnelStepPages, redoFunnelStepPages, undoFunnelStepPages } from "./funnel-step-pages-history";

const settings = { timezone: "Asia/Taipei", startsAt: "2026-09-17T10:00:00Z", endsAt: "2026-09-17T11:00:00Z", replayEndsAt: "2026-09-18T11:00:00Z" };
const resources = { liveId: "live_1", formId: "form_1" };

describe("固定場次 Webinar", () => {
  it("更換模板保存模板識別與獨立頁面，保留名稱及網址", () => {
    const before = createGoalFunnelStepPages({ id: "webinar", name: "分享會", goal: "webinar", domain: "webinar" })!;
    const result = replaceFunnelStepPage(before, "webinar_registration", instantiateFunnelTemplate("webinar-thank-you"), "webinar-thank-you");
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const loaded = deserializeFunnelStepPages(serializeFunnelStepPages(result.state))!;
    expect(loaded.flow.steps[0]).toMatchObject({ name: "Webinar 報名頁", path: "registration", template: { templateId: "webinar-thank-you" } });
    expect(loaded.pages.webinar_registration!.id).toBe(before.pages.webinar_registration!.id);
    expect(loaded.pages.webinar_broadcast).toEqual(before.pages.webinar_broadcast);
  });
  it.each([
    ["2026-09-17T09:59:59Z", "waiting"], [settings.startsAt, "live"],
    [settings.endsAt, "replay"], [settings.replayEndsAt, "expired"],
  ])("%s 明確使用排程邊界 %s", (now, status) => {
    expect(getFunnelWebinarState(settings, resources, Date.parse(now)).status).toBe(status);
  });

  it("沒有重播時在結束當下到期，缺資源或日期時提供可操作訊息", () => {
    expect(getFunnelWebinarState({ ...settings, replayEndsAt: null }, resources, new Date(settings.endsAt)).status).toBe("expired");
    const missing = getFunnelWebinarState({ ...settings, startsAt: null }, {});
    expect(missing.status).toBe("missing");
    expect(missing.missing).toEqual(["請設定開始時間", "請綁定播放用 Live", "請綁定報名表單"]);
    expect(getFunnelWebinarState(settings, resources, NaN).status).toBe("missing");
  });

  it("驗證時區、UTC 格式、真實日期與日期順序，允許未設定草稿", () => {
    expect(parseFunnelWebinarSettings({ timezone: "Asia/Taipei", startsAt: null, endsAt: null, replayEndsAt: null })).not.toBeNull();
    for (const patch of [{ timezone: "Invalid/Zone" }, { startsAt: "2026-02-30T10:00:00Z" }, { startsAt: "2026-09-17T18:00:00+08:00" }, { endsAt: settings.startsAt }, { replayEndsAt: settings.endsAt }, { startsAt: undefined }]) {
      expect(parseFunnelWebinarSettings({ ...settings, ...patch })).toBeNull();
    }
    expect(parseFunnelWebinarSettings({ ...settings, startsAt: "2026-09-17T10:00:00.123Z" })).not.toBeNull();
  });

  it("各頁與排程經過持久化和 undo/redo 後保持獨立", () => {
    const before = createGoalFunnelStepPages({ id: "webinar", name: "分享會", goal: "webinar", domain: "webinar" })!;
    const after = structuredClone(before);
    after.flow.webinar = settings;
    after.pages.webinar_broadcast!.root[0]!.props.title = "已更新";
    expect(deserializeFunnelStepPages(serializeFunnelStepPages(after))).toEqual(after);
    const history = recordFunnelStepPages(createFunnelStepPagesHistory(), before);
    const undone = undoFunnelStepPages(history, after)!;
    expect(undone.state).toEqual(before);
    expect(redoFunnelStepPages(undone.history, undone.state)?.state).toEqual(after);
    expect(before.pages.webinar_broadcast!.root[0]!.props.title).toBeUndefined();
    expect(parseFunnelFlow({ ...after.flow, webinar: { ...settings, timezone: "invalid" } })).toBeNull();
    expect(parseFunnelFlow({ ...after.flow, webinar: undefined })).not.toBeNull();
  });

  it("Webinar 可新增專用步驟，其他 goal 拒絕該類型", () => {
    const webinar = createGoalFunnelStepPages({ id: "webinar", name: "分享會", goal: "webinar", domain: "webinar" })!;
    const custom = createGoalFunnelStepPages({ id: "custom", name: "資訊", goal: "custom", domain: "custom" })!;
    const input = { name: "第二場", path: "second", type: "webinar_broadcast_page" as const };
    expect(addFunnelStep(webinar.flow, input).ok).toBe(true);
    expect(addFunnelStep(custom.flow, input).ok).toBe(false);
  });
});
