import { describe, expect, it } from "vitest";
import {
  INTERACTION_ROLE_CANONICAL_PRESET_URLS,
  INTERACTION_ROLE_LEGACY_TYPES,
  INTERACTION_ROLE_TYPES,
  interactionRoleAvatarGender,
  interactionRoleAvatarUrl,
  interactionRoleLabelAfterTypeChange,
  isCanonicalInteractionRolePresetUrl,
  normalizePresentationRole,
  parseInteractionRoleBoolean,
  normalizeInteractionRoleDraft,
} from "./interaction-role";

describe("interaction role helpers", () => {
  it("keeps only official and audience as canonical writable role types", () => {
    expect(INTERACTION_ROLE_TYPES).toEqual(["official", "audience"]);
    expect(INTERACTION_ROLE_LEGACY_TYPES).toEqual(["ai_host", "system_assistant", "support"]);
  });

  it("normalizes legacy role types for reading and rejects unknown values", () => {
    expect(normalizePresentationRole("official")).toBe("official");
    expect(normalizePresentationRole("audience")).toBe("audience");
    for (const legacyType of INTERACTION_ROLE_LEGACY_TYPES) {
      expect(normalizePresentationRole(legacyType)).toBe("official");
    }
    expect(() => normalizePresentationRole("future_role")).toThrow("未知的互動角色類型");
  });

  it.each([
    [true, true],
    [false, false],
    ["on", true],
    ["true", true],
    ["1", true],
    ["off", false],
    ["false", false],
    ["0", false],
    ["yes", false],
    [undefined, false],
  ])("parses checkbox and boolean input safely: %j", (input, expected) => {
    expect(parseInteractionRoleBoolean(input)).toBe(expected);
  });

  it("keeps a selected female avatar in the female library", () => {
    expect(interactionRoleAvatarGender(interactionRoleAvatarUrl("editor-purple"))).toBe("female");
    expect(interactionRoleAvatarGender(interactionRoleAvatarUrl("host-blue"))).toBe("male");
  });

  it("accepts only exact canonical preset avatar URLs", () => {
    const canonicalUrl = interactionRoleAvatarUrl("host-blue");

    expect(isCanonicalInteractionRolePresetUrl(canonicalUrl)).toBe(true);
    expect(INTERACTION_ROLE_CANONICAL_PRESET_URLS).toContain(canonicalUrl);
    expect(isCanonicalInteractionRolePresetUrl(`${canonicalUrl}&extra=1`)).toBe(false);
    expect(isCanonicalInteractionRolePresetUrl(interactionRoleAvatarUrl("invented-seed"))).toBe(false);
    expect(isCanonicalInteractionRolePresetUrl(null)).toBe(false);
  });

  it("updates only an unchanged default label when the role type changes", () => {
    expect(interactionRoleLabelAfterTypeChange("官方角色", "official", "support")).toBe("客服助手");
    expect(interactionRoleLabelAfterTypeChange("品牌顧問", "official", "support")).toBe("品牌顧問");
  });

  it("normalizes an audience role and round-trips scheduled state", () => {
    expect(normalizeInteractionRoleDraft({
      name: "  小幫手  ",
      avatarUrl: interactionRoleAvatarUrl("host-blue"),
      label: "",
      roleType: "audience",
      tone: "  清楚、自然  ",
      isActive: true,
      isScheduled: "on",
    })).toEqual({
      success: true,
      data: {
        name: "小幫手",
        avatarUrl: interactionRoleAvatarUrl("host-blue"),
        label: "一般觀眾",
        roleType: "audience",
        tone: "清楚、自然",
        isActive: true,
        isScheduled: true,
      },
    });
  });

  it("rejects legacy role types for new writes", () => {
    for (const legacyType of INTERACTION_ROLE_LEGACY_TYPES) {
      expect(normalizeInteractionRoleDraft({
        name: "角色",
        roleType: legacyType,
        isActive: true,
      })).toEqual({ success: false, error: "角色類型不受支援。" });
    }
  });

  it("does not derive scheduled state from simulated state", () => {
    const result = normalizeInteractionRoleDraft({
      name: "模擬角色",
      roleType: "official",
      isActive: true,
      isSimulated: true,
    });

    expect(result).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ isScheduled: false }),
    }));
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

  it("rejects a non-canonical URL when preset mode is explicit", () => {
    expect(normalizeInteractionRoleDraft({
      name: "角色",
      roleType: "official",
      avatarMode: "preset",
      avatarUrl: "https://cdn.example.test/avatar.svg",
      isActive: true,
    })).toEqual({ success: false, error: "預設頭像不受支援。" });
  });
});
