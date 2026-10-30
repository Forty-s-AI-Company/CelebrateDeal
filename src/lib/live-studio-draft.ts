import { z } from "zod";
import { LiveNotificationRuleDraftListSchema } from "@/lib/live-notification-rules";
import { MAX_FIXED_SESSIONS } from "@/lib/live-fixed-sessions";

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

/**
 * One 指定場次 row as the merchant typed it: wall-clock YYYY-MM-DDTHH:mm
 * in the merchant timezone, optional capacity (blank = unlimited) and whether
 * it still accepts registrations. The publish action validates and sorts.
 */
export const FixedSessionDraftRowSchema = z.object({
  startAt: z.string().trim().max(40),
  capacity: z.string().trim().regex(/^\d{0,6}$/u).default(""),
  status: z.enum(["open", "closed"]).default("open"),
}).strict();

export const LIVE_STUDIO_FLOW_VERSION = 2 as const;
export const LIVE_STUDIO_STEP_COUNT = 8;

const liveStudioDraftFields = {
  // Optional for existing saved drafts; ownership is checked at final creation.
  projectId: z.string().regex(/^[A-Za-z0-9_-]{1,191}$/u).optional(),
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
  notificationRules: LiveNotificationRuleDraftListSchema,
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
  replayAvailableUntil: z.string().trim().max(40).default(""),
  // 指定場次. Absent (not defaulted) for a Live with one shared start, so the
  // payload of such a Live, and every draft saved before this field existed,
  // stays byte-identical and the publish claim's payload comparison still holds.
  sessionMode: z.literal("fixed_sessions").optional(),
  fixedSessions: z.array(FixedSessionDraftRowSchema).max(MAX_FIXED_SESSIONS).optional(),
  sessionRegistrationCutoffMinutes: z.string().trim().regex(/^\d{0,4}$/u).optional(),
  sessionReplayWindowHours: z.string().trim().regex(/^\d{0,4}$/u).optional(),
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
  /** B07-20: 使用者在衝突後明確選擇「以我的覆蓋」；只略過 revision 比對，其餘條件不變。 */
  overwrite: z.boolean().default(false),
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
