import { parseSafeExternalHttpUrl } from "@/lib/external-url";

export const INTERACTION_ROLE_TYPES = [
  "official",
  "audience",
] as const;

export type InteractionRoleType = (typeof INTERACTION_ROLE_TYPES)[number];
export const INTERACTION_ROLE_LEGACY_TYPES = [
  "ai_host",
  "system_assistant",
  "support",
] as const;

export type InteractionRoleLegacyType = (typeof INTERACTION_ROLE_LEGACY_TYPES)[number];
export type InteractionRoleStoredType = InteractionRoleType | InteractionRoleLegacyType;
export type InteractionAvatarGender = "male" | "female";
export const INTERACTION_ROLE_AVATAR_MODES = ["preset", "custom"] as const;
export type InteractionRoleAvatarMode = (typeof INTERACTION_ROLE_AVATAR_MODES)[number];

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

/** 只接受目前產品明確提供的完整預設頭像網址。 */
export const INTERACTION_ROLE_CANONICAL_PRESET_URLS = Object.freeze(
  [...INTERACTION_AVATAR_SEEDS.male, ...INTERACTION_AVATAR_SEEDS.female].map(interactionRoleAvatarUrl),
);

const interactionRoleCanonicalPresetUrlSet = new Set(INTERACTION_ROLE_CANONICAL_PRESET_URLS);

export function isCanonicalInteractionRolePresetUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && interactionRoleCanonicalPresetUrlSet.has(value);
}

/**
 * 將資料庫既有角色映射成公開呈現角色；未知值必須顯式失敗，不能猜成官方角色。
 */
export function normalizePresentationRole(roleType: string): InteractionRoleType {
  if (roleType === "official" || roleType === "audience") return roleType;
  if ((INTERACTION_ROLE_LEGACY_TYPES as readonly string[]).includes(roleType)) return "official";
  throw new Error("未知的互動角色類型，無法安全正規化。");
}

/**
 * 僅接受核取方塊與明確布林文字，避免把任意非空字串當成 true。
 */
export function parseInteractionRoleBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  switch (value.trim().toLowerCase()) {
    case "on":
    case "true":
    case "1":
      return true;
    case "":
    case "off":
    case "false":
    case "0":
      return false;
    default:
      return fallback;
  }
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
  if (roleType === "audience") return "一般觀眾";
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
  avatarMode?: InteractionRoleAvatarMode | null;
  label?: string | null;
  roleType: string;
  tone?: string | null;
  isActive: boolean;
  isScheduled?: unknown;
  /** 只為明確表達不從模擬狀態推導排程狀態；此欄位不會被輸出或寫入。 */
  isSimulated?: unknown;
};

export type NormalizedInteractionRole = {
  name: string;
  avatarUrl: string | null;
  label: string;
  roleType: InteractionRoleType;
  tone: string | null;
  isActive: boolean;
  isScheduled: boolean;
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

  const isScheduled = parseInteractionRoleBoolean(input.isScheduled);

  const rawAvatarUrl = input.avatarUrl?.trim() ?? "";
  if (input.avatarMode === "preset" && !isCanonicalInteractionRolePresetUrl(rawAvatarUrl)) {
    return { success: false, error: "預設頭像不受支援。" };
  }
  const avatarUrl = rawAvatarUrl ? parseSafeExternalHttpUrl(rawAvatarUrl) : null;
  if (rawAvatarUrl && (!avatarUrl || rawAvatarUrl.length > 2_048)) {
    return { success: false, error: "角色頭像必須是安全的 HTTP 或 HTTPS 完整網址。" };
  }

  return {
    success: true,
    data: { name, avatarUrl, label, roleType, tone, isActive: input.isActive, isScheduled },
  };
}
