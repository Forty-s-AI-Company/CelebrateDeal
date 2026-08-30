import { createHash, randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { parseLiveQuotaPolicy } from "@/lib/live-quota-policy";
import { assertPaymentMethodReferenceForQuota, PaymentMethodReferenceRequiredError } from "@/lib/payment-method-reference";
import {
  TeamFunnelAccessDeniedError,
  assertTeamFunnelAccess,
  requireTeamFunnelActor,
  type TeamFunnelMembership,
  type TeamFunnelRelationship,
} from "@/lib/team-funnel-access";

export const LIVE_SHARE_CODE_PREFIX = "tls1";

export type CreateTeamFunnelLiveShareInput = {
  teamId: string;
  pageId: string;
  promoterMembershipId: string;
  expiresAt?: Date | null;
};

export type DisableTeamFunnelLiveShareInput = {
  teamId: string;
  pageId: string;
  promoterMembershipId: string;
};

export class TeamFunnelLiveShareUnavailableError extends Error {
  readonly code = "TEAM_FUNNEL_LIVE_SHARE_UNAVAILABLE";

  constructor() {
    super("This Live share is unavailable");
    this.name = "TeamFunnelLiveShareUnavailableError";
  }
}

export class TeamFunnelLiveShareConflictError extends Error {
  readonly code = "TEAM_FUNNEL_LIVE_SHARE_CONFLICT";

  constructor(message = "This Live share cannot be created") {
    super(message);
    this.name = "TeamFunnelLiveShareConflictError";
  }
}

export type ResolvedTeamFunnelLiveShare = {
  vendorId: string;
  teamId: string;
  sourcePageId: string;
  templateVersionId: string;
  promoterMembershipId: string;
  leadOwnerMembershipId: string;
  leaderMembershipId: string;
  contentOwnerMembershipId: string;
  webinarOwnerMembershipId: string | null;
  referralCode: string | null;
  source: "REFERRAL";
};

export function hashTeamFunnelLiveShareCode(shareCode: string) {
  return createHash("sha256").update(shareCode, "utf8").digest("hex");
}

export async function createTeamFunnelLiveShare(input: CreateTeamFunnelLiveShareInput) {
  const actor = await requireTeamFunnelActor(input.teamId);
  const db = getDb();
  const page = await loadShareablePage(actor.vendorId, input.teamId, input.pageId);
  const facts = await loadAccessFacts(actor.vendorId, input.teamId);
  assertTeamFunnelAccess({
    action: "share",
    actor,
    resource: pageResource(page),
    ...facts,
  });

  const expiresAt = input.expiresAt ?? null;
  if (expiresAt && expiresAt <= new Date()) {
    throw new TeamFunnelLiveShareConflictError("A share expiry must be in the future");
  }

  const target = facts.memberships.find((membership) => membership.id === input.promoterMembershipId);
  if (!target || target.id === page.promoterMembershipId || !isActive(target)) {
    throw new TeamFunnelLiveShareConflictError("The target promoter is not an active team member");
  }
  if (!hasCurrentRelationship(facts.relationships, input.teamId, page.promoterMembershipId, target.id, new Date())) {
    throw new TeamFunnelLiveShareConflictError("The target promoter must be a direct downline of the source owner");
  }
  assertLiveBinding(page);
  await assertSharePaymentMethod(page, actor.vendorId, db);

  const shareCode = issueLiveShareCode();
  const share = await db.partnerLiveShare.upsert({
    where: {
      vendorId_liveId_promoterMembershipId: {
        vendorId: actor.vendorId,
        liveId: page.live.id,
        promoterMembershipId: target.id,
      },
    },
    create: {
      vendorId: actor.vendorId,
      teamId: input.teamId,
      liveId: page.live.id,
      sourcePageId: page.id,
      promoterMembershipId: target.id,
      tokenHash: hashTeamFunnelLiveShareCode(shareCode),
      expiresAt,
      isEnabled: true,
    },
    update: {
      sourcePageId: page.id,
      tokenHash: hashTeamFunnelLiveShareCode(shareCode),
      expiresAt,
      isEnabled: true,
    },
    select: { id: true, liveId: true, promoterMembershipId: true, expiresAt: true, isEnabled: true },
  });

  return {
    share,
    // The raw token is returned only from this creation call. It is never
    // persisted or included in operational evidence.
    shareCode,
    shareUrl: `/live/${encodeURIComponent(page.live.slug)}?share=${encodeURIComponent(shareCode)}`,
  };
}

export async function disableTeamFunnelLiveShare(input: DisableTeamFunnelLiveShareInput) {
  const actor = await requireTeamFunnelActor(input.teamId);
  const db = getDb();
  const page = await loadShareablePage(actor.vendorId, input.teamId, input.pageId);
  const facts = await loadAccessFacts(actor.vendorId, input.teamId);
  assertTeamFunnelAccess({
    action: "share",
    actor,
    resource: pageResource(page),
    ...facts,
  });
  assertLiveBinding(page);

  const share = await db.partnerLiveShare.updateMany({
    where: {
      vendorId: actor.vendorId,
      teamId: input.teamId,
      liveId: page.live.id,
      sourcePageId: page.id,
      promoterMembershipId: input.promoterMembershipId,
      isEnabled: true,
    },
    data: { isEnabled: false },
  });
  if (share.count !== 1) throw new TeamFunnelLiveShareUnavailableError();
  return { pageId: page.id, liveId: page.live.id, promoterMembershipId: input.promoterMembershipId, isEnabled: false };
}

/** Resolves the bearer token against the exact vendor/live pair before any attribution is returned. */
export async function resolveTeamFunnelLiveShare(input: {
  vendorId: string;
  liveId: string;
  shareCode: string;
  now?: Date;
}): Promise<ResolvedTeamFunnelLiveShare | null> {
  if (!isLiveShareCode(input.shareCode)) return null;
  const db = getDb();
  const share = await db.partnerLiveShare.findFirst({
    where: { vendorId: input.vendorId, liveId: input.liveId, tokenHash: hashTeamFunnelLiveShareCode(input.shareCode) },
    select: {
      vendorId: true,
      teamId: true,
      liveId: true,
      sourcePageId: true,
      promoterMembershipId: true,
      expiresAt: true,
      isEnabled: true,
      sourcePage: { select: { teamId: true, liveId: true, templateVersionId: true, promoterMembershipId: true, contentOwnerMembershipId: true } },
      live: { select: { teamId: true, seminarOwnerMembershipId: true, status: true, replayEnabled: true } },
    },
  });
  if (!share) return null;

  const now = input.now ?? new Date();
  if (!share.isEnabled || (share.expiresAt && share.expiresAt <= now)) return null;
  if (
    share.liveId !== input.liveId
    || share.sourcePage.liveId !== input.liveId
    || share.sourcePage.teamId !== share.teamId
    || share.live.teamId !== share.teamId
    || !isPublicLiveLifecycle(share.live.status, share.live.replayEnabled)
  ) return null;

  const facts = await loadAccessFacts(input.vendorId, share.teamId);
  const activeIds = new Set(facts.memberships.filter(isActive).map((membership) => membership.id));
  if (
    !activeIds.has(share.promoterMembershipId)
    || !activeIds.has(share.sourcePage.promoterMembershipId)
    || !activeIds.has(share.sourcePage.contentOwnerMembershipId)
    || (share.live.seminarOwnerMembershipId !== null && !activeIds.has(share.live.seminarOwnerMembershipId))
    || !hasCurrentRelationship(facts.relationships, share.teamId, share.sourcePage.promoterMembershipId, share.promoterMembershipId, now)
  ) return null;

  const target = facts.memberships.find((membership) => membership.id === share.promoterMembershipId);
  const webinarOwnerMembershipId = share.live.seminarOwnerMembershipId && activeIds.has(share.live.seminarOwnerMembershipId)
    ? share.live.seminarOwnerMembershipId
    : null;
  return {
    vendorId: share.vendorId,
    teamId: share.teamId,
    sourcePageId: share.sourcePageId,
    templateVersionId: share.sourcePage.templateVersionId,
    promoterMembershipId: share.promoterMembershipId,
    leadOwnerMembershipId: share.promoterMembershipId,
    leaderMembershipId: resolveLeader(share.promoterMembershipId, facts.relationships, share.teamId),
    contentOwnerMembershipId: share.sourcePage.contentOwnerMembershipId,
    webinarOwnerMembershipId,
    referralCode: target?.affiliateCode ?? null,
    source: "REFERRAL",
  };
}

type ShareablePage = {
  id: string;
  vendorId: string;
  teamId: string;
  promoterMembershipId: string;
  contentOwnerMembershipId: string;
  live: {
    id: string;
    slug: string;
    teamId: string | null;
    seminarOwnerMembershipId: string | null;
    status: string;
    replayEnabled: boolean;
    quotaPolicy: unknown;
  } | null;
};

async function loadShareablePage(vendorId: string, teamId: string, pageId: string): Promise<ShareablePage> {
  const page = await getDb().partnerFunnelPage.findFirst({
    where: { id: pageId, vendorId, teamId },
    select: {
      id: true,
      vendorId: true,
      teamId: true,
      promoterMembershipId: true,
      contentOwnerMembershipId: true,
      live: { select: { id: true, slug: true, teamId: true, seminarOwnerMembershipId: true, status: true, replayEnabled: true, quotaPolicy: true } },
    },
  });
  if (!page) throw new TeamFunnelAccessDeniedError("missing_resource");
  return page;
}

function pageResource(page: ShareablePage) {
  return {
    id: page.id,
    kind: "page" as const,
    vendorId: page.vendorId,
    teamId: page.teamId,
    promoterMembershipId: page.promoterMembershipId,
    contentOwnerMembershipId: page.contentOwnerMembershipId,
    seminarOwnerMembershipId: page.live?.seminarOwnerMembershipId,
  };
}

function assertLiveBinding(page: ShareablePage): asserts page is ShareablePage & { live: NonNullable<ShareablePage["live"]> } {
  if (
    !page.live
    || page.live.teamId !== page.teamId
    || page.live.seminarOwnerMembershipId !== page.contentOwnerMembershipId
    || !isPublicLiveLifecycle(page.live.status, page.live.replayEnabled)
  ) {
    throw new TeamFunnelLiveShareConflictError("The source page must be bound to an available A-owned webinar");
  }
}

async function assertSharePaymentMethod(
  page: ShareablePage & { live: NonNullable<ShareablePage["live"]> },
  vendorId: string,
  db: ReturnType<typeof getDb>,
) {
  const policy = parseLiveQuotaPolicy(page.live.quotaPolicy);
  const memberIds = [
    ...policy.customAllocations.map((allocation) => allocation.membershipId),
    ...policy.memberQuotas.map((quota) => quota.membershipId),
  ];
  if (memberIds.length === 0 && policy.pageQuotas.length === 0) return;

  try {
    await assertPaymentMethodReferenceForQuota(db, {
      vendorId,
      payerScope: policy.quotaPayerScope,
      memberIds,
    });
  } catch (error) {
    if (error instanceof PaymentMethodReferenceRequiredError) {
      throw new TeamFunnelLiveShareConflictError("A Live share requires an active payment method reference");
    }
    throw error;
  }
}

async function loadAccessFacts(vendorId: string, teamId: string) {
  const db = getDb();
  const [memberships, relationships] = await Promise.all([
    db.teamMembership.findMany({
      where: { vendorId, teamId },
      select: {
        id: true,
        vendorId: true,
        teamId: true,
        vendorMemberId: true,
        status: true,
        leftAt: true,
        affiliate: { select: { code: true, isActive: true } },
        vendorMember: { select: { userId: true, status: true, deactivatedAt: true } },
      },
    }),
    db.teamMembershipRelationship.findMany({
      where: { teamId },
      select: { teamId: true, uplineMembershipId: true, downlineMembershipId: true, effectiveAt: true, endedAt: true },
    }),
  ]);
  return {
    memberships: memberships.map((membership) => ({
      id: membership.id,
      vendorId: membership.vendorId,
      teamId: membership.teamId,
      vendorMemberId: membership.vendorMemberId,
      userId: membership.vendorMember.userId,
      status: membership.status,
      leftAt: membership.leftAt,
      vendorMemberStatus: membership.vendorMember.status,
      vendorMemberDeactivatedAt: membership.vendorMember.deactivatedAt,
      affiliateCode: membership.affiliate?.isActive ? membership.affiliate.code : null,
    })),
    relationships,
  };
}

type AccessFacts = Awaited<ReturnType<typeof loadAccessFacts>>;
type AccessMembership = AccessFacts["memberships"][number];

function isActive(membership: AccessMembership | TeamFunnelMembership) {
  return membership.status === "ACTIVE"
    && membership.leftAt === null
    && membership.vendorMemberStatus === "active"
    && membership.vendorMemberDeactivatedAt === null;
}

function hasCurrentRelationship(
  relationships: readonly TeamFunnelRelationship[],
  teamId: string,
  uplineMembershipId: string,
  downlineMembershipId: string,
  now: Date,
) {
  return relationships.some((relationship) =>
    relationship.teamId === teamId
    && relationship.uplineMembershipId === uplineMembershipId
    && relationship.downlineMembershipId === downlineMembershipId
    && relationship.effectiveAt <= now
    && (!relationship.endedAt || relationship.endedAt > now),
  );
}

function resolveLeader(membershipId: string, relationships: readonly TeamFunnelRelationship[], teamId: string) {
  return relationships.find((relationship) => relationship.teamId === teamId && relationship.downlineMembershipId === membershipId && !relationship.endedAt)?.uplineMembershipId ?? membershipId;
}

function issueLiveShareCode() {
  return `${LIVE_SHARE_CODE_PREFIX}.${randomBytes(32).toString("base64url")}`;
}

function isLiveShareCode(value: string) {
  const [prefix, entropy, ...extra] = value.split(".");
  return prefix === LIVE_SHARE_CODE_PREFIX
    && Boolean(entropy)
    && entropy !== undefined
    && entropy.length >= 32
    && entropy.length <= 155
    && extra.length === 0
    && /^[A-Za-z0-9_-]+$/u.test(entropy);
}

function isPublicLiveLifecycle(status: string, replayEnabled: boolean) {
  return status === "scheduled" || status === "live" || (status === "ended" && replayEnabled);
}
