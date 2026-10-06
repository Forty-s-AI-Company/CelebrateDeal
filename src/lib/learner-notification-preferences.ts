import { Prisma, type PrismaClient } from "@prisma/client";
import { getStudentCourse, type CourseLearningStore } from "./student-course-learning";
import type { StudentPortalScope } from "./student-portal";
import { LearnerNotificationConsentInput, LearnerNotificationScope } from "./learner-notification-contract";

export type NotificationPreferenceDatabase = CourseLearningStore & Pick<PrismaClient, "$transaction" | "learnerNotificationPreference">;
const publicFields = { channel: true, enabled: true, revision: true, destinationVerifiedAt: true } as const;

/** Return consent state only; encrypted contacts and private indexes never reach the browser. */
export async function listLearnerNotificationPreferences(db: NotificationPreferenceDatabase, session: StudentPortalScope, productId: string) {
  const scope = LearnerNotificationScope.parse({ vendorId: session.vendorId, customerKeyHash: session.customerKeyHash, productId });
  if (!await getStudentCourse(db, session, productId)) return null;
  return db.learnerNotificationPreference.findMany({ where: scope, select: publicFields, orderBy: { channel: "asc" } });
}

/** Serializable entitlement and consent CAS prevent stale opt-ins. Unsubscribe
 * remains available after refund, but can only change this authenticated recipient's row. */
export async function saveLearnerNotificationConsent(db: NotificationPreferenceDatabase, session: StudentPortalScope, productId: string, raw: unknown) {
  const scope = LearnerNotificationScope.parse({ vendorId: session.vendorId, customerKeyHash: session.customerKeyHash, productId });
  const input = LearnerNotificationConsentInput.parse(raw);
  const persist = () => db.$transaction(async tx => {
    const identity = { ...scope, channel: input.channel };
    const existing = await tx.learnerNotificationPreference.findFirst({ where: identity });
    if (input.enabled && !await getStudentCourse(tx, session, productId)) return { status: "not_found" } as const;
    if (!existing) {
      if (input.expectedRevision !== 0) return { status: "conflict" } as const;
      if (input.enabled) return { status: "verification_required" } as const;
      // No new rows for revoked/foreign products, while existing opt-outs remain writable.
      if (!await getStudentCourse(tx, session, productId)) return { status: "not_found" } as const;
      const preference = await tx.learnerNotificationPreference.create({ data: identity, select: publicFields });
      return { status: "saved", preference } as const;
    }
    if (existing.revision !== input.expectedRevision) return { status: "conflict" } as const;
    if (input.enabled && (!existing.destinationVerifiedAt || !existing.destinationEncryptedEnvelope || !existing.destinationKeyHash)) return { status: "verification_required" } as const;
    const updated = await tx.learnerNotificationPreference.updateMany({ where: { ...identity, revision: input.expectedRevision },
      data: { enabled: input.enabled, revision: { increment: 1 }, consentedAt: input.enabled ? new Date() : existing.consentedAt } });
    if (updated.count !== 1) return { status: "conflict" } as const;
    return { status: "saved", preference: await tx.learnerNotificationPreference.findFirstOrThrow({ where: identity, select: publicFields }) } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await persist(); }
    catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code) || attempt === 2) throw error;
    }
  }
  throw new Error("Notification consent transaction failed.");
}
