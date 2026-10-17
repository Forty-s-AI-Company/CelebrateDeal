import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FunnelExperimentReport } from "./funnel-experiment-report";

describe("A/B confirmation readout", () => {
  it("shows both arms, current status counts and explicit cohort limitations", () => {
    const html = renderToStaticMarkup(<FunnelExperimentReport rows={[
      { id: "synthetic", arm: "control", pageViews: 8, submissions: 3, verifiedSubmissions: 2 },
      { id: "synthetic", arm: "variant", pageViews: 0, submissions: 1, verifiedSubmissions: 0 },
    ]} />);
    for (const text of ["對照", "測試", "目前已確認筆數 2", "目前已確認筆數 0", "不受步驟篩選影響", "期間結束後的確認", "不代表到場"]) expect(html).toContain(text);
    expect(html).not.toContain("%");
    expect(html).not.toContain("勝出");
  });
  it("distinguishes no attributed data from zero confirmations", () => {
    const html = renderToStaticMarkup(<FunnelExperimentReport rows={[]} />);
    expect(html).toContain("尚無可歸因至實驗的紀錄");
    expect(html).not.toContain("目前已確認筆數 0");
  });
});
