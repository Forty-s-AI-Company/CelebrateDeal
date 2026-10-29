import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/evergreen-webinar-actions", () => ({ updateEvergreenWebinarSettingsAction: vi.fn() }));

import { EvergreenWebinarSettings } from "./evergreen-webinar-settings";

describe("EvergreenWebinarSettings", () => {
  it("explains how the public viewing page now honours the schedule (F-019)", () => {
    const html = renderToStaticMarkup(
      <EvergreenWebinarSettings
        liveId="live-1"
        csrfToken="t"
        value={{
          isEvergreen: false, evergreenScheduleMode: "just_in_time", evergreenIntervalMinutes: 15, evergreenDailyTimes: [],
          evergreenSessionStartAt: "", evergreenPitchAtSeconds: null, evergreenConsultationAtSeconds: null,
          evergreenPreviewEnabled: false, evergreenPreviewRate: 1,
        }}
      />,
    );
    expect(html).not.toContain("尚未啟用");
    expect(html).not.toContain("公開觀看頁還不會依這些設定");
    expect(html).toContain("專屬場次");
    expect(html).toContain("無法快轉或加速");
    expect(html).toContain("才由伺服器送出");
    expect(html).toContain("不會宣稱為即時直播");
    expect(html).toContain("所有觀眾共用這一個開場時間");
    // Enabling evergreen ignores the original scheduledAt and turns shared interactions off.
    expect(html).toContain("不再使用這場直播原本設定的開播時間");
    expect(html).toContain("依開播時間排定的 LINE／Email 開播提醒不會寄出");
    expect(html).toContain("以下全場共用互動會停用");
    for (const text of ["幸運抽獎", "投票", "空投限時紅包", "限時快閃搶購"]) expect(html).toContain(text);
    expect(html).toContain("商品揭露只影響頁面呈現，不是購買授權");
    expect(html).toContain("個人回放最多保留 7 天");
  });

  it.each([
    ["evergreen_vod_required", "只適用預錄影片播放的直播"],
    ["evergreen_duration_required", "尚未取得來源影片長度"],
    ["evergreen_live_changed", "播放來源剛被變更"],
  ])("explains the %s refusal", (error, text) => {
    const html = renderToStaticMarkup(
      <EvergreenWebinarSettings
        liveId="live-1"
        csrfToken="t"
        error={error}
        value={{
          isEvergreen: true, evergreenScheduleMode: "just_in_time", evergreenIntervalMinutes: 15, evergreenDailyTimes: [],
          evergreenSessionStartAt: "", evergreenPitchAtSeconds: null, evergreenConsultationAtSeconds: null,
          evergreenPreviewEnabled: false, evergreenPreviewRate: 1,
        }}
      />,
    );
    expect(html).toContain(text);
  });
});
