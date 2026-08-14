import { describe, expect, it } from "vitest";
import {
  interactionRoleAvatarGender,
  interactionRoleAvatarUrl,
  interactionRoleLabelAfterTypeChange,
  normalizeInteractionRoleDraft,
} from "./interaction-role";

describe("interaction role helpers", () => {
  it("keeps a selected female avatar in the female library", () => {
    expect(interactionRoleAvatarGender(interactionRoleAvatarUrl("editor-purple"))).toBe("female");
    expect(interactionRoleAvatarGender(interactionRoleAvatarUrl("host-blue"))).toBe("male");
  });

  it("updates only an unchanged default label when the role type changes", () => {
    expect(interactionRoleLabelAfterTypeChange("官方角色", "official", "support")).toBe("客服助手");
    expect(interactionRoleLabelAfterTypeChange("品牌顧問", "official", "support")).toBe("品牌顧問");
  });

  it("normalizes a valid role and supplies the truthful default label", () => {
    expect(normalizeInteractionRoleDraft({
      name: "  小幫手  ",
      avatarUrl: interactionRoleAvatarUrl("host-blue"),
      label: "",
      roleType: "ai_host",
      tone: "  清楚、自然  ",
      isActive: true,
    })).toEqual({
      success: true,
      data: {
        name: "小幫手",
        avatarUrl: interactionRoleAvatarUrl("host-blue"),
        label: "AI 主持人",
        roleType: "ai_host",
        tone: "清楚、自然",
        isActive: true,
      },
    });
  });

  it.each([
    ["empty name", { name: "", roleType: "official" }],
    ["unknown type", { name: "角色", roleType: "fake_viewer" }],
    ["unsafe avatar", { name: "角色", roleType: "official", avatarUrl: "javascript:alert(1)" }],
    ["long label", { name: "角色", roleType: "official", label: "標".repeat(81) }],
    ["long tone", { name: "角色", roleType: "official", tone: "字".repeat(501) }],
  ])("rejects %s", (_label, draft) => {
    expect(normalizeInteractionRoleDraft({ isActive: true, ...draft }).success).toBe(false);
  });
});
