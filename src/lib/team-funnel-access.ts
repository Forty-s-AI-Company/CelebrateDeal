import { getDb } from "@/lib/db";
import { requireAuth, requireVendor } from "@/lib/auth";

const ACTIVE_VENDOR_MEMBER_STATUS = "active";
const ACTIVE_TEAM_MEMBERSHIP_STATUS = "ACTIVE";

export type TeamFunnelAction = "read" | "edit" | "share" | "copy" | "bind" | "report";
export type TeamFunnelResourceKind = "template" | "templateVersion" | "webinar" | "page" | "productOverride" | "report";
export type TeamFunnelField = "HEADLINE" | "SUBHEADLINE" | "BODY" | "CTA_LABEL" | "CTA_URL" | "PRODUCT_SLOTS";

export type TeamFunnelMembership = {
  id: string;
  vendorId: string;
  teamId: string;
  vendorMemberId: string;
  userId: string;
  status: "ACTIVE" | "INACTIVE";
  leftAt: Date | null;
  vendorMemberStatus: string;
  vendorMemberDeactivatedAt: Date | null;
};

export type TeamFunnelRelationship = {
  teamId: string;
  uplineMembershipId: string;
  downlineMembershipId: string;
  effectiveAt: Date;
  endedAt: Date | null;
};

export type TeamFunnelShareState = {
  accessMode: "PUBLIC" | "TOKEN_REQUIRED" | "DISABLED";
  isEnabled: boolean;
  expiresAt: Date | null;
};

/**
 * This is the minimum, server-derived shape required to authorize a resource.
 * A missing owner is deliberately not inferred from client input: it is denied.
 */
export type TeamFunnelResource = {
  id: string;
  kind: TeamFunnelResourceKind;
  vendorId: string;
  teamId: string;
  ownerMembershipId?: string | null;
  promoterMembershipId?: string | null;
  contentOwnerMembershipId?: string | null;
  seminarOwnerMembershipId?: string | null;
  subjectMembershipId?: string | null;
  lockedFields?: readonly TeamFunnelField[];
  sharing?: TeamFunnelShareState | null;
};

export type TeamFunnelAccessContext = {
  action: TeamFunnelAction;
  actor: TeamFunnelMembership | null;
  resource: TeamFunnelResource | null;
  memberships: readonly TeamFunnelMembership[];
  relationships: readonly TeamFunnelRelationship[];
  field?: TeamFunnelField;
  now?: Date;
};

export type TeamFunnelAccessDecision = {
  allowed: boolean;
  reason:
    | "allowed"
    | "missing_actor"
    | "missing_resource"
    | "inactive_actor"
    | "tenant_mismatch"
    | "team_mismatch"
    | "inactive_resource_owner"
    | "inactive_share"
    | "expired_share"
    | "locked_field"
    | "missing_field"
    | "missing_relationship"
    | "ownership_required"
    | "unsupported_action";
};

export class TeamFunnelAccessDeniedError extends Error {
  readonly code = "TEAM_FUNNEL_ACCESS_DENIED";

  constructor(readonly reason: Exclude<TeamFunnelAccessDecision["reason"], "allowed">) {
    super(`Team funnel access denied: ${reason}`);
    this.name = "TeamFunnelAccessDeniedError";
  }
}

/**
 * Resolves the authenticated actor into an active membership in a specific team.
 * It intentionally invokes the established guards before reading team data; callers
 * cannot supply a user, vendor, or membership id to bypass the current session.
 */
