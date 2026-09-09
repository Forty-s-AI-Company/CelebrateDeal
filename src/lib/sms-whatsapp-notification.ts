import { createHash } from "node:crypto";

export type NotificationChannel = "sms" | "whatsapp";
export type NotificationEvent = "live_started" | "consultation_reminder" | "payment_success";

export type WhatsAppTemplate = {
  name: string;
  language: string;
  components?: Array<{ type: "header" | "body" | "button"; parameters?: Array<{ type: string; text?: string }> }>;
};

export type NotificationRequest = {
  channel: NotificationChannel;
  event: NotificationEvent;
  to: string;
  body?: string;
  /** Required by WhatsApp Business Cloud API template messages. */
  template?: WhatsAppTemplate;
  /** Optional provider-compatible sender fields; secrets must never be put here. */
  from?: string;
  idempotencyKey?: string;
};

export type ProviderMessage = {
  channel: NotificationChannel;
  to: string;
  body?: string;
  template?: WhatsAppTemplate;
  from?: string;
  idempotencyKey: string;
};

export type NotificationAdapter = (message: ProviderMessage) => Promise<{ providerMessageId: string }>;

export type SendNotificationOptions = {
  adapter?: NotificationAdapter;
  /** Total attempts, including the initial send. Capped to prevent retry abuse. */
  maxAttempts?: number;
  idempotencyKey?: string;
};

export type NotificationResult = {
  status: "sent" | "failed" | "invalid";
  channel: NotificationChannel;
  event: NotificationEvent;
  recipientHash: string;
  attempts: number;
  providerMessageId?: string;
  error?: string;
};

const MAX_RETRY_ATTEMPTS = 5;
const EVENT_SET = new Set<NotificationEvent>(["live_started", "consultation_reminder", "payment_success"]);

/** Normalises Taiwan mobile numbers and validates international E.164 numbers. */
export function normalizePhoneNumber(value: string): string {
  const compact = value.trim().replace(/[\s().-]/gu, "");
  if (/^09\d{8}$/u.test(compact)) return `+886${compact.slice(1)}`;
  if (/^8869\d{8}$/u.test(compact)) return `+${compact}`;
  if (!/^\+[1-9]\d{7,14}$/u.test(compact)) throw new Error("invalid_phone_number");
  return compact;
}

/** Returns a one-way, deterministic identifier safe for logs and audit records. */
export function hashPhoneNumber(phone: string): string {
  return createHash("sha256").update(normalizePhoneNumber(phone), "utf8").digest("hex");
}

export function maskPhoneNumber(phone: string): string {
  return `sha256:${hashPhoneNumber(phone)}`;
}

function validateRequest(request: NotificationRequest): string {
  normalizePhoneNumber(request.to);
  if (!EVENT_SET.has(request.event)) throw new Error("unsupported_notification_event");
  if (request.channel === "sms" && (!request.body || request.body.trim().length === 0)) {
    throw new Error("sms_body_required");
  }
  if (request.channel === "whatsapp") {
    if (!request.template?.name || !/^[a-z0-9_]{1,512}$/u.test(request.template.name)) throw new Error("whatsapp_template_required");
    if (!/^[a-z]{2}(?:_[A-Z]{2})?$/u.test(request.template.language)) throw new Error("invalid_whatsapp_template_language");
  }
  return normalizePhoneNumber(request.to);
}

/** Deterministic test adapter. It intentionally returns no recipient PII or credentials. */
export function createMockNotificationAdapter(messages: ProviderMessage[] = []): NotificationAdapter {
  return async (message) => {
    messages.push({ ...message, to: maskPhoneNumber(message.to) });
    const digest = createHash("sha256").update(JSON.stringify(message)).digest("hex").slice(0, 16);
    return { providerMessageId: `mock_${digest}` };
  };
}

export function createMockNotificationMessages() {
  return [] as ProviderMessage[];
}

/** Sends SMS (Sanlih/Twilio-compatible payload) or WhatsApp template notifications. */
export async function sendOmnichannelNotification(
  request: NotificationRequest,
  options: SendNotificationOptions = {},
): Promise<NotificationResult> {
  let normalized: string;
  try {
    normalized = validateRequest(request);
  } catch (error) {
    return { status: "invalid", channel: request.channel, event: request.event, recipientHash: "", attempts: 0, error: error instanceof Error ? error.message : "invalid_request" };
  }

  const attemptsBudget = Math.min(Math.max(Math.floor(options.maxAttempts ?? 3), 1), MAX_RETRY_ATTEMPTS);
  const idempotencyKey = options.idempotencyKey ?? request.idempotencyKey ?? `notify_${createHash("sha256").update(JSON.stringify([request.channel, request.event, normalized, request.body, request.template])).digest("hex").slice(0, 32)}`;
  const message: ProviderMessage = { channel: request.channel, to: normalized, body: request.body, template: request.template, from: request.from, idempotencyKey };
  const adapter = options.adapter ?? createMockNotificationAdapter();
  let lastError = "notification_failed";
  for (let attempt = 1; attempt <= attemptsBudget; attempt += 1) {
    try {
      const sent = await adapter(message);
      return { status: "sent", channel: request.channel, event: request.event, recipientHash: hashPhoneNumber(normalized), attempts: attempt, providerMessageId: sent.providerMessageId };
    } catch (error) {
      lastError = error instanceof Error ? error.message : "notification_failed";
    }
  }
  return { status: "failed", channel: request.channel, event: request.event, recipientHash: hashPhoneNumber(normalized), attempts: attemptsBudget, error: lastError };
}

export const sendSmsWhatsAppNotification = sendOmnichannelNotification;
