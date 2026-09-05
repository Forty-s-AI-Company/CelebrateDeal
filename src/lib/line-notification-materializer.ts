import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { createLiveViewerUrl } from "@/lib/live-public-url";
import {
  buildCommissionLineMessage,
  buildLiveLineMessage,
  buildOrderLineMessage,
  enqueueLineNotification,
  stableLineIdempotencyKey,
} from "@/lib/line-notification";

const MATERIALIZE_LIMIT = 100;

function formatStart(value: Date) {
  return new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Taipei",
  }).format(value);
}

/**
 * Converts current domain facts into LINE outbox rows. Every event key is stable,
 * so cron retries and webhook overlap converge instead of double-pushing.
 */
export async function materializeLineNotifications(now = new Date()) {
  const db = getDb();
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
          live: { select: { id: true, slug: true, title: true, status: true, scheduledAt: true, startedAt: true, endedAt: true } },
        },
      });
      const live = submission?.live;
      if (!live) {
        await db.lineUserIdentity.update({ where: { id: identity.id }, data: { lastMaterializedAt: now } });
        continue;
      }
      const viewerUrl = createLiveViewerUrl(live.slug);
      const reminderAt = new Date(live.scheduledAt.getTime() - 60 * 60_000);
      if (live.status === "scheduled" && !live.startedAt && now >= reminderAt && now < live.scheduledAt) {
        results.push(await enqueueLineNotification(db, {
          vendorId: identity.vendorId,
          subjectType: "buyer_registration",
          subjectId: identity.subjectId,
          trigger: "live_reminder",
          idempotencyKey: stableLineIdempotencyKey(["live_reminder", live.id, identity.subjectId, live.scheduledAt]),
          messages: [buildLiveLineMessage({ kind: "reminder", liveTitle: live.title, startsAtText: formatStart(live.scheduledAt), viewerUrl })],
        }));
      }
      if (live.status === "live" && live.startedAt && !live.endedAt) {
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
      select: { id: true, commissionAmountCents: true, currency: true, orderNumber: true, createdAt: true },
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
          currency: commission.currency,
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
