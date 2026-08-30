import type { EmailBrandSnapshot } from "@/lib/email-delivery-pii";
import { sanitizeEmailBrandSnapshot } from "@/lib/email-delivery-pii";

type SendEmailInput = {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  idempotencyKey?: string;
  brand?: EmailBrandSnapshot;
};

export type TransactionalEmailErrorCode =
  | "configuration"
  | "network"
  | "provider_rejected"
  | "invalid_response";

export class TransactionalEmailError extends Error {
  constructor(
    public readonly code: TransactionalEmailErrorCode,
    public readonly providerStatus: number | null = null,
  ) {
    super(`Transactional email failed (${code}).`);
    this.name = "TransactionalEmailError";
  }
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

export function getSmokeTestEmail() {
  const email = normalizedEmail(process.env.SMOKE_TEST_EMAIL ?? "");
  return email.length > 0 ? email : null;
}

export function isAllowedSmokeTestRecipient(email: string) {
  const configuredRecipient = getSmokeTestEmail();
  return configuredRecipient !== null && normalizedEmail(email) === configuredRecipient;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isSingleMailbox(value: string) {
  return value.length <= 320
    && !/[\s<>,;]/u.test(value)
    && /^[^@]+@[^@]+\.[^@]+$/u.test(value);
}

function parsePlatformFrom(value: string) {
  const candidate = value.trim();
  if (!candidate || /\p{Cc}/u.test(candidate)) return null;
  if (isSingleMailbox(candidate)) return { address: candidate, original: candidate };
  const displayMailbox = candidate.match(/^(.+?)\s*<([^<>]+)>$/u);
  if (!displayMailbox) return null;
  const displayName = displayMailbox[1]?.trim();
  const address = displayMailbox[2]?.trim();
  if (!displayName || !address || /\p{Cc}/u.test(displayName) || !isSingleMailbox(address)) return null;
  return { address, original: candidate };
}

function quotedDisplayName(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function appendBrandFooter(input: SendEmailInput, contactUrl: string | undefined) {
  if (!contactUrl) return { text: input.text, html: input.html };
  const label = `聯絡主辦單位：${contactUrl}`;
  return {
    text: input.text === undefined ? undefined : `${input.text}\n\n${label}`,
    html: input.html === undefined
      ? undefined
      : `${input.html}\n<p>聯絡主辦單位：${escapeHtml(contactUrl)}</p>`,
  };
}

export async function sendTransactionalEmail(input: SendEmailInput) {
  const apiKey = process.env.RESEND_API_KEY;
  const configuredFrom = process.env.EMAIL_FROM;

  if (!apiKey || !configuredFrom) {
    throw new TransactionalEmailError("configuration");
  }
  const platformFrom = parsePlatformFrom(configuredFrom);
  if (!platformFrom) throw new TransactionalEmailError("configuration");
  if (input.idempotencyKey && (input.idempotencyKey.length > 256 || !/^[\x21-\x7E]+$/u.test(input.idempotencyKey))) {
    throw new TransactionalEmailError("configuration");
  }

  const brand = sanitizeEmailBrandSnapshot(input.brand);
  const from = brand?.senderName
    ? `${quotedDisplayName(brand.senderName)} <${platformFrom.address}>`
    : platformFrom.original;
  const content = appendBrandFooter(input, brand?.contactUrl);

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: content.html,
        text: content.text,
        ...(brand?.replyTo ? { reply_to: brand.replyTo } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TransactionalEmailError("network");
  }

  if (!response.ok) {
    throw new TransactionalEmailError("provider_rejected", response.status);
  }

  const result = await response.json().catch(() => null) as { id?: unknown } | null;
  if (!result || typeof result.id !== "string" || result.id.length === 0) {
    throw new TransactionalEmailError("invalid_response", response.status);
  }

  return { id: result.id };
}

export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}) {
  const safeTo = escapeHtml(to);
  const safeResetUrl = escapeHtml(resetUrl);
  return sendTransactionalEmail({
    to,
    subject: "CelebrateDeal 密碼重設連結",
    text: `你收到這封信，是因為有人為 ${to} 申請密碼重設。\n\n請在 30 分鐘內開啟以下連結完成設定：\n${resetUrl}\n\n如果不是你本人操作，可以直接忽略這封信。`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.7;color:#0f172a">
        <h2 style="margin:0 0 12px">CelebrateDeal 密碼重設</h2>
        <p>你收到這封信，是因為有人為 <strong>${safeTo}</strong> 申請密碼重設。</p>
        <p>請在 30 分鐘內使用以下連結完成設定：</p>
        <p><a href="${safeResetUrl}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">重設密碼</a></p>
        <p style="word-break:break-all;color:#475569">${safeResetUrl}</p>
        <p>如果不是你本人操作，可以直接忽略這封信。</p>
      </div>
    `,
  });
}
