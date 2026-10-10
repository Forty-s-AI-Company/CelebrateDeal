import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { LearnerNotificationScope } from "./learner-notification-contract";
import type { NotificationPreferenceDatabase } from "./learner-notification-preferences";
import { recordLearnerNotificationSourceEvent } from "./learner-notification-source-events";
import { hasLearnerNotificationPurchase } from "./learner-notification-access";
import type { StudentPortalScope } from "./student-portal";

type Database = NotificationPreferenceDatabase & Pick<PrismaClient, "consultationBooking" | "learnerNotificationSourceEvent">;
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
export const LearnerConsultationReminderInput = z.object({ bookingId: identifier, expectedStartTime: z.string().datetime() }).strict();
const identity = (bookingId: string, productId: string, startTime: Date) => createHash("sha256").update(JSON.stringify([bookingId, productId, startTime.toISOString()])).digest("hex");

/** Public reservations do not prove who supplied an email. Only an authenticated
 * recipient's explicit confirmation can publish a personal reminder source. */
export async function listLearnerConsultationReminders(db: Database, session: StudentPortalScope, productId: string, after?: string) {
  const scope = LearnerNotificationScope.parse({ vendorId: session.vendorId, customerKeyHash: session.customerKeyHash, productId });
  if (after) identifier.parse(after);
  if (!await hasLearnerNotificationPurchase(db, session, productId)) return null;
  const rows = await db.consultationBooking.findMany({
    where: { vendorId: scope.vendorId, customerKeyHash: scope.customerKeyHash, status: "scheduled", startTime: { gt: new Date() }, ...(after ? { id: { gt: after } } : {}),
      event: { is: { vendorId: scope.vendorId, isActive: true, salesProject: { is: { vendorId: scope.vendorId, status: "published", publishedAt: { not: null }, products: { some: { vendorId: scope.vendorId, productId } } } } } } },
    orderBy: { id: "asc" }, take: 21, select: { id: true, startTime: true, event: { select: { title: true } } },
  });
  const visible = rows.slice(0, 20);
  const sources = await db.learnerNotificationSourceEvent.findMany({ where: { vendorId: scope.vendorId, productId, event: "consultation_reminder", audienceCustomerKeyHash: scope.customerKeyHash, eventIdentity: { in: visible.map(row => identity(row.id, productId, row.startTime)) } }, select: { eventIdentity: true }, take: 20 });
  const confirmed = new Set(sources.map(row => row.eventIdentity));
  return { bookings: visible.map(row => ({ id: row.id, startTime: row.startTime.toISOString(), title: row.event.title, confirmed: confirmed.has(identity(row.id, productId, row.startTime)) })), nextAfter: rows.length > 20 ? visible.at(-1)!.id : null };
}

/** Confirmation, current purchase, exact booking revision and source commit
 * together. Repeated confirmation upserts the same source, never another buyer. */
export async function confirmLearnerConsultationReminder(db: Database, session: StudentPortalScope, productId: string, raw: unknown) {
  const scope = LearnerNotificationScope.parse({ vendorId: session.vendorId, customerKeyHash: session.customerKeyHash, productId });
  const input = LearnerConsultationReminderInput.parse(raw);
  const persist = () => db.$transaction(async tx => {
    if (!await hasLearnerNotificationPurchase(tx, session, productId)) return { status: "not_found" } as const;
    const now = new Date();
    const booking = await tx.consultationBooking.findFirst({
      where: { vendorId: scope.vendorId, customerKeyHash: scope.customerKeyHash, id: input.bookingId, status: "scheduled", startTime: { equals: new Date(input.expectedStartTime), gt: now },
        event: { is: { vendorId: scope.vendorId, isActive: true, salesProject: { is: { vendorId: scope.vendorId, status: "published", publishedAt: { not: null }, products: { some: { vendorId: scope.vendorId, productId } } } } } } },
      select: { id: true, startTime: true, event: { select: { title: true } } },
    });
    if (!booking) return { status: "not_found" } as const;
    const preference = await tx.learnerNotificationPreference.findFirst({ where: { ...scope, enabled: true, destinationVerifiedAt: { not: null }, destinationEncryptedEnvelope: { not: null }, destinationKeyHash: { not: null }, consentedAt: { lte: now } }, select: { id: true } });
    if (!preference) return { status: "verification_required" } as const;
    const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: scope.vendorId }, select: { slug: true } });
    const source = await recordLearnerNotificationSourceEvent(tx, {
      vendorId: scope.vendorId, productId, event: "consultation_reminder", eventIdentity: identity(booking.id, productId, booking.startTime), audienceCustomerKeyHash: scope.customerKeyHash,
      occurredAt: now, availableAt: new Date(Math.max(now.getTime(), booking.startTime.getTime() - 60 * 60 * 1000)),
      message: { title: "預約即將開始", body: booking.event.title, path: `/portal/${encodeURIComponent(vendor.slug)}/notifications`,
        consultationBooking: { id: booking.id, startTime: booking.startTime.toISOString(), customerKeyHash: scope.customerKeyHash, confirmedAt: now.toISOString() } },
    });
    const persisted = await tx.learnerNotificationSourceEvent.findFirstOrThrow({ where: { vendorId: scope.vendorId, id: source.id }, select: { availableAt: true } });
    return { status: "scheduled", availableAt: persisted.availableAt.toISOString() } as const;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await persist(); }
    catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !["P2002", "P2034"].includes(error.code) || attempt === 2) throw error; }
  }
  throw new Error("Consultation reminder confirmation failed.");
}
