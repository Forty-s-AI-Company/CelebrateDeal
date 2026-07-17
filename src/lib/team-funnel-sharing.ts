import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import {
  TeamFunnelAccessDeniedError,
  assertTeamFunnelAccess,
  requireTeamFunnelActor,
  type TeamFunnelMembership,
  type TeamFunnelRelationship,
} from "@/lib/team-funnel-access";
import { getTeamFunnelFieldModes, type TeamFunnelPageField } from "@/lib/team-funnel-pages";

export const teamFunnelCopyModes = ["QUICK_APPLY", "COPY_THEN_EDIT", "BLANK_PAGE_BOUND_TO_A_WEBINAR"] as const;
export type TeamFunnelCopyMode = (typeof teamFunnelCopyModes)[number];

export type TeamFunnelShareAudience =
  | { type: "DIRECT_DOWNLINE" }
  | { type: "MEMBER"; membershipId: string };

export type CreateTeamFunnelShareInput = {
  teamId: string;
  pageId: string;
  expiresAt?: Date | null;
  maxUses?: number | null;
  audience?: TeamFunnelShareAudience;
};

export type ClaimTeamFunnelShareInput = {
  teamId: string;
  shareCode: string;
  mode: TeamFunnelCopyMode;
  slug: string;
};

export class TeamFunnelShareUnavailableError extends Error {
  readonly code = "TEAM_FUNNEL_SHARE_UNAVAILABLE";

  constructor() {
    super("This team funnel share is unavailable");
    this.name = "TeamFunnelShareUnavailableError";
  }
}

export class TeamFunnelShareConflictError extends Error {
  readonly code = "TEAM_FUNNEL_SHARE_CONFLICT";

  constructor(message = "This team funnel share cannot be applied") {
    super(message);
    this.name = "TeamFunnelShareConflictError";
  }
}

type ShareCodeClaims = { v: 1; audience: TeamFunnelShareAudience };
type AccessFacts = { memberships: TeamFunnelMembership[]; relationships: TeamFunnelRelationship[] };

/**
 * Creates a high-entropy opaque share code. Its policy is part of the encoded claims,
 * while the database receives only a SHA-256 hash of the complete code.
 * A changed claim changes the hash and cannot be accepted.
 */
export async function createTeamFunnelShare(input: CreateTeamFunnelShareInput) {
  const actor = await requireTeamFunnelActor(input.teamId);
  const page = await loadSourcePage(actor, input.pageId);
  const facts = await loadAccessFacts(actor);
  assertTeamFunnelAccess({
    action: "share",
    actor,
    resource: pageResource(page),
    ...facts,
  });

  const expiresAt = input.expiresAt ?? null;
  const maxUses = input.maxUses ?? null;
  if (expiresAt && expiresAt <= new Date()) throw new TeamFunnelShareConflictError("A share expiry must be in the future");
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    throw new TeamFunnelShareConflictError("A share usage limit must be at least one");
  }

  const audience = input.audience ?? { type: "DIRECT_DOWNLINE" as const };
  if (audience.type === "MEMBER") {
    const member = facts.memberships.find((candidate) => candidate.id === audience.membershipId);
    if (!member || !isActive(member)) throw new TeamFunnelAccessDeniedError("missing_resource");
  }

  const shareCode = issueShareCode({ v: 1, audience });
  const tokenHash = hashShareCode(shareCode);
  const db = getDb();
  const share = await db.partnerFunnelPageShareSetting.upsert({
    where: { pageId: page.id },
    create: {
      pageId: page.id,
      accessMode: "TOKEN_REQUIRED",
      tokenHash,
      expiresAt,
      maxUses,
      useCount: 0,
      isEnabled: true,
    },
    update: {
      accessMode: "TOKEN_REQUIRED",
      tokenHash,
      expiresAt,
      maxUses,
      useCount: 0,
      isEnabled: true,
    },
  });

  return {
    share: { id: share.id, pageId: page.id, expiresAt: share.expiresAt, maxUses: share.maxUses, isEnabled: share.isEnabled },
    // Deliberately returned only from this creation call. Never return or persist it elsewhere.
    shareCode,
  };
}

