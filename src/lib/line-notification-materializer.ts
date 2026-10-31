import { getCanonicalAppUrl } from "@/lib/app-url";
import type { PrismaClient } from "@prisma/client";
import { getDb } from "@/lib/db";
import { createLiveViewerUrl } from "@/lib/live-public-url";
import { EVERGREEN_ACTIVATION_SELECT, isActiveEvergreenLive } from "@/lib/evergreen-activation";
import {
  buildCommissionLineMessage,
  buildLiveLineMessage,
  buildOrderLineMessage,
  enqueueLineNotification,
  stableLineIdempotencyKey,
} from "@/lib/line-notification";

const MATERIALIZE_LIMIT = 100;
type LineMaterializationDatabase = Pick<PrismaClient,
  | "lineOfficialAccount"
  | "lineUserIdentity"
  | "lineDelivery"
  | "formSubmission"
  | "commerceOrder"
  | "affiliateCommission"
>;

function formatStart(value: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(value);
}

/** The registrant's own start: the shared scheduledAt, or a fixed-session Live's chosen session. */
function registrantStartAt(
  live: { id: string; vendorId: string; scheduledAt: Date; sessionMode?: string | null },
  session: { vendorId: string; liveId: string; startAt: Date; status: string } | null,
) {
  if (live.sessionMode !== "fixed_sessions") return live.scheduledAt;
  if (!session || session.vendorId !== live.vendorId || session.liveId !== live.id || session.status === "cancelled") return null;
  return session.startAt;
}

/**
 * Converts current domain facts into LINE outbox rows. Every event key is stable,
 * so cron retries and webhook overlap converge instead of double-pushing.
 */
