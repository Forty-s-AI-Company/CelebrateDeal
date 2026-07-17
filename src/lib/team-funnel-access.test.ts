import { describe, expect, it } from "vitest";
import {
  TeamFunnelAccessDeniedError,
  assertTeamFunnelAccess,
  getTeamFunnelAccessDecision,
  type TeamFunnelAccessContext,
  type TeamFunnelMembership,
  type TeamFunnelResource,
  type TeamFunnelRelationship,
} from "./team-funnel-access";

const now = new Date("2026-07-17T12:00:00.000Z");

function membership(overrides: Partial<TeamFunnelMembership> = {}): TeamFunnelMembership {
  return {
    id: "member-a",
    vendorId: "vendor-1",
    teamId: "team-1",
    vendorMemberId: "vendor-member-a",
    userId: "user-a",
    status: "ACTIVE",
    leftAt: null,
    vendorMemberStatus: "active",
    vendorMemberDeactivatedAt: null,
    ...overrides,
  };
}

const leader = membership();
const partner = membership({
  id: "member-b",
  vendorMemberId: "vendor-member-b",
  userId: "user-b",
});
const unrelated = membership({
  id: "member-c",
  vendorMemberId: "vendor-member-c",
  userId: "user-c",
});

const activeRelationship: TeamFunnelRelationship = {
  teamId: "team-1",
  uplineMembershipId: leader.id,
  downlineMembershipId: partner.id,
  effectiveAt: new Date("2026-01-01T00:00:00.000Z"),
  endedAt: null,
};

function resource(overrides: Partial<TeamFunnelResource> = {}): TeamFunnelResource {
  return {
    id: "template-version-1",
    kind: "templateVersion",
    vendorId: "vendor-1",
    teamId: "team-1",
    contentOwnerMembershipId: leader.id,
    ...overrides,
  };
}

function accessContext(overrides: Partial<TeamFunnelAccessContext> = {}): TeamFunnelAccessContext {
  return {
    action: "read",
    actor: leader,
    resource: resource(),
    memberships: [leader, partner, unrelated],
    relationships: [activeRelationship],
    now,
    ...overrides,
  };
}