export async function disableTeamFunnelShare(input: { teamId: string; pageId: string }) {
  const actor = await requireTeamFunnelActor(input.teamId);
  const page = await loadSourcePage(actor, input.pageId);
  const facts = await loadAccessFacts(actor);
  assertTeamFunnelAccess({ action: "share", actor, resource: pageResource(page), ...facts });

  const share = await getDb().partnerFunnelPageShareSetting.update({
    where: { pageId: page.id },
    data: { accessMode: "DISABLED", isEnabled: false },
  });
  return { id: share.id, pageId: page.id, isEnabled: share.isEnabled };
}

/** Claims exactly the one source page identified by the share-code hash; no other A resource is queried or exposed. */
export async function claimTeamFunnelShare(input: ClaimTeamFunnelShareInput) {
  const actor = await requireTeamFunnelActor(input.teamId);
  const claims = parseShareCode(input.shareCode);
  const db = getDb();
  const tokenHash = hashShareCode(input.shareCode);
  const share = await db.partnerFunnelPageShareSetting.findFirst({
    where: { tokenHash },
    include: { page: { include: sourcePageInclude } },
  });
  if (!share || !isUsableShare(share)) throw new TeamFunnelShareUnavailableError();

  const page = share.page;
  // The authenticated B must be in the source page's exact tenant and team.
  if (page.vendorId !== actor.vendorId || page.teamId !== actor.teamId) throw new TeamFunnelShareUnavailableError();
  const facts = await loadAccessFacts(actor);
  assertActiveSourceOwners(page, facts);
  // A direct-downline share is constrained to the member who owns the shared
  // page as a promoter. The page's content owner can be an upstream member,
  // so using it here would accidentally give that upstream member control over
  // A's downline policy.
  assertAudience(claims.audience, actor, page.promoterMembershipId, facts);

  try {
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.partnerFunnelPage.findFirst({
        where: {
          vendorId: actor.vendorId,
          teamId: actor.teamId,
          templateVersionId: page.templateVersionId,
          promoterMembershipId: actor.id,
        },
      });
      if (existing) return { page: existing, duplicate: true as const };

      const freshShare = await tx.partnerFunnelPageShareSetting.findFirst({ where: { id: share.id } });
      if (!freshShare || !isUsableShare(freshShare)) throw new TeamFunnelShareUnavailableError();
      if (freshShare.maxUses !== null && freshShare.useCount >= freshShare.maxUses) throw new TeamFunnelShareUnavailableError();

      if (freshShare.maxUses !== null) {
        const consumed = await tx.partnerFunnelPageShareSetting.updateMany({
          where: { id: freshShare.id, useCount: { lt: freshShare.maxUses } },
          data: { useCount: { increment: 1 } },
        });
        if (consumed.count !== 1) throw new TeamFunnelShareUnavailableError();
      } else {
        await tx.partnerFunnelPageShareSetting.update({ where: { id: freshShare.id }, data: { useCount: { increment: 1 } } });
      }

      const content = copyContent(page, input.mode);
      const created = await tx.partnerFunnelPage.create({
        data: {
          vendorId: actor.vendorId,
          teamId: actor.teamId,
          templateVersionId: page.templateVersionId,
          promoterMembershipId: actor.id,
          // B owns registration/leads; A remains content and webinar owner.
          contentOwnerMembershipId: page.contentOwnerMembershipId,
          liveId: boundWebinarId(page, input.mode),
          slug: input.slug,
          ...content,
        },
      });
      return { page: created, duplicate: false as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    return {
      ...result,
      mode: input.mode,
      source: {
        pageId: page.id,
        templateId: page.templateVersion.templateId,
        templateVersionId: page.templateVersionId,
        version: page.templateVersion.version,
      },
      fieldModes: getTeamFunnelFieldModes(page.templateVersion.fieldLocks.map((lock) => lock.field as TeamFunnelPageField)),
    };
  } catch (error) {
    if (isUniqueConstraint(error)) {
      const existing = await db.partnerFunnelPage.findFirst({
        where: { vendorId: actor.vendorId, teamId: actor.teamId, templateVersionId: page.templateVersionId, promoterMembershipId: actor.id },
      });
      if (existing) {
        return {
          page: existing,
          duplicate: true as const,
          mode: input.mode,
          source: { pageId: page.id, templateId: page.templateVersion.templateId, templateVersionId: page.templateVersionId, version: page.templateVersion.version },
          fieldModes: getTeamFunnelFieldModes(page.templateVersion.fieldLocks.map((lock) => lock.field as TeamFunnelPageField)),
        };
      }
    }
    throw error;
  }
}

export function hashShareCode(shareCode: string) {
  return createHash("sha256").update(shareCode, "utf8").digest("hex");
}

function issueShareCode(claims: ShareCodeClaims) {
  return `tf1.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${randomBytes(32).toString("base64url")}`;
}

function parseShareCode(shareCode: string): ShareCodeClaims {
  const [version, encodedClaims, entropy, ...extra] = shareCode.split(".");
  if (version !== "tf1" || !encodedClaims || !entropy || extra.length || entropy.length < 32) throw new TeamFunnelShareUnavailableError();
  try {
    const value: unknown = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8"));
    if (!isShareCodeClaims(value)) throw new Error("invalid claims");
    return value;
  } catch {
    throw new TeamFunnelShareUnavailableError();
  }
}

function isShareCodeClaims(value: unknown): value is ShareCodeClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Partial<ShareCodeClaims>;
  return claims.v === 1 && (claims.audience?.type === "DIRECT_DOWNLINE"
    || (claims.audience?.type === "MEMBER" && typeof claims.audience.membershipId === "string" && claims.audience.membershipId.length > 0));
}

