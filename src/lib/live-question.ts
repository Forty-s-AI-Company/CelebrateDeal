import { z } from "zod";

export const LIVE_QUESTION_MAX_BODY_LENGTH = 500;
export const LIVE_QUESTION_MAX_DISPLAY_NAME_LENGTH = 80;

export const LIVE_QUESTION_STATUSES = ["pending", "spotlight", "answered", "hidden"] as const;
export type LiveQuestionStatus = (typeof LIVE_QUESTION_STATUSES)[number];

export const LiveQuestionStatusSchema = z.enum(LIVE_QUESTION_STATUSES);

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.normalize("NFKC").trim() : null;
}

/**
 * Returns normalized question text only when it is safe to persist. Count
 * Unicode code points rather than UTF-16 units so emoji cannot bypass the cap.
 */
export function normalizeLiveQuestionBody(value: unknown) {
  const normalized = normalizedText(value);
  return normalized && Array.from(normalized).length <= LIVE_QUESTION_MAX_BODY_LENGTH ? normalized : null;
}

/**
 * A missing display name deliberately represents an anonymous viewer.
 */
export function normalizeLiveQuestionDisplayName(value: unknown) {
  const normalized = normalizedText(value);
  return normalized && Array.from(normalized).length <= LIVE_QUESTION_MAX_DISPLAY_NAME_LENGTH ? normalized : null;
}

const requiredIdentifier = z.string().trim().min(1).max(128);

export const LiveQuestionSubmissionSchema = z.object({
  vendorId: requiredIdentifier,
  liveId: requiredIdentifier,
  participantHash: z.string().trim().min(32).max(128),
  displayName: z.string().nullable().optional().transform((value) => normalizeLiveQuestionDisplayName(value)),
  body: z.string().transform((value) => normalizeLiveQuestionBody(value)).refine(
    (value): value is string => value !== null,
    `問題內容需介於 1 到 ${LIVE_QUESTION_MAX_BODY_LENGTH} 個字元`,
  ),
}).strict();

export type LiveQuestionSubmission = z.infer<typeof LiveQuestionSubmissionSchema>;

export function parseLiveQuestionSubmission(input: unknown) {
  return LiveQuestionSubmissionSchema.safeParse(input);
}

export function canTransitionLiveQuestionStatus(from: LiveQuestionStatus, to: LiveQuestionStatus) {
  if (from === "pending") return to === "spotlight" || to === "hidden";
  if (from === "spotlight") return to === "answered" || to === "hidden";
  return false;
}
