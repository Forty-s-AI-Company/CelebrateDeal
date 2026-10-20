import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/evergreen-webinar-actions", () => ({ updateEvergreenWebinarSettingsAction: vi.fn() }));

import { EvergreenWebinarSettings } from "./evergreen-webinar-settings";

describe("EvergreenWebinarSettings", () => {
  it("tells the merchant the schedule is not live yet (F-019)", () => {
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
    expect(html).toContain("尚未啟用");
    expect(html).toContain("公開觀看頁還不會依這些設定");
  });
});