function assertActiveSourceOwners(page: Pick<SourcePage, "promoterMembershipId" | "contentOwnerMembershipId">, facts: AccessFacts) {
  const memberships = new Map(facts.memberships.map((membership) => [membership.id, membership]));
  const hasActiveMembership = (membershipId: string) => {
    const membership = memberships.get(membershipId);
    return membership !== undefined && isActive(membership);
  };
  if (![page.promoterMembershipId, page.contentOwnerMembershipId].every(hasActiveMembership)) {
    throw new TeamFunnelShareUnavailableError();
  }
}

function assertAudience(audience: TeamFunnelShareAudience, actor: TeamFunnelMembership, shareOwnerId: string, facts: AccessFacts) {
  if (!isActive(actor)) throw new TeamFunnelShareUnavailableError();
  if (audience.type === "MEMBER") {
    if (audience.membershipId !== actor.id) throw new TeamFunnelShareUnavailableError();
    return;
  }
  const hasRelationship = facts.relationships.some((relationship) =>
    relationship.teamId === actor.teamId
    && relationship.uplineMembershipId === shareOwnerId
    && relationship.downlineMembershipId === actor.id
    && relationship.effectiveAt <= new Date()
    && (!relationship.endedAt || relationship.endedAt > new Date()),
  );
  if (!hasRelationship) throw new TeamFunnelShareUnavailableError();
}

function copyContent(page: SourcePage, mode: TeamFunnelCopyMode) {
  if (mode === "BLANK_PAGE_BOUND_TO_A_WEBINAR") {
    if (!page.live || page.live.seminarOwnerMembershipId !== page.contentOwnerMembershipId) {
      throw new TeamFunnelShareConflictError("A blank page requires A's webinar binding");
    }
    return { headline: "", subheadline: null, body: null, ctaLabel: "", ctaUrl: null };
  }
  return { headline: page.headline, subheadline: page.subheadline, body: page.body, ctaLabel: page.ctaLabel, ctaUrl: page.ctaUrl };
}

