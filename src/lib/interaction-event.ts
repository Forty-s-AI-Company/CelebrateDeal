import { parseSafeExternalHttpUrl } from "@/lib/external-url";

export const INTERACTION_EVENT_TYPES = [
  "chat_message",
  "reminder",
  "product_spotlight",
  "cta_switch",
] as const;

export type InteractionEventType = (typeof INTERACTION_EVENT_TYPES)[number];

export type InteractionEventDraft = {
  eventType: string;
  triggerSec: number;
  title?: string | null;
  message?: string | null;
  roleId?: string | null;
  productId?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
};

export type NormalizedInteractionEvent = {
  eventType: InteractionEventType;
  triggerSec: number;
  title: string;
  message: string | null;
  roleId: string | null;
  productId: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
};

export type InteractionEventValidation =
  | { success: true; data: NormalizedInteractionEvent }
  | { success: false; error: string };

const eventTypeSet = new Set<string>(INTERACTION_EVENT_TYPES);

function validatedTitle(title: string, fallback: string, eventLabel: string) {
  const normalizedTitle = title || fallback;
  return normalizedTitle.length <= 160
    ? { success: true as const, title: normalizedTitle }
    : { success: false as const, error: `${eventLabel}的標題過長。` };
}

function normalizeMessageEvent({
  input,
  eventType,
  eventLabel,
  suppliedTitle,
  roleId,
}: {
  input: InteractionEventDraft;
  eventType: "chat_message" | "reminder";
  eventLabel: string;
  suppliedTitle: string;
  roleId: string | null;
}): InteractionEventValidation {
  const message = input.message?.trim() ?? "";
  if (!message || message.length > 1_000) {
    return { success: false, error: `${eventLabel}必須有 1～1000 字的訊息內容。` };
  }
  const titleResult = validatedTitle(suppliedTitle, message.slice(0, 60), eventLabel);
  if (!titleResult.success) return titleResult;
  return {
    success: true,
    data: {
      eventType,
      triggerSec: input.triggerSec,
      title: titleResult.title,
      message,
      roleId,
      productId: null,
      ctaLabel: null,
      ctaUrl: null,
    },
  };
}

function normalizeProductEvent({
  input,
  eventLabel,
  suppliedTitle,
}: {
  input: InteractionEventDraft;
  eventLabel: string;
  suppliedTitle: string;
}): InteractionEventValidation {
  const productId = input.productId?.trim() ?? "";
  if (!productId || productId.length > 128) {
    return { success: false, error: `${eventLabel}必須選擇目前商店的商品。` };
  }
  const titleResult = validatedTitle(suppliedTitle, "商品聚焦", eventLabel);
  if (!titleResult.success) return titleResult;
  return {
    success: true,
    data: {
      eventType: "product_spotlight",
      triggerSec: input.triggerSec,
      title: titleResult.title,
      message: null,
      roleId: null,
      productId,
      ctaLabel: null,
      ctaUrl: null,
    },
  };
}

function normalizeCtaEvent({
  input,
  eventLabel,
  suppliedTitle,
}: {
  input: InteractionEventDraft;
  eventLabel: string;
  suppliedTitle: string;
}): InteractionEventValidation {
  const ctaLabel = input.ctaLabel?.trim() ?? "";
  const rawCtaUrl = input.ctaUrl?.trim() ?? "";
  const ctaUrl = parseSafeExternalHttpUrl(rawCtaUrl);
  if (!ctaLabel || ctaLabel.length > 120) {
    return { success: false, error: `${eventLabel}必須有 1～120 字的 CTA 文字。` };
  }
  if (!ctaUrl || rawCtaUrl.length > 2_048) {
    return { success: false, error: `${eventLabel}的 CTA 必須是安全的 HTTP 或 HTTPS 完整網址。` };
  }
  const titleResult = validatedTitle(suppliedTitle, ctaLabel, eventLabel);
  if (!titleResult.success) return titleResult;
  return {
    success: true,
    data: {
      eventType: "cta_switch",
      triggerSec: input.triggerSec,
      title: titleResult.title,
      message: null,
      roleId: null,
      productId: null,
      ctaLabel,
      ctaUrl,
    },
  };
}

export function interactionEventTypeLabel(eventType: string) {
  if (eventType === "chat_message") return "官方留言";
  if (eventType === "reminder") return "提醒訊息";
  if (eventType === "product_spotlight") return "商品聚焦";
  if (eventType === "cta_switch") return "CTA 切換";
  return "未知事件";
}

export function normalizeInteractionEventDraft(
  input: InteractionEventDraft,
  index = 0,
): InteractionEventValidation {
  const eventLabel = `第 ${index + 1} 個事件`;
  if (!eventTypeSet.has(input.eventType)) {
    return { success: false, error: `${eventLabel}的事件類型不受支援。` };
  }
  if (!Number.isSafeInteger(input.triggerSec) || input.triggerSec < 0) {
    return { success: false, error: `${eventLabel}的觸發時間無效。` };
  }

  const eventType = input.eventType as InteractionEventType;
  const suppliedTitle = input.title?.trim() ?? "";
  const roleId = input.roleId?.trim() || null;
  if (roleId && roleId.length > 128) {
    return { success: false, error: `${eventLabel}的角色引用無效。` };
  }

  if (eventType === "chat_message" || eventType === "reminder") {
    return normalizeMessageEvent({ input, eventType, eventLabel, suppliedTitle, roleId });
  }
  if (eventType === "product_spotlight") {
    return normalizeProductEvent({ input, eventLabel, suppliedTitle });
  }
  return normalizeCtaEvent({ input, eventLabel, suppliedTitle });
}