export function materializeLineNotifications(now?: Date): Promise<Array<{ status: string }>>;
export function materializeLineNotifications(
  db: LineMaterializationDatabase,
  now?: Date,
): Promise<Array<{ status: string }>>;
export async function materializeLineNotifications(
  dbOrNow: LineMaterializationDatabase | Date = getDb(),
  requestedNow = new Date(),
) {
  // Keep the date-only call shape for existing jobs while allowing a cron
  // invocation to use one explicit database handle for its whole run.
  const db = dbOrNow instanceof Date ? getDb() : dbOrNow;
  const now = dbOrNow instanceof Date ? dbOrNow : requestedNow;
  const identities = await db.lineUserIdentity.findMany({
    where: { revokedAt: null, subjectType: { in: ["buyer_registration", "buyer_order", "promoter"] } },
    orderBy: [{ lastMaterializedAt: "asc" }, { id: "asc" }],
    take: MATERIALIZE_LIMIT,
    select: { id: true, vendorId: true, subjectType: true, subjectId: true, materializationCursor: true },
  });
  const results: Array<{ status: string }> = [];

  for (const identity of identities) {
    if (identity.subjectType === "buyer_registration") {
      const submission = await db.formSubmission.findFirst({
        where: {
          id: identity.subjectId,
          verificationStatus: "VERIFIED",
          form: { vendorId: identity.vendorId },
        },
        select: {
          id: true,
          live: {
            select: {
              ...EVERGREEN_ACTIVATION_SELECT,
              id: true, vendorId: true, slug: true, title: true, scheduledAt: true, startedAt: true, endedAt: true,
              video: { select: { durationSec: true } },
            },
          },
          liveSession: { select: { vendorId: true, liveId: true, startAt: true, status: true } },
        },
      });
      const live = submission?.live;
      if (!live) {
        await db.lineUserIdentity.update({ where: { id: identity.id }, data: { lastMaterializedAt: now } });
        continue;
      }
      // An evergreen Live has no shared start: each visitor gets their own
      // session, so fixed-time reminders from scheduledAt would be wrong.
      if (isActiveEvergreenLive(live, { now })) {
        await db.lineUserIdentity.update({ where: { id: identity.id }, data: { lastMaterializedAt: now } });
        continue;
      }
      const viewerUrl = createLiveViewerUrl(live.slug);
      // A fixed-session registrant (指定場次) is reminded before their own
      // session; a cancelled session (or none) gets no reminder.
      const startAt = registrantStartAt(live, submission.liveSession);
      if (startAt && live.status === "scheduled" && !live.startedAt && now.getTime() >= startAt.getTime() - 60 * 60_000 && now < startAt) {
        results.push(await enqueueLineNotification(db, {
          vendorId: identity.vendorId,
          subjectType: "buyer_registration",
          subjectId: identity.subjectId,
          trigger: "live_reminder",
          idempotencyKey: stableLineIdempotencyKey(["live_reminder", live.id, identity.subjectId, startAt]),
          messages: [buildLiveLineMessage({ kind: "reminder", liveTitle: live.title, startsAtText: formatStart(startAt), viewerUrl })],
        }));
      }
      if (live.status === "live" && live.startedAt && !live.endedAt && live.sessionMode !== "fixed_sessions") {
        results.push(await enqueueLineNotification(db, {
          vendorId: identity.vendorId,
          subjectType: "buyer_registration",
          subjectId: identity.subjectId,
          trigger: "live_started",
          idempotencyKey: stableLineIdempotencyKey(["live_started", live.id, identity.subjectId, live.startedAt]),
          messages: [buildLiveLineMessage({ kind: "started", liveTitle: live.title, startsAtText: formatStart(live.startedAt), viewerUrl })],
        }));
      }
      await db.lineUserIdentity.update({ where: { id: identity.id }, data: { lastMaterializedAt: now } });
      continue;
    }

    if (identity.subjectType === "buyer_order") {
      const order = await db.commerceOrder.findFirst({
        where: { id: identity.subjectId, vendorId: identity.vendorId },
        select: { id: true, orderNumber: true, totalAmountCents: true, currency: true, status: true, paidAt: true, createdAt: true },
      });
      if (!order) {
        await db.lineUserIdentity.update({ where: { id: identity.id }, data: { lastMaterializedAt: now } });
        continue;
      }
      const orderUrl = `${getCanonicalAppUrl()}/support/orders`;
      results.push(await enqueueLineNotification(db, {
        vendorId: identity.vendorId,
        subjectType: "buyer_order",
        subjectId: order.id,
        trigger: "order_created",
        idempotencyKey: stableLineIdempotencyKey(["order_created", order.id, order.createdAt]),
        messages: [buildOrderLineMessage({ kind: "created", orderNumber: order.orderNumber, amountCents: order.totalAmountCents, currency: order.currency, orderUrl })],
      }));
      if (order.status === "paid" && order.paidAt) {
        results.push(await enqueueLineNotification(db, {
          vendorId: identity.vendorId,
          subjectType: "buyer_order",
          subjectId: order.id,
          trigger: "order_paid",
          idempotencyKey: stableLineIdempotencyKey(["order_paid", order.id, order.paidAt]),
          messages: [buildOrderLineMessage({ kind: "paid", orderNumber: order.orderNumber, amountCents: order.totalAmountCents, currency: order.currency, orderUrl })],
        }));
      }
      await db.lineUserIdentity.update({ where: { id: identity.id }, data: { lastMaterializedAt: now } });
      continue;
    }

    const commissions = await db.affiliateCommission.findMany({
      where: {
        vendorId: identity.vendorId,
        affiliateId: identity.subjectId,
        commissionAmountCents: { gt: 0 },
        status: { in: ["pending", "approved", "paid"] },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      ...(identity.materializationCursor ? { cursor: { id: identity.materializationCursor }, skip: 1 } : {}),
      take: 20,
      select: { id: true, commissionAmountCents: true, orderNumber: true, createdAt: true },
    });
    for (const commission of commissions) {
      results.push(await enqueueLineNotification(db, {
        vendorId: identity.vendorId,
        subjectType: "promoter",
        subjectId: identity.subjectId,
        trigger: "commission_credited",
        idempotencyKey: stableLineIdempotencyKey(["commission_credited", commission.id, commission.createdAt]),
        messages: [buildCommissionLineMessage({
          amountCents: commission.commissionAmountCents,
          currency: "TWD",
          orderNumber: commission.orderNumber,
        })],
      }));
    }
    await db.lineUserIdentity.update({
      where: { id: identity.id },
      data: {
        lastMaterializedAt: now,
        ...(commissions.at(-1)?.id ? { materializationCursor: commissions.at(-1)!.id } : {}),
      },
    });
  }
  return results;
}
