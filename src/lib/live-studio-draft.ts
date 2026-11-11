import { z } from "zod";
import { LiveNotificationRuleDraftListSchema } from "@/lib/live-notification-rules";
import { MAX_FIXED_SESSIONS } from "@/lib/live-fixed-sessions";
import { LIVE_STUDIO_STEP_COUNT, liveStudioStepIndex, type LiveStudioStepKey } from "@/lib/live-studio-steps";

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

/**
 * Draft flow versions:
 * - (none) the original five-step studio;
 * - 2 the eight-step studio;
 * - 3 the current four-step studio (`LIVE_STUDIO_STEPS`).
 * Every read accepts all three and returns version 3; every write is version 3.
 */
export const LIVE_STUDIO_FLOW_VERSION = 3 as const;

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

const VersionTwoLiveStudioDraftPayloadSchema = z.object({
  ...liveStudioDraftFields,
  flowVersion: z.literal(2),
  activeStep: z.number().int().min(0).max(7).default(0),
}).strict();

const CanonicalLiveStudioDraftPayloadSchema = z.object({
  ...liveStudioDraftFields,
  flowVersion: z.literal(LIVE_STUDIO_FLOW_VERSION),
  activeStep: z.number().int().min(0).max(LIVE_STUDIO_STEP_COUNT - 1).default(0),
}).strict();

type CanonicalLiveStudioDraftPayload = z.infer<typeof CanonicalLiveStudioDraftPayloadSchema>;

/** Five-step (no flowVersion) position → eight-step (v2) position. */
const legacyStepToVersionTwo = [0, 2, 1, 6, 7] as const;

/**
 * Eight-step (v2) position → four-step key: purpose, media, registration and
 * schedule became 內容; products and interactions became 成交; emails became
 * 通知; review became 發布.
 */
export const LIVE_STUDIO_V2_STEP_KEYS = [
  "content", // 0 purpose
  "content", // 1 media
  "sales", // 2 products
  "content", // 3 registration
  "content", // 4 schedule
  "notifications", // 5 emails
  "sales", // 6 interactions
  "publish", // 7 review
] as const satisfies readonly LiveStudioStepKey[];

export const LiveStudioDraftPayloadSchema = z.union([
  CanonicalLiveStudioDraftPayloadSchema,
  VersionTwoLiveStudioDraftPayloadSchema,
  LegacyLiveStudioDraftPayloadSchema,
]).transform((payload): CanonicalLiveStudioDraftPayload => {
  if ("flowVersion" in payload && payload.flowVersion === LIVE_STUDIO_FLOW_VERSION) return payload;
  const versionTwoStep = "flowVersion" in payload ? payload.activeStep : legacyStepToVersionTwo[payload.activeStep]!;
  return {
    ...payload,
    flowVersion: LIVE_STUDIO_FLOW_VERSION,
    activeStep: liveStudioStepIndex(LIVE_STUDIO_V2_STEP_KEYS[versionTwoStep]!),
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
  /**
   * The stored JSON is not this canonical payload (an older flow version, a
   * field added since, or a payload that no longer parsed). A publish claim
   * compares the stored JSON exactly, so the studio re-saves before it submits.
   */
  storedPayloadOutdated?: boolean;
};

export function emptyLiveStudioDraft(): LiveStudioDraftPayload {
  return LiveStudioDraftPayloadSchema.parse({});
}

/** Structural JSON equality that ignores object key order, like PostgreSQL jsonb. */
function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => sameJsonValue(item, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftEntries = Object.entries(left).filter(([, value]) => value !== undefined);
  const rightRecord = right as Record<string, unknown>;
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined);
  return leftEntries.length === rightKeys.length
    && leftEntries.every(([key, value]) => Object.prototype.hasOwnProperty.call(rightRecord, key) && sameJsonValue(value, rightRecord[key]));
}

/**
 * Reads a stored draft into the current flow version. `outdated` tells the
 * studio the row still holds another JSON shape (for example an eight-step
 * v2 draft), so it must be saved again before its publish claim can match.
 */
export function parseStoredLiveStudioDraft(stored: unknown) {
  const parsed = LiveStudioDraftPayloadSchema.safeParse(stored);
  if (!parsed.success) return null;
  return { payload: parsed.data, outdated: !sameJsonValue(parsed.data, stored) };
}
