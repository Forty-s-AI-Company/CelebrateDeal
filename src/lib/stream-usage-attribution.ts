import type { LiveQuotaPolicy } from "@/lib/live-quota-policy";
import { STREAM_USAGE_BPS_TOTAL } from "@/lib/live-quota-policy";

export type StreamUsageAllocation = {
  recipientKey: string;
  recipientType: "MEMBERSHIP" | "UNATTRIBUTED";
  recipientTeamId: string | null;
  recipientMembershipId: string | null;
  allocationBps: number;
  allocatedWatchSeconds: number;
};

type Candidate = Omit<StreamUsageAllocation, "allocatedWatchSeconds">;

function membershipCandidate(teamId: string | null, membershipId: string | null, bps: number): Candidate {
  if (!teamId || !membershipId) {
    return {
      recipientKey: "UNATTRIBUTED",
      recipientType: "UNATTRIBUTED",
      recipientTeamId: null,
      recipientMembershipId: null,
      allocationBps: bps,
    };
  }
  return {
    recipientKey: `MEMBERSHIP:${teamId}:${membershipId}`,
    recipientType: "MEMBERSHIP",
    recipientTeamId: teamId,
    recipientMembershipId: membershipId,
    allocationBps: bps,
  };
}

function combineCandidates(candidates: Candidate[]) {
  const combined = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const existing = combined.get(candidate.recipientKey);
    if (existing) existing.allocationBps += candidate.allocationBps;
    else combined.set(candidate.recipientKey, { ...candidate });
  }
  const result = [...combined.values()];
  if (result.reduce((sum, candidate) => sum + candidate.allocationBps, 0) !== STREAM_USAGE_BPS_TOTAL) {
    throw new Error("invalid_stream_usage_allocation");
  }
  return result;
}

function allocateSeconds(candidates: Candidate[], watchSeconds: number): StreamUsageAllocation[] {
  const withRemainder = candidates.map((candidate, index) => {
    const numerator = watchSeconds * candidate.allocationBps;
    return {
      candidate,
      index,
      seconds: Math.floor(numerator / STREAM_USAGE_BPS_TOTAL),
      remainder: numerator % STREAM_USAGE_BPS_TOTAL,
    };
  });
  let remaining = watchSeconds - withRemainder.reduce((sum, item) => sum + item.seconds, 0);
  withRemainder
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
    .forEach((item) => {
      if (remaining > 0) {
        item.seconds += 1;
        remaining -= 1;
      }
    });
  return withRemainder
    .sort((left, right) => left.index - right.index)
    .map(({ candidate, seconds }) => ({ ...candidate, allocatedWatchSeconds: seconds }));
}

export function buildStreamUsageAllocations(input: {
  policy: LiveQuotaPolicy;
  watchSeconds: number;
  source: "DIRECT_PLAYBACK" | "TEAM_FUNNEL_PAGE" | "TEAM_FUNNEL_LIVE_SHARE";
  teamId: string | null;
  liveOwnerMembershipId: string | null;
  promoterMembershipId: string | null;
  contentOwnerMembershipId: string | null;
}) {
  const ownerMembershipId = input.contentOwnerMembershipId ?? input.liveOwnerMembershipId;
  const owner = (bps: number) => membershipCandidate(input.teamId, ownerMembershipId, bps);
  const promoter = (bps: number) => membershipCandidate(input.teamId, input.promoterMembershipId, bps);
  const unattributed = (bps: number) => membershipCandidate(null, null, bps);
  let candidates: Candidate[];

  if (input.policy.usageAttributionMode === "CUSTOM") {
    candidates = input.policy.customAllocations.map((allocation) => membershipCandidate(
      allocation.teamId,
      allocation.membershipId,
      allocation.bps,
    ));
  } else if (input.source === "DIRECT_PLAYBACK") {
    candidates = [owner(STREAM_USAGE_BPS_TOTAL)];
  } else if (input.policy.usageAttributionMode === "OWNER") {
    candidates = [owner(STREAM_USAGE_BPS_TOTAL)];
  } else if (input.policy.usageAttributionMode === "SPLIT") {
    candidates = [
      owner(input.policy.splitOwnerBps),
      input.policy.affiliateMode === "enabled"
        ? promoter(input.policy.splitPromoterBps)
        : unattributed(input.policy.splitPromoterBps),
    ];
  } else if (input.policy.affiliateMode === "enabled" && input.promoterMembershipId) {
    candidates = [promoter(STREAM_USAGE_BPS_TOTAL)];
  } else {
    candidates = [unattributed(STREAM_USAGE_BPS_TOTAL)];
  }

  return allocateSeconds(combineCandidates(candidates), input.watchSeconds);
}
