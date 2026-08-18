import { z } from "zod";

const boundedReference = z.string().trim().min(1).max(128);
const optionalReference = z.union([boundedReference, z.literal("")]).default("");
const boundedJsonText = z.string().max(20_000).default("");

// A recovery snapshot must accept an in-progress URL such as `https://`.
// The publish action performs the authoritative HTTP(S) validation; drafts
// only reject schemes that must never be rendered or submitted later.
const DraftImageReference = z.string().trim().max(2_048).refine(
  (value) => !/^(?:javascript|data|vbscript):/iu.test(value),
  "unsafe_url_scheme",
);

export const LIVE_STUDIO_FLOW_VERSION = 2 as const;
export const LIVE_STUDIO_STEP_COUNT = 8;

const liveStudioDraftFields = {
  studioPreset: z.enum(["CONTENT", "COMMERCE", "CUSTOM"]).default("CUSTOM"),
  title: z.string().trim().max(200).default(""),
  slug: z.string().trim().max(200).default(""),
  scheduledAt: z.string().trim().max(40).default(""),
  description: z.string().max(5_000).default(""),
  productIds: z.array(boundedReference).max(100).default([]),
  accentCopy: z.string().max(200).default(""),
  formId: optionalReference,
  messageTemplateId: optionalReference,
  liveReminderTemplateId: optionalReference,
  liveReminderOffsetMinutes: z.enum(["15", "30", "60", "180", "1440"]).default("60"),
  streamMode: z.enum(["vod", "live"]).default("vod"),
  videoId: optionalReference,
  heroImageUrl: DraftImageReference.default(""),
  heroImageAssetId: optionalReference,
  interactionScriptId: optionalReference,
  affiliateMode: z.enum(["enabled", "disabled"]).default("enabled"),
  defaultAffiliateCode: z.string().trim().max(80).default(""),
  maxConcurrentViewers: z.string().regex(/^\d{0,9}$/u).default("500"),
  stopWhenCreditsBelow: z.string().regex(/^\d{0,9}$/u).default("300"),
  usageAttributionMode: z.enum(["PROMOTER", "OWNER", "SPLIT", "CUSTOM"]).default("PROMOTER"),
  quotaPayerScope: z.enum(["VENDOR", "MEMBER"]).default("VENDOR"),
  splitOwnerBps: z.string().regex(/^\d{0,5}$/u).default("3000"),
  splitPromoterBps: z.string().regex(/^\d{0,5}$/u).default("7000"),
  customAllocations: boundedJsonText,
  memberQuotas: boundedJsonText,
  pageQuotas: boundedJsonText,
  replayEnabled: z.boolean().default(true),
};

const LegacyLiveStudioDraftPayloadSchema = z.object({
  ...liveStudioDraftFields,
  activeStep: z.number().int().min(0).max(4).default(0),
}).strict();

const CanonicalLiveStudioDraftPayloadSchema = z.object({
  ...liveStudioDraftFields,
  flowVersion: z.literal(LIVE_STUDIO_FLOW_VERSION),
  activeStep: z.number().int().min(0).max(LIVE_STUDIO_STEP_COUNT - 1).default(0),
}).strict();

const legacyStepToVersionTwo = [0, 2, 1, 6, 7] as const;

export const LiveStudioDraftPayloadSchema = z.union([
  CanonicalLiveStudioDraftPayloadSchema,
  LegacyLiveStudioDraftPayloadSchema,
]).transform((payload) => {
  if ("flowVersion" in payload) return payload;
  return {
    ...payload,
    flowVersion: LIVE_STUDIO_FLOW_VERSION,
    activeStep: legacyStepToVersionTwo[payload.activeStep]!,
  };
});

export const SaveLiveStudioDraftRequestSchema = z.object({
  draftId: optionalReference,
  liveId: optionalReference,
  revision: z.number().int().positive().nullable().default(null),
  payload: LiveStudioDraftPayloadSchema,
}).strict();

export type LiveStudioDraftPayload = z.infer<typeof LiveStudioDraftPayloadSchema>;

export type LiveStudioDraftEnvelope = {
  id: string;
  revision: number;
  payload: LiveStudioDraftPayload;
  updatedAt: string;
};

export function emptyLiveStudioDraft(): LiveStudioDraftPayload {
  return LiveStudioDraftPayloadSchema.parse({});
}
