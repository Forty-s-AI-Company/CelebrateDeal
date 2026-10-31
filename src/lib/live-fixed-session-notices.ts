import { getCanonicalAppUrl } from "@/lib/app-url";
import { getDb } from "@/lib/db";
import { ensureFixedSessionCancelledDelivery } from "@/lib/email-delivery";
import { createLiveViewerUrl } from "@/lib/live-public-url";
import { loadPublicLandingPage } from "@/lib/landing-page-service";
import { loadPublicRegistrationForm } from "@/lib/public-registration-form";
import { captureOperationalError } from "@/lib/monitoring";

/**
 * Cancellation notices for 指定場次. When the studio cancels a session that
 * has registrations, every VERIFIED registrant of that cancellation gets one
 * Email (「你報名的場次已取消，請重新選擇場次」) with a link to choose again.
 *
 * Durable and idempotent: a cancelled session keeps
 * `cancellationNoticesQueuedAt` null until all its registrants have a row
 * (stable id per registration + cancellation). The studio queues them right
 * after its commit; the scheduled email job finishes whatever is left. A
 * session reopened before that is skipped.
 */

const NOTICE_PAGE = 200;

type CancelledSession = {
  id: string;
  vendorId: string;
  liveId: string;
  startAt: Date;
  cancelledAt: Date | null;
};

/**
 * Where a registrant can pick another session: a published landing page
 * bound to this Live, else the Live's registration form page, else the
 * public viewer page. Tenant-bound. A candidate is only linked when the same
 * public loader the visitor will hit (loadPublicLandingPage /
 * loadPublicRegistrationForm, including the published-project gate) serves
 * it with this Live, so the link never lands on a 404.
 */
export async function resolveFixedSessionRechooseUrl(input: { vendorId: string; liveId: string; slug: string; formId: string | null }) {
  const db = getDb();
  const pages = await db.landingPage.findMany({
    where: {
      vendorId: input.vendorId,
      status: "published",
      publishedAt: { not: null },
      archivedAt: null,
      publishedVersion: { is: { vendorId: input.vendorId, liveId: input.liveId } },
    },
    orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    take: 3,
    select: { slug: true },
  });
  for (const page of pages) {
    const served = await loadPublicLandingPage(page.slug);
    if (served?.submissionLiveId === input.liveId) return new URL(`/lp/${encodeURIComponent(page.slug)}`, getCanonicalAppUrl()).toString();
  }
  const form = input.formId
    ? await db.registrationForm.findFirst({ where: { id: input.formId, vendorId: input.vendorId, isActive: true }, select: { slug: true } })
    : null;
  if (form) {
    const served = await loadPublicRegistrationForm(form.slug);
    if (served?.sessions.some((session) => session.id === input.liveId)) {
      return new URL(`/form/${encodeURIComponent(form.slug)}`, getCanonicalAppUrl()).toString();
    }
  }
  return createLiveViewerUrl(input.slug);
}

