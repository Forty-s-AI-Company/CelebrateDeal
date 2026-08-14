import { parseSafeExternalHttpUrl } from "@/lib/external-url";

export const INTERACTION_ROLE_TYPES = [
  "official",
  "ai_host",
  "system_assistant",
  "support",
] as const;

export type InteractionRoleType = (typeof INTERACTION_ROLE_TYPES)[number];
export type InteractionAvatarGender = "male" | "female";

export const INTERACTION_AVATAR_SEEDS: Record<InteractionAvatarGender, readonly string[]> = {
  male: [
    "host-blue",
    "support-green",
    "advisor-cyan",
    "sales-amber",
    "guide-slate",
    "stream-navy",
    "helper-gold",
    "official-mint",
    "promo-red",
    "qa-indigo",
  ],
  female: [
    "host-orange",
    "editor-purple",
    "reminder-rose",
    "care-teal",
    "assistant-lime",
    "planner-pink",
    "studio-rose",
    "brand-violet",
    "live-coral",
    "chat-mint",
  ],
};

const roleTypeSet = new Set<string>(INTERACTION_ROLE_TYPES);

export function interactionRoleAvatarUrl(seed: string) {
  return `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&radius=18`;
}

export function interactionRoleAvatarGender(avatarUrl: string | null | undefined): InteractionAvatarGender {
  if (avatarUrl && INTERACTION_AVATAR_SEEDS.female.some((seed) => interactionRoleAvatarUrl(seed) === avatarUrl)) {
    return "female";
  }
  return "male";
}

export function interactionRoleTypeLabel(roleType: string) {
  if (roleType === "ai_host") return "AI 主持人";
  if (roleType === "system_assistant") return "系統助手";
  if (roleType === "support") return "客服助手";
  return "官方角色";
}

/**
 * 只有仍使用前一個預設標籤時才自動更新，避免覆蓋商家自行撰寫的標籤。
 */
export function interactionRoleLabelAfterTypeChange(
  currentLabel: string,
  previousType: string,
  nextType: string,
) {
  return currentLabel.trim() === interactionRoleTypeLabel(previousType)
    ? interactionRoleTypeLabel(nextType)
    : currentLabel;
}

export type InteractionRoleDraft = {
  name: string;
  avatarUrl?: string | null;
  label?: string | null;
  roleType: string;
  tone?: string | null;
  isActive: boolean;
};

export type NormalizedInteractionRole = {
  name: string;
  avatarUrl: string | null;
  label: string;
  roleType: InteractionRoleType;
  tone: string | null;
  isActive: boolean;
};

export type InteractionRoleValidation =
  | { success: true; data: NormalizedInteractionRole }
  | { success: false; error: string };

export function normalizeInteractionRoleDraft(input: InteractionRoleDraft): InteractionRoleValidation {
  const name = input.name.trim();
  if (!name || name.length > 160) {
    return { success: false, error: "角色暱稱必須為 1～160 字。" };
  }
  if (!roleTypeSet.has(input.roleType)) {
    return { success: false, error: "角色類型不受支援。" };
  }

  const roleType = input.roleType as InteractionRoleType;
  const label = input.label?.trim() || interactionRoleTypeLabel(roleType);
  if (label.length > 80) {
    return { success: false, error: "顯示標籤最多 80 字。" };
  }

  const tone = input.tone?.trim() || null;
  if ((tone?.length ?? 0) > 500) {
    return { success: false, error: "語氣設定最多 500 字。" };
  }

  const rawAvatarUrl = input.avatarUrl?.trim() ?? "";
  const avatarUrl = rawAvatarUrl ? parseSafeExternalHttpUrl(rawAvatarUrl) : null;
  if (rawAvatarUrl && (!avatarUrl || rawAvatarUrl.length > 2_048)) {
    return { success: false, error: "角色頭像必須是安全的 HTTP 或 HTTPS 完整網址。" };
  }

  return {
    success: true,
    data: { name, avatarUrl, label, roleType, tone, isActive: input.isActive },
  };
}