describe("team funnel access", () => {
  it("allows A to manage only the template version and webinar that A owns", () => {
    expect(getTeamFunnelAccessDecision(accessContext({ action: "edit" }))).toEqual({
      allowed: true,
      reason: "allowed",
    });

    expect(getTeamFunnelAccessDecision(accessContext({
      action: "bind",
      resource: resource({
        id: "webinar-1",
        kind: "webinar",
        contentOwnerMembershipId: undefined,
        seminarOwnerMembershipId: leader.id,
      }),
    }))).toEqual({ allowed: true, reason: "allowed" });

    expect(getTeamFunnelAccessDecision(accessContext({
      action: "edit",
      resource: resource({
        id: "webinar-b",
        kind: "webinar",
        contentOwnerMembershipId: undefined,
        seminarOwnerMembershipId: partner.id,
      }),
    }))).toEqual({ allowed: false, reason: "ownership_required" });
  });

  it("allows B to edit and share only B's own unlocked page copy", () => {
    const page = resource({
      id: "page-b",
      kind: "page",
      promoterMembershipId: partner.id,
      contentOwnerMembershipId: leader.id,
      lockedFields: ["CTA_URL"],
    });

    expect(getTeamFunnelAccessDecision(accessContext({
      action: "edit",
      actor: partner,
      resource: page,
      field: "HEADLINE",
    }))).toEqual({ allowed: true, reason: "allowed" });

    expect(getTeamFunnelAccessDecision(accessContext({
      action: "edit",
      actor: partner,
      resource: page,
      field: "CTA_URL",
    }))).toEqual({ allowed: false, reason: "locked_field" });

    expect(getTeamFunnelAccessDecision(accessContext({
      action: "share",
      actor: partner,
      resource: page,
    }))).toEqual({ allowed: true, reason: "allowed" });

    expect(getTeamFunnelAccessDecision(accessContext({
      action: "share",
      resource: page,
    }))).toEqual({ allowed: false, reason: "ownership_required" });
  });

  it("allows a B to copy and bind only content owned by its current A", () => {
    expect(getTeamFunnelAccessDecision(accessContext({
      action: "copy",
      actor: partner,
    }))).toEqual({ allowed: true, reason: "allowed" });

    expect(getTeamFunnelAccessDecision(accessContext({
      action: "bind",
      actor: partner,
      resource: resource({
        id: "page-b",
        kind: "page",
        promoterMembershipId: partner.id,
        contentOwnerMembershipId: leader.id,
      }),
    }))).toEqual({ allowed: true, reason: "allowed" });

    expect(getTeamFunnelAccessDecision(accessContext({
      action: "copy",
      actor: partner,
      relationships: [{ ...activeRelationship, endedAt: new Date("2026-07-01T00:00:00.000Z") }],
    }))).toEqual({ allowed: false, reason: "missing_relationship" });
  });

  it("limits reports to self or an active direct A-to-B relationship", () => {
    const report = resource({
      id: "report-b",
      kind: "report",
      contentOwnerMembershipId: undefined,
      subjectMembershipId: partner.id,
    });

    expect(getTeamFunnelAccessDecision(accessContext({ action: "report", resource: report }))).toEqual({
      allowed: true,
      reason: "allowed",
    });
    expect(getTeamFunnelAccessDecision(accessContext({ action: "report", actor: partner, resource: report }))).toEqual({
      allowed: true,
      reason: "allowed",
    });
    expect(getTeamFunnelAccessDecision(accessContext({ action: "report", actor: unrelated, resource: report }))).toEqual({
      allowed: false,
      reason: "missing_relationship",
    });
  });

  it("rejects an unrelated member and a cross-vendor resource before ownership checks", () => {
    expect(getTeamFunnelAccessDecision(accessContext({ actor: unrelated }))).toEqual({
      allowed: false,
      reason: "ownership_required",
    });

    expect(getTeamFunnelAccessDecision(accessContext({
      resource: resource({ vendorId: "vendor-2" }),
    }))).toEqual({ allowed: false, reason: "tenant_mismatch" });
  });

  it("fails closed for inactive actor or resource owners", () => {
    const inactiveLeader = membership({ status: "INACTIVE" });
    expect(getTeamFunnelAccessDecision(accessContext({
      actor: inactiveLeader,
      memberships: [inactiveLeader, partner, unrelated],
    }))).toEqual({ allowed: false, reason: "inactive_actor" });

    expect(getTeamFunnelAccessDecision(accessContext({
      memberships: [leader, membership({ ...partner, status: "INACTIVE" }), unrelated],
      resource: resource({
        kind: "page",
        promoterMembershipId: partner.id,
        contentOwnerMembershipId: leader.id,
      }),
    }))).toEqual({ allowed: false, reason: "inactive_resource_owner" });
  });

  it("uses only server-loaded membership facts for the current actor", () => {
    const disabledLeader = membership({
      vendorMemberStatus: "inactive",
      vendorMemberDeactivatedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    expect(getTeamFunnelAccessDecision(accessContext({
      actor: leader,
      memberships: [disabledLeader, partner, unrelated],
    }))).toEqual({ allowed: false, reason: "inactive_actor" });

    expect(getTeamFunnelAccessDecision(accessContext({
      actor: partner,
      memberships: [leader, unrelated],
    }))).toEqual({ allowed: false, reason: "inactive_actor" });
  });

  it("rejects disabled or expired shares even when the actor otherwise owns the page", () => {
    const ownPage = resource({
      kind: "page",
      promoterMembershipId: partner.id,
      contentOwnerMembershipId: leader.id,
    });

    expect(getTeamFunnelAccessDecision(accessContext({
      action: "read",
      actor: partner,
      resource: { ...ownPage, sharing: { accessMode: "DISABLED", isEnabled: true, expiresAt: null } },
    }))).toEqual({ allowed: false, reason: "inactive_share" });
    expect(getTeamFunnelAccessDecision(accessContext({
      action: "share",
      actor: partner,
      resource: { ...ownPage, sharing: { accessMode: "TOKEN_REQUIRED", isEnabled: true, expiresAt: new Date("2026-07-17T11:59:59.000Z") } },
    }))).toEqual({ allowed: false, reason: "expired_share" });
  });

  it("rejects a missing resource and throws a stable denial error for writes", () => {
    expect(getTeamFunnelAccessDecision(accessContext({ resource: null }))).toEqual({
      allowed: false,
      reason: "missing_resource",
    });

    expect(() => assertTeamFunnelAccess(accessContext({ action: "edit", actor: unrelated }))).toThrow(
      new TeamFunnelAccessDeniedError("ownership_required"),
    );
  });
});
