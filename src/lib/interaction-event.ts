import { parseSafeExternalHttpUrl } from "@/lib/external-url";

export const INTERACTION_EVENT_TYPES = [
  "chat_message",
  "reminder",
  "product_spotlight",
  "cta_switch",
  "lucky_draw",
  "poll",
  "flash_voucher",
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
  metadata?: unknown;
};

export type LuckyDrawInteractionMetadata = {
  kind: "lucky_draw";
  durationSec: number;
  slogan: string;
};

export type PollInteractionMetadata = {
  kind: "poll";
  durationSec: number;
  question: string;
  options: Array<{ id: string; label: string }>;
};

export type FlashVoucherInteractionMetadata = {
  kind: "flash_voucher";
  durationSec: number;
  maxClaims: number;
  discountType: "percentage" | "fixed";
  discountValue: number;
  productId: string | null;
};

export type AdvancedInteractionMetadata =
  | LuckyDrawInteractionMetadata
  | PollInteractionMetadata
  | FlashVoucherInteractionMetadata;

export type NormalizedInteractionEvent = {
  eventType: InteractionEventType;
  triggerSec: number;
  title: string;
  message: string | null;
  roleId: string | null;
  productId: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  metadata?: AdvancedInteractionMetadata;
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

function metadataRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : fallback;
}

function normalizedAdvancedBase(
  input: InteractionEventDraft,
  eventType: "lucky_draw" | "poll" | "flash_voucher",
  title: string,
  metadata: AdvancedInteractionMetadata,
  productId: string | null = null,
): NormalizedInteractionEvent {
  return {
    eventType,
    triggerSec: input.triggerSec,
    title,
    message: null,
    roleId: null,
    productId,
    ctaLabel: null,
    ctaUrl: null,
    metadata,
  };
}

function normalizeLuckyDrawEvent(input: InteractionEventDraft, eventLabel: string, suppliedTitle: string): InteractionEventValidation {
  const metadata = metadataRecord(input.metadata);
  const slogan = typeof metadata.slogan === "string" ? metadata.slogan.trim() : "";
  if (!slogan || slogan.length > 80) {
    return { success: false, error: `${eventLabel}的抽獎口號必須有 1～80 字。` };
  }
  const titleResult = validatedTitle(suppliedTitle, "幸運大抽獎", eventLabel);
  if (!titleResult.success) return titleResult;
  return {
    success: true,
    data: normalizedAdvancedBase(input, "lucky_draw", titleResult.title, {
      kind: "lucky_draw",
      durationSec: boundedInteger(metadata.durationSec, 30, 5, 600),
      slogan,
    }),
  };
}

function normalizePollEvent(input: InteractionEventDraft, eventLabel: string, suppliedTitle: string): InteractionEventValidation {
  const metadata = metadataRecord(input.metadata);
  const question = typeof metadata.question === "string" ? metadata.question.trim() : "";
  const rawOptions = Array.isArray(metadata.options) ? metadata.options : [];
  const labels = rawOptions.flatMap((option) => {
    if (typeof option === "string") return [option.trim()];
    const record = metadataRecord(option);
    return typeof record.label === "string" ? [record.label.trim()] : [];
  }).filter(Boolean);
  if (!question || question.length > 160) {
    return { success: false, error: `${eventLabel}的投票問題必須有 1～160 字。` };
  }
  if (labels.length < 2 || labels.length > 8 || labels.some((label) => label.length > 80)) {
    return { success: false, error: `${eventLabel}必須有 2～8 個、每個不超過 80 字的選項。` };
  }
  const titleResult = validatedTitle(suppliedTitle, question, eventLabel);
  if (!titleResult.success) return titleResult;
  return {
    success: true,
    data: normalizedAdvancedBase(input, "poll", titleResult.title, {
      kind: "poll",
      durationSec: boundedInteger(metadata.durationSec, 60, 5, 600),
      question,
      options: labels.map((label, index) => ({ id: `option-${index + 1}`, label })),
    }),
  };
}

function normalizeFlashVoucherEvent(input: InteractionEventDraft, eventLabel: string, suppliedTitle: string): InteractionEventValidation {
  const metadata = metadataRecord(input.metadata);
  const discountType = metadata.discountType === "fixed" ? "fixed" : "percentage";
  const discountValue = boundedInteger(metadata.discountValue, 0, 1, discountType === "percentage" ? 90 : 1_000_000);
  const maxClaims = boundedInteger(metadata.maxClaims, 0, 1, 100_000);
  const productId = typeof metadata.productId === "string" ? metadata.productId.trim() : "";
  if (!discountValue) return { success: false, error: `${eventLabel}的折扣必須大於 0。` };
  if (!maxClaims) return { success: false, error: `${eventLabel}的紅包份數必須介於 1～100000。` };
  if (productId.length > 128) return { success: false, error: `${eventLabel}的適用商品引用無效。` };
  const titleResult = validatedTitle(suppliedTitle, "限時紅包", eventLabel);
  if (!titleResult.success) return titleResult;
  return {
    success: true,
    data: normalizedAdvancedBase(input, "flash_voucher", titleResult.title, {
      kind: "flash_voucher",
      durationSec: boundedInteger(metadata.durationSec, 60, 5, 600),
      maxClaims,
      discountType,
      discountValue,
      productId: productId || null,
    }, productId || null),
  };
}

export function interactionEventTypeLabel(eventType: string) {
  if (eventType === "chat_message") return "官方留言";
  if (eventType === "reminder") return "提醒訊息";
  if (eventType === "product_spotlight") return "商品聚焦";
  if (eventType === "cta_switch") return "CTA 切換";
  if (eventType === "lucky_draw") return "幸運大抽獎";
  if (eventType === "poll") return "即時投票";
  if (eventType === "flash_voucher") return "空投限時紅包";
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
    if (!roleId) {
      return { success: false, error: `${eventLabel}必須選擇排程角色。` };
    }
    return normalizeMessageEvent({ input, eventType, eventLabel, suppliedTitle, roleId });
  }
  if (eventType === "product_spotlight") {
    return normalizeProductEvent({ input, eventLabel, suppliedTitle });
  }
  if (eventType === "cta_switch") {
    return normalizeCtaEvent({ input, eventLabel, suppliedTitle });
  }
  if (eventType === "lucky_draw") return normalizeLuckyDrawEvent(input, eventLabel, suppliedTitle);
  if (eventType === "poll") return normalizePollEvent(input, eventLabel, suppliedTitle);
  return normalizeFlashVoucherEvent(input, eventLabel, suppliedTitle);
}
