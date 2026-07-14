import { describe, expect, it } from "vitest";
import { getInteractionRoleDefaultLabel, getInteractionRoleLabelOnTypeChange } from "./interaction-role-label";

describe("getInteractionRoleDefaultLabel", () => {
  it.each([
    ["official", "官方角色"],
    ["ai_host", "AI 主持人"],
    ["system_assistant", "系統助手"],
    ["support", "客服助手"],
  ])("returns the existing default for %s", (roleType, label) => {
    expect(getInteractionRoleDefaultLabel(roleType)).toBe(label);
  });

  it("uses the official label for an unknown role type", () => {
    expect(getInteractionRoleDefaultLabel("unknown")).toBe("官方角色");
  });
});

describe("getInteractionRoleLabelOnTypeChange", () => {
  it("uses the new default when the current label is blank", () => {
    expect(getInteractionRoleLabelOnTypeChange("   ", "official", "support")).toBe("客服助手");
  });

  it("updates an unchanged previous default to the next default", () => {
    expect(getInteractionRoleLabelOnTypeChange("AI 主持人", "ai_host", "system_assistant")).toBe("系統助手");
  });

  it("preserves a custom label", () => {
    expect(getInteractionRoleLabelOnTypeChange("直播小幫手", "official", "ai_host")).toBe("直播小幫手");
  });

  it("falls back safely when either role type is unknown", () => {
    expect(getInteractionRoleLabelOnTypeChange("官方角色", "unknown", "support")).toBe("客服助手");
    expect(getInteractionRoleLabelOnTypeChange("", "official", "unknown")).toBe("官方角色");
  });
});