export async function requireTeamFunnelActor(teamId: string): Promise<TeamFunnelMembership> {
  const auth = await requireAuth();
  const vendor = await requireVendor();

  if (!auth.member || auth.member.status !== ACTIVE_VENDOR_MEMBER_STATUS || auth.member.deactivatedAt) {
    throw new TeamFunnelAccessDeniedError("inactive_actor");
  }

  const membership = await getDb().teamMembership.findFirst({
    where: {
      vendorId: vendor.id,
      teamId,
      vendorMemberId: auth.member.id,
      status: ACTIVE_TEAM_MEMBERSHIP_STATUS,
      leftAt: null,
      vendorMember: {
        userId: auth.user.id,
        vendorId: vendor.id,
        status: ACTIVE_VENDOR_MEMBER_STATUS,
        deactivatedAt: null,
      },
    },
    select: {
      id: true,
      vendorId: true,
      teamId: true,
      vendorMemberId: true,
      status: true,
      leftAt: true,
      vendorMember: {
        select: {
          userId: true,
          status: true,
          deactivatedAt: true,
        },
      },
    },
  });

  if (!membership) {
    throw new TeamFunnelAccessDeniedError("inactive_actor");
  }

  return {
    id: membership.id,
    vendorId: membership.vendorId,
    teamId: membership.teamId,
    vendorMemberId: membership.vendorMemberId,
    userId: membership.vendorMember.userId,
    status: membership.status,
    leftAt: membership.leftAt,
    vendorMemberStatus: membership.vendorMember.status,
    vendorMemberDeactivatedAt: membership.vendorMember.deactivatedAt,
  };
}

/**
 * Central, pure policy evaluation for every team-funnel read and mutation.
 * Resource and membership facts must be loaded server-side with vendorId and teamId
 * constraints before this function is called. Any incomplete or inconsistent fact
 * set is denied instead of being guessed from a client-provided id.
 */
export function getTeamFunnelAccessDecision(context: TeamFunnelAccessContext): TeamFunnelAccessDecision {
  const now = context.now ?? new Date();
  const { resource } = context;
  const requestedActor = context.actor;

  if (!requestedActor) return denied("missing_actor");
  if (!resource) return denied("missing_resource");

  // The actor argument identifies the current session, but its authorization
  // facts must come from the server-loaded membership set. Never promote a
  // client-supplied membership into that set merely because its id matches.
  const memberships = new Map(context.memberships.map((membership) => [membership.id, membership]));
  const actor = memberships.get(requestedActor.id);
  if (!actor || !hasSameMembershipIdentity(actor, requestedActor) || !isActiveMembership(actor)) {
    return denied("inactive_actor");
  }

  if (actor.vendorId !== resource.vendorId) return denied("tenant_mismatch");
  if (actor.teamId !== resource.teamId) return denied("team_mismatch");
  if (!isUsableShare(resource.sharing, now)) {
    return denied(resource.sharing?.expiresAt && resource.sharing.expiresAt <= now ? "expired_share" : "inactive_share");
  }

  const ownerMembershipIds = resourceOwnerIds(resource);
  if (ownerMembershipIds.some((membershipId) => !isActiveResourceMembership(memberships.get(membershipId), resource))) {
    return denied("inactive_resource_owner");
  }

  const owns = (membershipId: string | null | undefined) => membershipId === actor.id;
  const isDirectLeaderOf = (membershipId: string | null | undefined) => {
    return membershipId
      ? hasCurrentRelationship(context.relationships, resource.teamId, actor.id, membershipId, now)
      : false;
  };
  const isDirectUpline = (membershipId: string | null | undefined) => {
    return membershipId
      ? hasCurrentRelationship(context.relationships, resource.teamId, membershipId, actor.id, now)
      : false;
  };

  switch (context.action) {
    case "read":
      if (resource.kind === "report") {
        return owns(resource.subjectMembershipId) || isDirectLeaderOf(resource.subjectMembershipId)
          ? allowed()
          : denied("missing_relationship");
      }
      return owns(primaryOwnerId(resource)) || isDirectLeaderOf(primaryOwnerId(resource))
        ? allowed()
        : denied("ownership_required");

    case "report":
      return resource.kind === "report" && (owns(resource.subjectMembershipId) || isDirectLeaderOf(resource.subjectMembershipId))
        ? allowed()
        : denied("missing_relationship");

    case "edit":
      if (resource.kind === "page" || resource.kind === "productOverride") {
        if (!owns(resource.promoterMembershipId)) return denied("ownership_required");
        if (!context.field) return denied("missing_field");
        return resource.lockedFields?.includes(context.field) ? denied("locked_field") : allowed();
      }
      if (resource.kind === "template" || resource.kind === "templateVersion") {
        return owns(resource.contentOwnerMembershipId ?? resource.ownerMembershipId)
          ? allowed()
          : denied("ownership_required");
      }
      if (resource.kind === "webinar") {
        return owns(resource.seminarOwnerMembershipId ?? resource.ownerMembershipId)
          ? allowed()
          : denied("ownership_required");
      }
      return denied("unsupported_action");

    case "share":
      return resource.kind === "page" && owns(resource.promoterMembershipId)
        ? allowed()
        : denied("ownership_required");

    case "copy":
      if (resource.kind !== "template" && resource.kind !== "templateVersion") return denied("unsupported_action");
      return owns(resource.contentOwnerMembershipId ?? resource.ownerMembershipId) || isDirectUpline(resource.contentOwnerMembershipId ?? resource.ownerMembershipId)
        ? allowed()
        : denied("missing_relationship");

    case "bind":
      if (resource.kind === "page" || resource.kind === "productOverride") {
        if (!owns(resource.promoterMembershipId)) return denied("ownership_required");
        return isDirectUpline(resource.contentOwnerMembershipId) || owns(resource.contentOwnerMembershipId)
          ? allowed()
          : denied("missing_relationship");
      }
      if (resource.kind === "webinar") {
        return owns(resource.seminarOwnerMembershipId ?? resource.ownerMembershipId)
          ? allowed()
          : denied("ownership_required");
      }
      return denied("unsupported_action");
  }
}

