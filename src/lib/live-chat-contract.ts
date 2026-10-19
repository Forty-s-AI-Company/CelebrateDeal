import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { normalizePresentationRole } from "@/lib/interaction-role";

export type ScheduledPresentationRole = "official" | "audience";

/**
 * The minimum role projection accepted by the scheduled-message boundary.
 * Keep this structural instead of accepting a Prisma model so callers cannot
 * accidentally pass database-only fields through to the public DTO.
 */
export type ScheduledRoleSource = {
  vendorId: string;
  name: string;
  avatarUrl: string | null;
  label: string;
  roleType: string;
  isActive: boolean;
  isScheduled: boolean;
};

export type ScheduledRolePresentation = {
  name: string;
  avatarUrl: string | null;
  /** 商家自訂的顯示標籤；沒有設定時為 null，聊天室不顯示任何標籤。 */
  label: string | null;
  presentationRole: ScheduledPresentationRole;
};

export type ScheduledRuntimeMessage = {
  id: string;
  source: "scheduled";
  triggerSec: number;
  body: string;
  actor: ScheduledRolePresentation;
};

export type ViewerRuntimeMessage = {
  id: string;
  source: "viewer";
  createdAt: string;
  body: string;
  actor: {
    name: string;
  };
};

export type RuntimeChatMessage = ScheduledRuntimeMessage | ViewerRuntimeMessage;

type ScheduledEventSource = {
  id: string;
  eventType: string;
  triggerSec: number;
  message: string | null;
};

function boundedText(value: string, maximum: number) {
  const normalized = value.trim();
  return normalized && normalized.length <= maximum ? normalized : null;
}

/**
 * 系統過去自動填入的預設標籤（「官方角色」「一般觀眾」等）不是商家寫的，
 * 一律視為沒有標籤，避免聊天室出現官方或一般觀眾字樣。
 */
const SYSTEM_DEFAULT_ROLE_LABELS: ReadonlySet<string> = new Set([
  "官方角色",
  "一般觀眾",
  "AI 主持人",
  "系統助手",
  "客服助手",
]);

function publicRoleLabel(value: string | null | undefined) {
  const label = boundedText(value ?? "", 80);
  return label && !SYSTEM_DEFAULT_ROLE_LABELS.has(label) ? label : null;
}

/**
 * Converts a role to the only presentation data that a public scheduled
 * message needs. Invalid, inactive, cross-tenant, or non-scheduled roles
 * fail closed instead of being silently presented as an official role.
 */
export function normalizeScheduledRole(
  role: ScheduledRoleSource | null | undefined,
  vendorId: string,
): ScheduledRolePresentation | null {
  if (!role || role.vendorId !== vendorId || role.isActive !== true || role.isScheduled !== true) {
    return null;
  }

  let presentationRole: ScheduledPresentationRole;
  try {
    presentationRole = normalizePresentationRole(role.roleType);
  } catch {
    return null;
  }

  const name = boundedText(role.name, 160);
  if (!name) return null;

  const label = publicRoleLabel(role.label);
  const rawAvatarUrl = role.avatarUrl?.trim() ?? "";
  const avatarUrl = rawAvatarUrl ? parseSafeExternalHttpUrl(rawAvatarUrl) : null;

  return { name, avatarUrl, label, presentationRole };
}

export function isEligibleScheduledRole(
  role: ScheduledRoleSource | null | undefined,
  vendorId: string,
) {
  return normalizeScheduledRole(role, vendorId) !== null;
}

/**
 * Builds a safe public DTO for a scripted chat/reminder event. The source is
 * always server-owned and the role identity is deliberately not included.
 */
export function normalizeScheduledRuntimeMessage(input: {
  vendorId: string;
  event: ScheduledEventSource;
  role: ScheduledRoleSource | null | undefined;
}): ScheduledRuntimeMessage | null {
  const id = boundedText(input.event.id, 128);
  const body = boundedText(input.event.message ?? "", 1_000);
  if (!id || !body || !["chat_message", "reminder"].includes(input.event.eventType)) return null;
  if (!Number.isSafeInteger(input.event.triggerSec) || input.event.triggerSec < 0) return null;

  const actor = normalizeScheduledRole(input.role, input.vendorId);
  if (!actor) return null;

  return {
    id,
    source: "scheduled",
    triggerSec: input.event.triggerSec,
    body,
    actor,
  };
}
