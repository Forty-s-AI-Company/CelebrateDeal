import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CountdownTimerBlock } from "@/components/funnel-blocks/countdown-timer-block";

describe("countdown timer block", () => {
  it("renders both visual themes before client timing begins", () => {
    for (const theme of ["flip", "minimal"] as const) {
      const html = renderToStaticMarkup(<CountdownTimerBlock blockId={`timer-${theme}`} settings={{ mode: "fixed_date", theme, targetDate: "2030-01-01T00:00:00.000Z", expiredMessage: "已截止" }} />);
      expect(html).toContain("天");
      expect(html).toContain("秒");
      expect(html).toContain(theme === "flip" ? "bg-slate-950" : "border-slate-200");
    }
  });

  it("renders a live entry action immediately when status is live", () => {
    const html = renderToStaticMarkup(<CountdownTimerBlock blockId="live" settings={{ mode: "live_linked", theme: "minimal", scheduledAt: "2030-01-01T00:00:00.000Z", liveStatus: "live", liveHref: "/live/demo", expiredMessage: "已結束" }} />);
    expect(html).toContain("直播進行中，立即入場");
    expect(html).toContain('href="/live/demo"');
  });
});
