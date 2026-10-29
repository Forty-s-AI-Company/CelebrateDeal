import type { Prisma } from "@prisma/client";

/**
 * Ends the account's LINE Login identities (`subjectType: "user"`) in every
 * workspace and consumes its unfinished LINE login/link states, so a state
 * started before (e.g. by whoever took over) cannot re-link afterwards
 * (`completeLineLogin` consumes only rows whose `consumedAt` is NULL).
 */
export async function revokeUserLineAccess(tx: Pick<Prisma.TransactionClient, "lineUserIdentity" | "lineLoginState">, userId: string, now: Date) {
  const identities = await tx.lineUserIdentity.updateMany({
    where: { subjectType: "user", subjectId: userId, revokedAt: null },
    data: { revokedAt: now },
  });
  const states = await tx.lineLoginState.updateMany({
    where: { subjectType: "user", subjectId: userId, consumedAt: null },
    data: { consumedAt: now },
  });
  return { identities: identities.count, states: states.count };
}