function boundWebinarId(page: SourcePage, mode: TeamFunnelCopyMode) {
  if (page.liveId !== null && (!page.live || page.live.seminarOwnerMembershipId !== page.contentOwnerMembershipId)) {
    throw new TeamFunnelShareConflictError("A shared page may only retain A's webinar binding");
  }
  if (mode === "BLANK_PAGE_BOUND_TO_A_WEBINAR" && page.liveId === null) {
    throw new TeamFunnelShareConflictError("A blank page requires A's webinar binding");
  }
  return page.liveId;
}

const sourcePageInclude = {
  templateVersion: { include: { fieldLocks: { select: { field: true } } } },
  live: { select: { id: true, seminarOwnerMembershipId: true } },
} as const;

type SourcePage = {
  id: string;
  vendorId: string;
  teamId: string;
  templateVersionId: string;
  promoterMembershipId: string;
  contentOwnerMembershipId: string;
  liveId: string | null;
  headline: string;
  subheadline: string | null;
  body: string | null;
  ctaLabel: string;
  ctaUrl: string | null;
  live: { id: string; seminarOwnerMembershipId: string | null } | null;
  templateVersion: { templateId: string; version: number; fieldLocks: { field: string }[] };
};

async function loadSourcePage(actor: TeamFunnelMembership, pageId: string): Promise<SourcePage> {
  const page = await getDb().partnerFunnelPage.findFirst({
    where: { id: pageId, vendorId: actor.vendorId, teamId: actor.teamId },
    include: sourcePageInclude,
  });
  if (!page) throw new TeamFunnelAccessDeniedError("missing_resource");
  return page as SourcePage;
}

function pageResource(page: SourcePage) {
  return {
    id: page.id,
    kind: "page" as const,
    vendorId: page.vendorId,
    teamId: page.teamId,
    promoterMembershipId: page.promoterMembershipId,
    contentOwnerMembershipId: page.contentOwnerMembershipId,
    lockedFields: page.templateVersion.fieldLocks.map((lock) => lock.field as TeamFunnelPageField),
  };
}

async function loadAccessFacts(actor: TeamFunnelMembership): Promise<AccessFacts> {
  const db = getDb();
  const [memberships, relationships] = await Promise.all([
    db.teamMembership.findMany({
      where: { vendorId: actor.vendorId, teamId: actor.teamId },
      select: {
        id: true, vendorId: true, teamId: true, vendorMemberId: true, status: true, leftAt: true,
        vendorMember: { select: { userId: true, status: true, deactivatedAt: true } },
      },
    }),
    db.teamMembershipRelationship.findMany({
      where: { teamId: actor.teamId },
      select: { teamId: true, uplineMembershipId: true, downlineMembershipId: true, effectiveAt: true, endedAt: true },
    }),
  ]);
  return {
    memberships: memberships.map((membership) => ({
      ...membership,
      userId: membership.vendorMember.userId,
      vendorMemberStatus: membership.vendorMember.status,
      vendorMemberDeactivatedAt: membership.vendorMember.deactivatedAt,
    })),
    relationships,
  };
}

function isActive(membership: TeamFunnelMembership) {
  return membership.status === "ACTIVE" && membership.leftAt === null
    && membership.vendorMemberStatus === "active" && membership.vendorMemberDeactivatedAt === null;
}

function isUsableShare(share: { accessMode: string; isEnabled: boolean; expiresAt: Date | null; maxUses: number | null; useCount: number }) {
  return share.accessMode === "TOKEN_REQUIRED" && share.isEnabled
    && (!share.expiresAt || share.expiresAt > new Date())
    && (share.maxUses === null || share.useCount < share.maxUses);
}

function isUniqueConstraint(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034");
}
