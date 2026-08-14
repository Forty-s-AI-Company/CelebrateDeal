"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorOwner } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { toSlug } from "@/lib/format";

const TEAM_PATH = "/settings/team";

class TeamManagementError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectError(code: string): never {
  redirect(`${TEAM_PATH}?error=${encodeURIComponent(code)}`);
}

function isPrismaConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "P2002" || error.code === "P2025" || error.code === "P2034");
}

function isSerializableConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

async function runSerializable<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return getDb().$transaction(callback, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

function revalidateTeamViews() {
  revalidatePath(TEAM_PATH);
  revalidatePath("/team-templates");
  revalidatePath("/team-performance");
}

export async function createSalesTeamAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const name = text(formData, "name");
  const slug = toSlug(text(formData, "slug") || name);
  if (!name || name.length > 80 || !slug || slug.length > 80) redirectError("team_invalid");

  let team;
  try {
    team = await runSerializable(async (tx) => {
      const created = await tx.salesTeam.create({
        data: { vendorId: auth.vendor.id, name, slug },
      });
      // A newly created team must be usable immediately by its owner.
      await tx.teamMembership.create({
        data: { vendorId: auth.vendor.id, teamId: created.id, vendorMemberId: auth.member.id },
      });
      return created;
    });
  } catch (error) {
    if (isPrismaConflict(error)) redirectError("team_conflict");
    throw error;
  }

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "create_sales_team",
    targetType: "SalesTeam",
    targetId: team.id,
    after: auditSnapshot({ id: team.id, name: team.name, slug: team.slug, ownerMemberId: auth.member.id }),
  });
  revalidateTeamViews();
  redirect(`${TEAM_PATH}?updated=team_created`);
}

export async function addTeamMemberAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const teamId = text(formData, "teamId");
  const vendorMemberId = text(formData, "vendorMemberId");
  if (!teamId || !vendorMemberId) redirectError("member_invalid");

  let membership;
  try {
    membership = await runSerializable(async (tx) => {
      const team = await tx.salesTeam.findFirst({
        where: { id: teamId, vendorId: auth.vendor.id },
        select: { id: true },
      });
      const member = await tx.vendorMember.findFirst({
        where: { id: vendorMemberId, vendorId: auth.vendor.id, status: "active" },
        select: { id: true },
      });
      if (!team) throw new TeamManagementError("team_invalid");
      if (!member) throw new TeamManagementError("member_invalid");

      const existing = await tx.teamMembership.findUnique({
        where: { teamId_vendorMemberId: { teamId, vendorMemberId } },
        select: { id: true, status: true },
      });
      if (existing?.status === "ACTIVE") throw new TeamManagementError("member_exists");
      if (existing) {
        return tx.teamMembership.update({
          where: { id: existing.id },
          data: { status: "ACTIVE", leftAt: null, joinedAt: new Date() },
        });
      }
      return tx.teamMembership.create({
        data: { vendorId: auth.vendor.id, teamId, vendorMemberId },
      });
    });
  } catch (error) {
    if (error instanceof TeamManagementError) redirectError(error.code);
    if (isPrismaConflict(error)) redirectError("member_conflict");
    throw error;
  }

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "add_team_member",
    targetType: "TeamMembership",
    targetId: membership.id,
    after: auditSnapshot({ id: membership.id, teamId, vendorMemberId, status: membership.status }),
  });
  revalidateTeamViews();
  redirect(`${TEAM_PATH}?updated=member_added`);
}

/**
 * Move one active membership between teams atomically. Historical source-team
 * relationships are ended in the same transaction before the target membership
 * is activated, so a partial move cannot leave two active team identities.
 */
