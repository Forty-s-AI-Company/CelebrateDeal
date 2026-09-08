import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewer = readFileSync(new URL("./live-advanced-interactions.tsx", import.meta.url), "utf8");
const studio = readFileSync(new URL("./live-interaction-studio.tsx", import.meta.url), "utf8");

describe("Live Polls and Q&A UI contract", () => {
  it("keeps the viewer question form, anonymous option, spotlight and bounded input", () => {
    expect(viewer).toContain('action: "ask_question"');
    expect(viewer).toContain('maxLength={500}');
    expect(viewer).toContain('暱稱（留空即匿名）');
    expect(viewer).toContain('data-testid="live-question-spotlight"');
  });

  it("keeps multi-select voting, live Studio results and moderation controls", () => {
    expect(viewer).toContain('selectionMode === "multiple"');
    expect(viewer).toContain('aria-pressed={selected}');
    expect(studio).toContain('getLivePollStudioSnapshotAction');
    expect(studio).toContain('value="spotlight"');
    expect(studio).toContain('value="answered"');
    expect(studio).toContain('value="hidden"');
  });
});
