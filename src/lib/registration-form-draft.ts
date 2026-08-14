import { z } from "zod";
import {
  parseRegistrationFormFields,
  type RegistrationFormFieldSpec,
} from "@/lib/registration-form-fields";

export type RegistrationFormDraftValues = {
  id?: string;
  name: string;
  slug: string;
  headline: string;
  description: string;
  submitLabel: string;
  successMessage: string;
  isActive: boolean;
};

export type RegistrationFormDraft = {
  version: 1;
  baseUpdatedAt: string | null;
  savedAt: string;
  values: RegistrationFormDraftValues;
  fields: RegistrationFormFieldSpec[];
};

const DraftEnvelope = z.object({
  version: z.literal(1),
  baseUpdatedAt: z.string().datetime().nullable(),
  savedAt: z.string().datetime(),
  values: z.object({
    id: z.string().min(1).max(128).optional(),
    name: z.string().max(120),
    slug: z.string().max(80),
    headline: z.string().max(200),
    description: z.string().max(5_000),
    submitLabel: z.string().max(80),
    successMessage: z.string().max(500),
    isActive: z.boolean(),
  }).strict(),
  fields: z.unknown(),
}).strict();

export function registrationFormDraftStorageKey(scope: string, formId?: string) {
  return `celebratedeal:registration-form-draft:v1:${encodeURIComponent(scope)}:${encodeURIComponent(formId ?? "new")}`;
}

export function serializeRegistrationFormDraft(input: {
  baseUpdatedAt: string | null;
  savedAt?: string;
  values: RegistrationFormDraftValues;
  fields: RegistrationFormFieldSpec[];
}) {
  return JSON.stringify({
    version: 1,
    baseUpdatedAt: input.baseUpdatedAt,
    savedAt: input.savedAt ?? new Date().toISOString(),
    values: input.values,
    fields: input.fields,
  } satisfies RegistrationFormDraft);
}

export function parseRegistrationFormDraft(
  raw: string,
  expected: { formId?: string; baseUpdatedAt: string | null },
):
  | { status: "ready"; draft: RegistrationFormDraft }
  | { status: "stale" }
  | { status: "invalid" } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { status: "invalid" };
  }

  const envelope = DraftEnvelope.safeParse(decoded);
  if (!envelope.success) return { status: "invalid" };
  const fields = parseRegistrationFormFields(envelope.data.fields);
  if (!fields.success) return { status: "invalid" };
  if ((envelope.data.values.id ?? undefined) !== expected.formId) return { status: "invalid" };
  if (envelope.data.baseUpdatedAt !== expected.baseUpdatedAt) return { status: "stale" };

  return {
    status: "ready",
    draft: { ...envelope.data, fields: fields.data },
  };
}

export function registrationFormDraftMatches(input: {
  values: RegistrationFormDraftValues;
  fields: RegistrationFormFieldSpec[];
}, baseline: {
  values: RegistrationFormDraftValues;
  fields: RegistrationFormFieldSpec[];
}) {
  return JSON.stringify(input) === JSON.stringify(baseline);
}
