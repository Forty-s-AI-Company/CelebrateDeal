import { getDb } from "@/lib/db";

const OWNER_INVITATION_STEP_UP_MS = 10 * 60 * 1000;

export function canInviteWorkspaceOwner(input: {
  hasMfaFactor: boolean;
  mfaVerifiedAt: Date | null;
  now?: Date;
}) {
  if (!input.hasMfaFactor || !input.mfaVerifiedAt) return false;
  const age = (input.now ?? new Date()).getTime() - input.mfaVerifiedAt.getTime();
  return age >= 0 && age <= OWNER_INVITATION_STEP_UP_MS;
}

export async function switchCurrentWorkspace(input: {
  sessionId: string;
  userId: string;
  vendorId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  // Keep membership authorization in the final update predicate so a caller
  // cannot switch by supplying a vendor ID observed outside their own tenant.
  const updated = await getDb().userSession.updateMany({
    where: {
      id: input.sessionId,
      userId: input.userId,
      revokedAt: null,
      expiresAt: { gt: now },
      user: {
        memberships: {
          some: {
            vendorId: input.vendorId,
            status: "active",
          },
        },
      },
    },
    data: { vendorId: input.vendorId },
  });

  return updated.count === 1;
}

export async function deactivateWorkspaceMember(input: {
  vendorId: string;
  actorUserId: string;
  targetMemberId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  return getDb().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`workspace-owner:${input.vendorId}`}, 0))`;
    const [actor, target] = await Promise.all([
      tx.vendorMember.findUnique({ where: { vendorId_userId: { vendorId: input.vendorId, userId: input.actorUserId } } }),
      tx.vendorMember.findFirst({ where: { id: input.targetMemberId, vendorId: input.vendorId }, include: { user: true } }),
    ]);
    if (!actor || actor.status !== "active" || actor.role !== "owner") return { ok: false as const, reason: "owner_required" as const };
    if (!target || target.status !== "active" || target.user.platformRole !== "none") return { ok: false as const, reason: "member_not_found" as const };
    if (target.userId === input.actorUserId) return { ok: false as const, reason: "self_deactivate" as const };
    if (target.role === "owner") {
      const ownerCount = await tx.vendorMember.count({
        where: { vendorId: input.vendorId, role: "owner", status: "active" },
      });
      if (ownerCount <= 1) return { ok: false as const, reason: "last_owner" as const };
    }

    const member = await tx.vendorMember.update({
      where: { id: target.id },
      data: { status: "inactive", deactivatedAt: now },
    });
    await tx.userSession.updateMany({
      where: { userId: target.userId, vendorId: input.vendorId, revokedAt: null },
      data: { revokedAt: now },
    });
    return { ok: true as const, before: target, member };
  });
}
