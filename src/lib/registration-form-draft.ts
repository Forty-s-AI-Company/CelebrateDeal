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
  themeColor?: string | null;
  countdownMinutes?: number | null;
  stickyText?: string | null;
  bodyContent?: string | null;
  notice?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  maxVisibleSessions?: number;
  hideExpiredSessions?: boolean;
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
    themeColor: z.string().regex(/^#[\da-fA-F]{6}$/).nullable().default(null),
    countdownMinutes: z.number().int().min(0).max(10_080).nullable().default(null),
    stickyText: z.string().max(300).nullable().default(null),
    bodyContent: z.string().max(10_000).nullable().default(null),
    notice: z.string().max(1_000).nullable().default(null),
    seoTitle: z.string().max(200).nullable().default(null),
    seoDescription: z.string().max(500).nullable().default(null),
    maxVisibleSessions: z.number().int().min(0).max(99).default(0),
    hideExpiredSessions: z.boolean().default(true),
    isActive: z.boolean(),
  }).strict(),
  fields: z.unknown(),
}).strict();

export function registrationFormDraftStorageKey(scope: string, formId?: string) {
  return `celebratedeal:registration-form-draft:v1:${encodeURIComponent(scope)}:${encodeURIComponent(formId ?? "new")}`;
}

function draftValuesWithDefaults(values: RegistrationFormDraftValues) {
  return {
    ...values,
    themeColor: values.themeColor ?? null,
    countdownMinutes: values.countdownMinutes ?? null,
    stickyText: values.stickyText ?? null,
    bodyContent: values.bodyContent ?? null,
    notice: values.notice ?? null,
    seoTitle: values.seoTitle ?? null,
    seoDescription: values.seoDescription ?? null,
    maxVisibleSessions: values.maxVisibleSessions ?? 0,
    hideExpiredSessions: values.hideExpiredSessions ?? true,
  };
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
    values: draftValuesWithDefaults(input.values),
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
  return JSON.stringify({ ...input, values: draftValuesWithDefaults(input.values) })
    === JSON.stringify({ ...baseline, values: draftValuesWithDefaults(baseline.values) });
}
