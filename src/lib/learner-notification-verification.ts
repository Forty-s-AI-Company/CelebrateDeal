import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { getStudentCourse, type CourseLearningStore } from "./student-course-learning";
import type { StudentPortalScope } from "./student-portal";
import { LearnerEmailDestination, LearnerPhoneDestination, LearnerPushDestination, LearnerNotificationScope, protectLearnerNotificationDestination } from "./learner-notification-contract";

const Enrollment = z.discriminatedUnion("channel", [
 z.object({ channel: z.literal("push"), destination: LearnerPushDestination, expectedRevision: z.number().int().safe().nonnegative() }).strict(),
 z.object({ channel: z.literal("email"), destination: LearnerEmailDestination, expectedRevision: z.number().int().safe().nonnegative() }).strict(),
 z.object({ channel: z.literal("sms"), destination: LearnerPhoneDestination, expectedRevision: z.number().int().safe().nonnegative() }).strict(),
 z.object({ channel: z.literal("whatsapp"), destination: LearnerPhoneDestination, expectedRevision: z.number().int().safe().nonnegative() }).strict(),
]);
type Database = CourseLearningStore & Pick<PrismaClient,"$transaction">;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const LearnerContactVerificationInput = z.object({ challengeId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict();
async function verificationTransaction<T>(db: Database, run: (tx: Prisma.TransactionClient) => Promise<T>) {
 for (let attempt = 0; attempt < 3; attempt++) {
  try { return await db.$transaction(run,{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
  catch (error) {
   if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002","P2034"].includes(error.code) || attempt === 2) throw error;
  }
 }
 throw new Error("Verification transaction failed.");
}
const publicFields = { id: true, channel: true, enabled: true, revision: true, destinationVerifiedAt: true } as const;

/** Internal only: return the token to the verified delivery adapter, never to the
 * requesting browser. Merely requesting a challenge cannot verify a destination. */
export async function requestLearnerContactVerification(db: Database, session: StudentPortalScope, productId: string, raw: unknown) {
 const scope = LearnerNotificationScope.parse({ vendorId: session.vendorId, customerKeyHash: session.customerKeyHash, productId });
 const input = Enrollment.parse(raw), token = randomBytes(32).toString("base64url");
 const destination = protectLearnerNotificationDestination(scope,input.channel,input.destination);
 return verificationTransaction(db,async tx => {
  if (!await getStudentCourse(tx,session,productId)) return { status: "not_found" } as const;
  const identity = { ...scope, channel: input.channel };
  const existing = await tx.learnerNotificationPreference.findFirst({ where: identity });
  if ((existing?.revision ?? 0) !== input.expectedRevision) return { status: "conflict" } as const;
  // The new contact invalidates all pending old challenges and previous dispatch consent.
  const preference = existing ? await tx.learnerNotificationPreference.update({ where: { id: existing.id },
   data: { enabled: false, destinationVerifiedAt: null, destinationEncryptedEnvelope: null, destinationKeyHash: null, revision: { increment: 1 } }, select: publicFields })
   : await tx.learnerNotificationPreference.create({ data: identity, select: publicFields });
  const challenge = await tx.learnerNotificationVerification.create({ data: { vendorId: scope.vendorId, productId, preferenceId: preference.id,
   consentRevision: preference.revision, tokenHash: hashToken(token), destinationEncryptedEnvelope: destination.encryptedEnvelope,
   destinationKeyHash: destination.destinationKeyHash, expiresAt: new Date(Date.now()+15*60*1000) }, select: { id: true, expiresAt: true } });
  return { status: "challenge_created", challenge, preference, delivery: { channel: input.channel, destination: input.destination, token } } as const;
 });
}

/** Exact challenge/session binding, a five-attempt limit and atomic consumption.
 * Destination proof never substitutes for current purchase rights or channel consent. */
export async function consumeLearnerContactVerification(db: Database, session: StudentPortalScope, productId: string, raw: unknown) {
 const input = LearnerContactVerificationInput.parse(raw);
 const scope = LearnerNotificationScope.parse({ vendorId: session.vendorId, customerKeyHash: session.customerKeyHash, productId });
 return verificationTransaction(db,async tx => {
  if (!await getStudentCourse(tx,session,productId)) return { status: "not_found" } as const;
  const challenge = await tx.learnerNotificationVerification.findFirst({ where: { id: input.challengeId, vendorId: scope.vendorId, productId,
   consumedAt: null, attemptCount: { lt: 5 }, expiresAt: { gt: new Date() }, preference: { is: { ...scope } } } });
  if (!challenge) return { status: "invalid_challenge" } as const;
  const preference = await tx.learnerNotificationPreference.findFirst({ where: { ...scope, id: challenge.preferenceId, revision: challenge.consentRevision } });
  if (!preference) return { status: "invalid_challenge" } as const;
  const matching = timingSafeEqual(Buffer.from(hashToken(input.token),"hex"),Buffer.from(challenge.tokenHash,"hex"));
  // Bound the compare-and-swap to the observed attempt count even for an invalid token.
  const consumed = await tx.learnerNotificationVerification.updateMany({ where: { id: challenge.id, vendorId: scope.vendorId, consumedAt: null,
   expiresAt: { gt: new Date() }, attemptCount: challenge.attemptCount }, data: { attemptCount: { increment: 1 }, consumedAt: matching || challenge.attemptCount === 4 ? new Date() : null } });
  if (consumed.count !== 1 || !matching) return { status: "invalid_challenge" } as const;
  const updated = await tx.learnerNotificationPreference.updateMany({ where: { ...scope, id: preference.id, revision: challenge.consentRevision },
   data: { enabled: false, destinationVerifiedAt: new Date(), destinationEncryptedEnvelope: challenge.destinationEncryptedEnvelope,
    destinationKeyHash: challenge.destinationKeyHash, revision: { increment: 1 } } });
  if (updated.count !== 1) throw new Error("Verification consent conflict.");
  return { status: "verified", preference: await tx.learnerNotificationPreference.findFirstOrThrow({ where: { ...scope, id: preference.id }, select: publicFields }) } as const;
 });
}