export async function transferTeamMemberAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const sourceTeamId = text(formData, "sourceTeamId");
  const targetTeamId = text(formData, "targetTeamId");
  const membershipId = text(formData, "membershipId");
  if (!sourceTeamId || !targetTeamId || !membershipId || sourceTeamId === targetTeamId) redirectError("team_move_invalid");

  let moved;
  try {
    moved = await runSerializable(async (tx) => {
      const [sourceMembership, targetTeam] = await Promise.all([
        tx.teamMembership.findFirst({
          where: { id: membershipId, vendorId: auth.vendor.id, teamId: sourceTeamId, status: "ACTIVE", leftAt: null },
          select: { id: true, vendorMemberId: true },
        }),
        tx.salesTeam.findFirst({ where: { id: targetTeamId, vendorId: auth.vendor.id }, select: { id: true } }),
      ]);
      if (!sourceMembership) throw new TeamManagementError("membership_invalid");
      if (!targetTeam) throw new TeamManagementError("team_invalid");

      const member = await tx.vendorMember.findFirst({
        where: { id: sourceMembership.vendorMemberId, vendorId: auth.vendor.id, status: "active" },
        select: { id: true },
      });
      if (!member) throw new TeamManagementError("member_invalid");

      const targetMembership = await tx.teamMembership.findUnique({
        where: { teamId_vendorMemberId: { teamId: targetTeamId, vendorMemberId: sourceMembership.vendorMemberId } },
        select: { id: true, status: true },
      });
      if (targetMembership?.status === "ACTIVE") throw new TeamManagementError("team_move_conflict");

      const now = new Date();
      await tx.teamMembershipRelationship.updateMany({
        where: {
          teamId: sourceTeamId,
          endedAt: null,
          OR: [{ uplineMembershipId: membershipId }, { downlineMembershipId: membershipId }],
        },
        data: { endedAt: now },
      });
      await tx.teamMembership.update({
        where: { id: membershipId },
        data: { status: "INACTIVE", leftAt: now },
      });

      const activated = targetMembership
        ? await (async () => {
            // An inactive target must not revive a stale active relationship.
            await tx.teamMembershipRelationship.updateMany({
              where: {
                teamId: targetTeamId,
                endedAt: null,
                OR: [{ uplineMembershipId: targetMembership.id }, { downlineMembershipId: targetMembership.id }],
              },
              data: { endedAt: now },
            });
            return tx.teamMembership.update({
              where: { id: targetMembership.id },
              data: { status: "ACTIVE", leftAt: null, joinedAt: now },
            });
          })()
        : await tx.teamMembership.create({
            data: { vendorId: auth.vendor.id, teamId: targetTeamId, vendorMemberId: sourceMembership.vendorMemberId },
          });
      return { sourceMembershipId: membershipId, targetMembershipId: activated.id, vendorMemberId: sourceMembership.vendorMemberId };
    });
  } catch (error) {
    if (error instanceof TeamManagementError) redirectError(error.code);
    if (isPrismaConflict(error)) redirectError("team_move_conflict");
    throw error;
  }

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "transfer_team_member",
    targetType: "TeamMembership",
    targetId: moved.targetMembershipId,
    after: auditSnapshot({ ...moved, sourceTeamId, targetTeamId }),
  });
  revalidateTeamViews();
  redirect(`${TEAM_PATH}?updated=member_transferred`);
}