export function assertTeamFunnelAccess(context: TeamFunnelAccessContext): void {
  const decision = getTeamFunnelAccessDecision(context);
  if (decision.reason !== "allowed") {
    throw new TeamFunnelAccessDeniedError(decision.reason);
  }
}

function resourceOwnerIds(resource: TeamFunnelResource) {
  return [
    resource.ownerMembershipId,
    resource.promoterMembershipId,
    resource.contentOwnerMembershipId,
    resource.seminarOwnerMembershipId,
    resource.subjectMembershipId,
  ].filter((membershipId): membershipId is string => Boolean(membershipId));
}

function primaryOwnerId(resource: TeamFunnelResource) {
  return resource.promoterMembershipId
    ?? resource.contentOwnerMembershipId
    ?? resource.seminarOwnerMembershipId
    ?? resource.subjectMembershipId
    ?? resource.ownerMembershipId;
}

function isActiveMembership(membership: TeamFunnelMembership) {
  return membership.status === ACTIVE_TEAM_MEMBERSHIP_STATUS
    && membership.leftAt === null
    && membership.vendorMemberStatus === ACTIVE_VENDOR_MEMBER_STATUS
    && membership.vendorMemberDeactivatedAt === null;
}

function hasSameMembershipIdentity(
  actual: TeamFunnelMembership,
  requested: TeamFunnelMembership,
) {
  return actual.vendorId === requested.vendorId
    && actual.teamId === requested.teamId
    && actual.vendorMemberId === requested.vendorMemberId
    && actual.userId === requested.userId;
}

function isActiveResourceMembership(
  membership: TeamFunnelMembership | undefined,
  resource: TeamFunnelResource,
) {
  if (!membership) return false;

  return membership.vendorId === resource.vendorId
    && membership.teamId === resource.teamId
    && isActiveMembership(membership);
}

function isUsableShare(share: TeamFunnelShareState | null | undefined, now: Date) {
  return !share || (share.accessMode !== "DISABLED" && share.isEnabled && (!share.expiresAt || share.expiresAt > now));
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

function allowed(): TeamFunnelAccessDecision {
  return { allowed: true, reason: "allowed" };
}

function denied(reason: Exclude<TeamFunnelAccessDecision["reason"], "allowed">): TeamFunnelAccessDecision {
  return { allowed: false, reason };
}
