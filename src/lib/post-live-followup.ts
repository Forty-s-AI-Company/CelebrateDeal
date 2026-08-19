import { createHash } from "node:crypto";

export { postLiveFollowupIdempotencyPrefix } from "@/lib/post-live-followup-identity";

export type PostLiveCompletionInput = {
  streamMode: string;
  scheduledAt: Date;
  endedAt: Date | null;
  videoDurationSec: number | null;
};

export function resolveLiveCompletionAt(input: PostLiveCompletionInput) {
  if (input.streamMode === "vod") {
    if (!input.videoDurationSec || input.videoDurationSec <= 0) return null;
    return new Date(input.scheduledAt.getTime() + input.videoDurationSec * 1_000);
  }
  if (input.streamMode === "live") return input.endedAt;
  return null;
}

export function resolvePostLiveDeliveryAt(input: PostLiveCompletionInput, offsetMinutes: number) {
  const completionAt = resolveLiveCompletionAt(input);
  if (!completionAt || !Number.isInteger(offsetMinutes) || offsetMinutes < 0 || offsetMinutes > 10_080) {
    return null;
  }
  return new Date(completionAt.getTime() + offsetMinutes * 60_000);
}

export type PostLiveFollowupRevision = {
  vendorId: string;
  liveId: string;
  liveSlug: string;
  liveTitle: string;
  liveScheduledAt: Date;
  formSubmissionId: string;
  ruleId: string;
  offsetMinutes: number;
  completionAt: Date;
  template: { id: string; subject: string; body: string };
};

/** A config revision gets a new id; the rule prefix groups revisions for superseding. */
export function stablePostLiveFollowupDeliveryId(input: PostLiveFollowupRevision) {
  const digest = createHash("sha256")
    .update(JSON.stringify([
      input.vendorId,
      input.liveId,
      input.liveSlug,
      input.liveTitle,
      input.liveScheduledAt.toISOString(),
      input.formSubmissionId,
      input.ruleId,
      input.offsetMinutes,
      input.completionAt.toISOString(),
      input.template.id,
      input.template.subject,
      input.template.body,
      "post_live_followup",
    ]))
    .digest("hex")
    .slice(0, 32);
  return `email_${digest}`;
}

/** The source-controlled cron runs every minute, so every bounded page is visited in turn. */
export function rotatingPostLivePageSkip(total: number, take: number, now: Date) {
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(take) || take <= 0) return 0;
  const pageCount = Math.ceil(total / take);
  const minuteSlot = Math.floor(now.getTime() / 60_000);
  return (minuteSlot % pageCount) * take;
}
