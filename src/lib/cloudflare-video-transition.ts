import {
  resolveCloudflareVideoStatusTransition,
  type CloudflareVideoStatus,
} from "@/lib/cloudflare-video-status";

export type CloudflareVideoSnapshot = {
  id: string;
  status: string;
};

export type CloudflareVideoTransitionResult =
  | { outcome: "applied" }
  | { outcome: "stale_or_idempotent" }
  | { outcome: "missing" }
  | { outcome: "contention_exhausted" };

type CloudflareVideoTransitionOptions = {
  snapshot: CloudflareVideoSnapshot;
  incomingStatus: CloudflareVideoStatus;
  claim: (input: {
    id: string;
    expectedStatus: string;
    nextStatus: CloudflareVideoStatus;
  }) => Promise<boolean>;
  readLatest: (id: string) => Promise<CloudflareVideoSnapshot | null>;
  maxAttempts?: number;
};

const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Applies a Cloudflare event with a bounded compare-and-swap retry. Webhook
 * delivery is at-least-once and can arrive out of order, so a failed claim
 * must re-evaluate the latest local state before deciding it is stale.
 */
export async function convergeCloudflareVideoTransition({
  snapshot,
  incomingStatus,
  claim,
  readLatest,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
}: CloudflareVideoTransitionOptions): Promise<CloudflareVideoTransitionResult> {
  let current = snapshot;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const nextStatus = resolveCloudflareVideoStatusTransition(current.status, incomingStatus);
    if (!nextStatus) return { outcome: "stale_or_idempotent" };

    const applied = await claim({
      id: current.id,
      expectedStatus: current.status,
      nextStatus,
    });
    if (applied) return { outcome: "applied" };

    const latest = await readLatest(current.id);
    if (!latest) return { outcome: "missing" };
    current = latest;
  }

  return { outcome: "contention_exhausted" };
}