async function queueNoticesForSession(session: CancelledSession, now: Date) {
  const db = getDb();
  if (!session.cancelledAt) return [];
  const live = await db.live.findFirst({
    where: { id: session.liveId, vendorId: session.vendorId },
    select: {
      id: true,
      slug: true,
      title: true,
      formId: true,
      vendor: { select: { name: true, senderName: true, supportEmail: true, contactUrl: true } },
    },
  });
  if (!live) return [];
  const rechooseUrl = await resolveFixedSessionRechooseUrl({ vendorId: session.vendorId, liveId: live.id, slug: live.slug, formId: live.formId });
  const queued: string[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page: Array<{ id: string; name: string; email: string }> = await db.formSubmission.findMany({
      where: {
        liveId: live.id,
        liveSessionId: session.id,
        verificationStatus: "VERIFIED",
        form: { vendorId: session.vendorId },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: NOTICE_PAGE,
      select: { id: true, name: true, email: true },
    });
    for (const submission of page) {
      const result = await ensureFixedSessionCancelledDelivery({
        vendorId: session.vendorId,
        vendorName: live.vendor.name,
        liveId: live.id,
        liveTitle: live.title,
        sessionId: session.id,
        sessionStartAt: session.startAt,
        cancelledAt: session.cancelledAt,
        formSubmissionId: submission.id,
        recipientName: submission.name,
        recipientEmail: submission.email,
        rechooseUrl,
        emailBrand: { senderName: live.vendor.senderName, supportEmail: live.vendor.supportEmail, contactUrl: live.vendor.contactUrl },
      });
      if (result.status === "queued") queued.push(result.deliveryId);
    }
    if (page.length < NOTICE_PAGE) break;
    cursor = page[page.length - 1]!.id;
  }
  // Only this cancellation is marked; a reopen or a new cancellation changed cancelledAt.
  await db.liveSession.updateMany({
    where: { id: session.id, vendorId: session.vendorId, liveId: session.liveId, status: "cancelled", cancelledAt: session.cancelledAt, cancellationNoticesQueuedAt: null },
    data: { cancellationNoticesQueuedAt: now },
  });
  return queued;
}

/**
 * Queues the notices of cancelled sessions that still need them, oldest
 * cancellation first. `vendorId` + `liveId` narrow it to one studio save.
 * Returns the ids of newly queued rows (for immediate dispatch).
 */
export async function queueFixedSessionCancellationNotices(input: {
  vendorId?: string;
  liveId?: string;
  limit?: number;
  now?: Date;
} = {}) {
  if (input.liveId && !input.vendorId) return [];
  const now = input.now ?? new Date();
  const sessions = await getDb().liveSession.findMany({
    where: {
      ...(input.vendorId ? { vendorId: input.vendorId } : {}),
      ...(input.liveId ? { liveId: input.liveId } : {}),
      status: "cancelled",
      cancellationNoticesQueuedAt: null,
    },
    orderBy: [{ cancelledAt: "asc" }, { id: "asc" }],
    take: Math.max(1, Math.min(20, input.limit ?? 5)),
    select: { id: true, vendorId: true, liveId: true, startAt: true, cancelledAt: true },
  });
  const queued: string[] = [];
  for (const session of sessions) {
    try {
      queued.push(...await queueNoticesForSession(session, now));
    } catch (error) {
      try {
        captureOperationalError(error, { source: "fixed_session", operation: "cancellation_notice", status: "failed" });
      } catch {
        // The next job run retries this session.
      }
    }
  }
  return queued;
}

/**
 * A registrant who confirms their email after their session was cancelled
 * gets the cancellation notice instead of a confirmation. It uses the same
 * identity (registration + session + cancellation) as the studio and job
 * notices, so a registrant never receives it twice. Returns the delivery to
 * send now (if newly queued) and the page where they can choose again.
 */
export async function queueCancelledSessionNoticeOnVerification(input: {
  vendorId: string;
  vendorName: string;
  liveId: string;
  liveSlug: string;
  liveTitle: string;
  liveFormId: string | null;
  session: { id: string; startAt: Date; cancelledAt: Date | null };
  formSubmissionId: string;
  recipientName: string;
  recipientEmail: string;
  emailBrand?: { senderName: string | null; supportEmail: string | null; contactUrl: string | null };
}) {
  const rechooseUrl = await resolveFixedSessionRechooseUrl({ vendorId: input.vendorId, liveId: input.liveId, slug: input.liveSlug, formId: input.liveFormId });
  if (!input.session.cancelledAt) return { deliveryId: null, rechooseUrl };
  const result = await ensureFixedSessionCancelledDelivery({
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    liveId: input.liveId,
    liveTitle: input.liveTitle,
    sessionId: input.session.id,
    sessionStartAt: input.session.startAt,
    cancelledAt: input.session.cancelledAt,
    formSubmissionId: input.formSubmissionId,
    recipientName: input.recipientName,
    recipientEmail: input.recipientEmail,
    rechooseUrl,
    emailBrand: input.emailBrand,
  });
  return { deliveryId: result.status === "queued" ? result.deliveryId : null, rechooseUrl };
}