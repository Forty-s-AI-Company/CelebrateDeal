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
  });
});
