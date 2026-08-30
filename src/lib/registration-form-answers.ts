import { z } from "zod";
import { normalizeBlacklistIdentifier } from "@/lib/blacklist-identifiers";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import type { RegistrationFormFieldSpec } from "@/lib/registration-form-fields";

type RegistrationFormAnswersResult =
  | { success: true; data: Record<string, string> }
  | { success: false };

function normalizeAnswer(field: RegistrationFormFieldSpec, value: string) {
  if (!value) return "";
  if (field.type === "email") return normalizeBlacklistIdentifier("email", value);
  if (field.type === "tel") return normalizeBlacklistIdentifier("phone", value);
  if (field.type === "url") return parseSafeExternalHttpUrl(value);
  if (field.type === "number") {
    const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;
    return decimal.test(value) && Number.isFinite(Number(value)) ? value : null;
  }
  return z.string().max(2_000).safeParse(value).success ? value : null;
}

export function validateRegistrationFormAnswers(
  fields: RegistrationFormFieldSpec[],
  answers: Record<string, string>,
): RegistrationFormAnswersResult {
  const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
  if (Object.keys(answers).some((key) => !fieldsByKey.has(key))) return { success: false };

  const normalized: Record<string, string> = {};
  for (const field of fields) {
    const wasSubmitted = Object.hasOwn(answers, field.key);
    const value = answers[field.key]?.trim() ?? "";
    if (field.required && !value) return { success: false };
    if (!wasSubmitted && !field.required) continue;

    const normalizedValue = normalizeAnswer(field, value);
    if (normalizedValue === null) return { success: false };
    normalized[field.key] = normalizedValue;
  }

  return { success: true, data: normalized };
}