export async function setTeamUplineAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const teamId = text(formData, "teamId");
  const downlineMembershipId = text(formData, "downlineMembershipId");
  const uplineMembershipId = text(formData, "uplineMembershipId") || null;
  if (!teamId || !downlineMembershipId) redirectError("relationship_invalid");

  let changed = false;
  try {
    changed = await runSerializable(async (tx) => {
      const memberships = await tx.teamMembership.findMany({
        where: { vendorId: auth.vendor.id, teamId, status: "ACTIVE", leftAt: null },
        select: { id: true },
      });
      const validMembershipIds = new Set(memberships.map((membership) => membership.id));
      if (!validMembershipIds.has(downlineMembershipId)) throw new TeamManagementError("membership_invalid");
      if (uplineMembershipId && !validMembershipIds.has(uplineMembershipId)) throw new TeamManagementError("upline_invalid");
      if (uplineMembershipId === downlineMembershipId) throw new TeamManagementError("self_upline");

      const activeRelationships = await tx.teamMembershipRelationship.findMany({
        where: { teamId, endedAt: null },
        select: { id: true, uplineMembershipId: true, downlineMembershipId: true },
      });
      const parentByDownline = new Map<string, string>();
      for (const relationship of activeRelationships) {
        if (parentByDownline.has(relationship.downlineMembershipId)) {
          throw new TeamManagementError("relationship_conflict");
        }
        parentByDownline.set(relationship.downlineMembershipId, relationship.uplineMembershipId);
      }

      const currentUpline = parentByDownline.get(downlineMembershipId) ?? null;
      if (currentUpline === uplineMembershipId) return false;

      if (uplineMembershipId) {
        const visited = new Set<string>();
        let cursor: string | null = uplineMembershipId;
        while (cursor) {
          if (cursor === downlineMembershipId) throw new TeamManagementError("upline_cycle");
          if (visited.has(cursor)) throw new TeamManagementError("relationship_conflict");
          visited.add(cursor);
          cursor = parentByDownline.get(cursor) ?? null;
        }
      }

      const now = new Date();
      await tx.teamMembershipRelationship.updateMany({
        where: { teamId, downlineMembershipId, endedAt: null },
        data: { endedAt: now },
      });
      if (uplineMembershipId) {
        await tx.teamMembershipRelationship.create({
          data: { teamId, uplineMembershipId, downlineMembershipId, effectiveAt: now },
        });
      }
      return true;
    });
  } catch (error) {
    if (error instanceof TeamManagementError) redirectError(error.code);
    if (isSerializableConflict(error)) redirectError("relationship_conflict");
    if (isPrismaConflict(error)) redirectError("relationship_invalid");
    throw error;
  }

  if (changed) {
    await writeAuditLog({
      vendorId: auth.vendor.id,
      actorId: auth.user.id,
      actorLabel: auth.member.role,
      action: uplineMembershipId ? "set_team_upline" : "remove_team_upline",
      targetType: "TeamMembership",
      targetId: downlineMembershipId,
      after: auditSnapshot({ teamId, downlineMembershipId, uplineMembershipId }),
    });
  }
  revalidateTeamViews();
  redirect(`${TEAM_PATH}?updated=relationship_saved`);
}

export async function deactivateTeamMembershipAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const auth = await requireVendorOwner();
  const teamId = text(formData, "teamId");
  const membershipId = text(formData, "membershipId");
  if (!teamId || !membershipId) redirectError("membership_invalid");

  let deactivated;
  try {
    deactivated = await runSerializable(async (tx) => {
      const membership = await tx.teamMembership.findFirst({
        where: {
          id: membershipId,
          vendorId: auth.vendor.id,
          teamId,
          status: "ACTIVE",
          leftAt: null,
        },
        select: { id: true, vendorMemberId: true },
      });
      if (!membership) throw new TeamManagementError("membership_invalid");
      if (membership.vendorMemberId === auth.member.id) throw new TeamManagementError("self_membership");

      const now = new Date();
      await tx.teamMembershipRelationship.updateMany({
        where: {
          teamId,
          endedAt: null,
          OR: [{ uplineMembershipId: membershipId }, { downlineMembershipId: membershipId }],
        },
        data: { endedAt: now },
      });
      return tx.teamMembership.update({
        where: { id: membershipId },
        data: { status: "INACTIVE", leftAt: now },
      });
    });
  } catch (error) {
    if (error instanceof TeamManagementError) redirectError(error.code);
    if (isPrismaConflict(error)) redirectError("membership_invalid");
    throw error;
  }

  await writeAuditLog({
    vendorId: auth.vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member.role,
    action: "deactivate_team_membership",
    targetType: "TeamMembership",
    targetId: deactivated.id,
    after: auditSnapshot({ id: deactivated.id, teamId, status: deactivated.status, leftAt: deactivated.leftAt }),
  });
  revalidateTeamViews();
  redirect(`${TEAM_PATH}?updated=member_deactivated`);
}
