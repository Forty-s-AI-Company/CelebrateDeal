import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ drawLiveInteractionWinnerAction: vi.fn(), startLiveInteractionAction: vi.fn() }));
vi.mock("@/app/actions/interaction-actions", () => ({
  endLiveInteractionAction: vi.fn(),
  getLivePollStudioSnapshotAction: vi.fn(),
  moderateLiveQuestionAction: vi.fn(),
  verifyLuckyDrawWinnerClaimAction: vi.fn(),
}));
vi.mock("@/components/instructor-interaction-cards", () => ({ InstructorInteractionCards: () => null }));
vi.mock("@/components/live-danmaku", () => ({ InstructorDanmakuSwitch: () => null }));

import { LiveInteractionStudio } from "./live-interaction-studio";

describe("LiveInteractionStudio", () => {
  const html = renderToStaticMarkup(
    <LiveInteractionStudio liveId="live-1" csrfToken="csrf" products={[]} initialDrawRuns={[]} initialPollRuns={[]} initialClaimRuns={[]} initialQuestions={[]} />,
  );

  it("is collapsed by default and labelled as an advanced tool", () => {
    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*data-testid="live-interaction-studio-details"/);
    expect(html).toContain("進階");
    expect(html).toContain("需要時再展開");
  });

  it("keeps every interaction control available inside the collapsed panel", () => {
    for (const text of ["幸運大抽獎", "即時投票", "限時快閃搶購", "空投限時紅包", "觀眾問答審核"]) expect(html).toContain(text);
  });

  it("no longer uses the purple-to-red gradient or a prize brand example", () => {
    expect(html).not.toContain("bg-gradient");
    expect(html).not.toContain("iPhone");
  });
});
