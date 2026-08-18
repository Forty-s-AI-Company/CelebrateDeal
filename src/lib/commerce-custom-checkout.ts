import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  decryptSensitiveValue,
  deriveSensitiveDataKey,
  encryptSensitiveValue,
} from "@/lib/sensitive-data";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const FIELD_KEY = /^[a-z][a-z0-9_]{0,39}$/u;
const CHECKOUT_IDENTITY_FINGERPRINT_PURPOSE = "commerce-custom-checkout-identity-fingerprint";

const fieldKey = z.string().regex(FIELD_KEY, "欄位 key 格式不正確。");
const fieldLabel = z.string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1, "欄位標題為必填。").max(100, "欄位標題過長。"))
  .refine((value) => !CONTROL_CHARACTERS.test(value), "欄位標題包含不允許的控制字元。");
const option = z.string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1, "選項不得空白。").max(100, "選項過長。"))
  .refine((value) => !CONTROL_CHARACTERS.test(value), "選項包含不允許的控制字元。");

const commonField = { key: fieldKey, label: fieldLabel, required: z.boolean() };

export const CustomCheckoutFieldSchema = z.discriminatedUnion("type", [
  z.object({ ...commonField, type: z.literal("text") }).strict(),
  z.object({ ...commonField, type: z.literal("textarea") }).strict(),
  z.object({
    ...commonField,
    type: z.literal("select"),
    options: z.array(option).min(2, "下拉選單至少需要兩個選項。").max(20, "下拉選單選項過多。"),
  }).strict(),
  z.object({ ...commonField, type: z.literal("checkbox"), required: z.literal(true) }).strict(),
]);

export const CustomCheckoutFieldsSchema = z.array(CustomCheckoutFieldSchema)
  .max(10, "最多只能建立十個自訂結帳欄位。")
  .superRefine((fields, context) => {
    const keys = new Set<string>();
    fields.forEach((field, index) => {
      if (keys.has(field.key)) {
        context.addIssue({ code: "custom", path: [index, "key"], message: "欄位 key 必須唯一。" });
      }
      keys.add(field.key);
      if (field.type === "select" && new Set(field.options).size !== field.options.length) {
        context.addIssue({ code: "custom", path: [index, "options"], message: "下拉選單選項不可重複。" });
      }
    });
  });

export type CustomCheckoutField = z.infer<typeof CustomCheckoutFieldSchema>;
export type CustomCheckoutFields = z.infer<typeof CustomCheckoutFieldsSchema>;
export type CustomCheckoutAnswers = Record<string, string | boolean>;
export type CustomCheckoutIdentityHashInput = {
  vendorId: string;
  productId: string;
  basePiiHash: string;
  definitions: unknown;
  answers: unknown;
};

export class CommerceCustomCheckoutValidationError extends Error {
  constructor() {
    super("Custom checkout fields or answers are invalid.");
    this.name = "CommerceCustomCheckoutValidationError";
  }
}

function safeBindingPart(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 191 || normalized !== value || CONTROL_CHARACTERS.test(normalized)) {
    throw new Error("Custom checkout binding is invalid.");
  }
  return normalized;
}

function answerText(value: unknown, maximum: number, required: boolean) {
  if (typeof value !== "string") throw new CommerceCustomCheckoutValidationError();
  const normalized = value.trim();
  if (normalized.length > maximum || CONTROL_CHARACTERS.test(normalized) || (required && !normalized)) {
    throw new CommerceCustomCheckoutValidationError();
  }
  return normalized;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

/** Parses only the declarative product definition; it never accepts buyer answers. */
export function parseCustomCheckoutFields(value: unknown): CustomCheckoutFields {
  const parsed = CustomCheckoutFieldsSchema.safeParse(value ?? []);
  if (!parsed.success) throw new CommerceCustomCheckoutValidationError();
  return parsed.data;
}

export function safeParseCustomCheckoutFields(value: unknown) {
  return CustomCheckoutFieldsSchema.safeParse(value ?? []);
}

/** Strictly validates an answer object against the exact stored field definition. */
export function validateCustomCheckoutAnswers(
  definitions: unknown,
  input: unknown,
): CustomCheckoutAnswers {
  const fields = parseCustomCheckoutFields(definitions);
  if (fields.length === 0) {
    if (input === undefined) return {};
    if (!isPlainRecord(input) || Object.keys(input).length !== 0) throw new CommerceCustomCheckoutValidationError();
    return {};
  }
  if (!isPlainRecord(input)) throw new CommerceCustomCheckoutValidationError();
  const expectedKeys = new Set(fields.map((field) => field.key));
  if (Object.keys(input).length !== fields.length || Object.keys(input).some((key) => !expectedKeys.has(key))) {
    throw new CommerceCustomCheckoutValidationError();
  }

  const answers: CustomCheckoutAnswers = {};
  for (const field of fields) {
    const value = input[field.key];
    if (field.type === "checkbox") {
      if (value !== true) throw new CommerceCustomCheckoutValidationError();
      answers[field.key] = true;
    } else if (field.type === "select") {
      const selected = answerText(value, 100, field.required);
      if (selected && !field.options.includes(selected)) throw new CommerceCustomCheckoutValidationError();
      answers[field.key] = selected;
    } else {
      answers[field.key] = answerText(value, field.type === "textarea" ? 4_000 : 500, field.required);
    }
  }
  return answers;
}

/**
 * Binds validated custom answers to the checkout idempotency identity without
 * storing their plaintext. Products without custom fields retain the legacy
 * PII-only identity hash so existing checkouts remain replay-compatible.
 */
export function createCustomCheckoutIdentityHash(input: CustomCheckoutIdentityHashInput) {
  const vendorId = safeBindingPart(input.vendorId);
  const productId = safeBindingPart(input.productId);
  const basePiiHash = safeBindingPart(input.basePiiHash);
  const definitions = parseCustomCheckoutFields(input.definitions);
  const answers = validateCustomCheckoutAnswers(definitions, input.answers);
  if (definitions.length === 0) return basePiiHash;

  return createHmac("sha256", deriveSensitiveDataKey(CHECKOUT_IDENTITY_FINGERPRINT_PURPOSE))
    .update(JSON.stringify({
      version: 1,
      vendorId,
      productId,
      basePiiHash,
      definitions,
      answers,
    }))
    .digest("base64url");
}

export type CustomCheckoutAnswerBinding = { vendorId: string; orderId: string; orderItemId: string };

function purpose(binding: CustomCheckoutAnswerBinding) {
  return `commerce-custom-checkout:${safeBindingPart(binding.vendorId)}:${safeBindingPart(binding.orderId)}:${safeBindingPart(binding.orderItemId)}`;
}

/** Encrypts validated answers with tenant, order, and item-specific associated purpose. */
export function protectCustomCheckoutAnswers(
  definitions: unknown,
  answers: unknown,
  binding: CustomCheckoutAnswerBinding,
) {
  const normalizedAnswers = validateCustomCheckoutAnswers(definitions, answers);
  return encryptSensitiveValue(JSON.stringify(normalizedAnswers), purpose(binding));
}

/** Decrypts and validates again, so malformed or rebound envelopes fail closed. */
export function revealCustomCheckoutAnswers(
  envelope: string,
  definitions: unknown,
  binding: CustomCheckoutAnswerBinding,
): CustomCheckoutAnswers {
  try {
    return validateCustomCheckoutAnswers(definitions, JSON.parse(decryptSensitiveValue(envelope, purpose(binding))));
  } catch (error) {
    if (error instanceof CommerceCustomCheckoutValidationError) throw error;
    throw new Error("Custom checkout answers could not be decrypted.");
  }
}
