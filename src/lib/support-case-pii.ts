import { z } from "zod";

import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";

const DISALLOWED_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const SAFE_BINDING_PART = /^[A-Za-z0-9_-]{1,160}$/u;

export const SUPPORT_CASE_CONTENT_KINDS = [
  "initial_summary",
  "internal_note",
  "buyer_reply",
  "customer_reply",
  "refund_reason",
] as const;

export type SupportCaseContentKind = typeof SUPPORT_CASE_CONTENT_KINDS[number];

const SupportCaseContent = z.string()
  .transform((value) => value.replace(/\r\n?/gu, "\n").trim())
  .pipe(z.string().min(1).max(4_000))
  .refine((value) => !DISALLOWED_CONTROL_CHARACTERS.test(value));

export type SupportCaseContentBinding = {
  vendorId: string;
  supportCaseId: string;
  recordId: string;
  kind: SupportCaseContentKind;
};

export class SupportCaseContentError extends Error {
  constructor() {
    super("客服內容格式不正確或目前無法解密。");
    this.name = "SupportCaseContentError";
  }
}

function purpose(binding: SupportCaseContentBinding) {
  const parts = [binding.vendorId, binding.supportCaseId, binding.recordId, binding.kind];
  if (parts.some((part) => !SAFE_BINDING_PART.test(part))) {
    throw new SupportCaseContentError();
  }
  return `support-case-content:${parts.join(":")}`;
}

export function parseSupportCaseContent(value: unknown) {
  const parsed = SupportCaseContent.safeParse(value);
  if (!parsed.success) throw new SupportCaseContentError();
  return parsed.data;
}

export function protectSupportCaseContent(value: unknown, binding: SupportCaseContentBinding) {
  return encryptSensitiveValue(parseSupportCaseContent(value), purpose(binding));
}

export function revealSupportCaseContent(envelope: string, binding: SupportCaseContentBinding) {
  try {
    return parseSupportCaseContent(decryptSensitiveValue(envelope, purpose(binding)));
  } catch (error) {
    if (error instanceof SupportCaseContentError) throw error;
    throw new SupportCaseContentError();
  }
}
