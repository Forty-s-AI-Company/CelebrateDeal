import { describe, expect, it } from "vitest";
import { summarizeInteractionRoleUsage } from "@/lib/interaction-role-usage";

describe("summarizeInteractionRoleUsage", () => {
  it("groups role references by script without exposing event content", () => {
    expect(summarizeInteractionRoleUsage([
      { eventType: "chat_message", script: { id: "script-b", name: "售後腳本", status: "draft", _count: { lives: 0 } } },
      { eventType: "reminder", script: { id: "script-a", name: "主直播腳本", status: "published", _count: { lives: 2 } } },
      { eventType: "chat_message", script: { id: "script-a", name: "主直播腳本", status: "published", _count: { lives: 2 } } },
    ])).toEqual([
      { scriptId: "script-a", scriptName: "主直播腳本", scriptStatus: "published", eventCount: 2, publicMessageCount: 2, liveCount: 2 },
      { scriptId: "script-b", scriptName: "售後腳本", scriptStatus: "draft", eventCount: 1, publicMessageCount: 1, liveCount: 0 },
    ]);
  });

  it("returns an empty impact summary when the role is unused", () => {
    expect(summarizeInteractionRoleUsage([])).toEqual([]);
  });
});
