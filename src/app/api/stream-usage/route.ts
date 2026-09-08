import { NextResponse } from "next/server";
import { z } from "zod";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { automationCustomerKeyHash, dispatchAutomationEvent } from "@/lib/automation-workflow";
import { getDb } from "@/lib/db";
import { getActiveLiveViewerSession, liveViewerTokenFromRequest } from "@/lib/live-quota-admission";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  recordStreamUsageLedgerEntry,
  StreamUsageValidationError,
  STREAM_USAGE_MAX_HEARTBEAT_SECONDS,
} from "@/lib/stream-usage";

const StreamUsagePayload = z.object({
  vendorId: z.string().min(1).max(128),
  liveId: z.string().min(1).max(128),
  sourcePageSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i).max(160).nullable().optional(),
  liveShareCode: z.string().regex(/^tls1\.[A-Za-z0-9_-]{32,}$/u).max(160).nullable().optional(),
  eventId: z.string().uuid(),
  watchSeconds: z.number().int().min(1).max(STREAM_USAGE_MAX_HEARTBEAT_SECONDS),
}).strict();

const FORM_SUBMISSION_COOKIE = "celebratedeal_form_submission";
const FORM_SUBMISSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

function requestCookie(request: Request, name: string) {
  for (const segment of (request.headers.get("cookie") ?? "").split(";").slice(0, 100)) {
    const separator = segment.indexOf("=");
    if (separator > 0 && segment.slice(0, separator).trim() === name) return segment.slice(separator + 1).trim();
  }
  return null;
}

async function verifiedRegistrationSubject(db: ReturnType<typeof getDb>, request: Request, vendorId: string, liveId: string) {
  const submissionId = requestCookie(request, FORM_SUBMISSION_COOKIE);
  if (!submissionId || !FORM_SUBMISSION_ID_PATTERN.test(submissionId)) return null;
  const submission = await db.formSubmission.findFirst({
    where: { id: submissionId, liveId, verificationStatus: "VERIFIED", form: { vendorId } },
    select: { id: true, email: true },
  });
  if (!submission) return null;
  return {
    subjectType: "buyer_registration" as const,
    subjectId: submission.id,
    subjectKeyHash: automationCustomerKeyHash(vendorId, submission.email),
    recipientEmail: submission.email,
  };
}

function errorResponse(error: StreamUsageValidationError) {
  if (error.code === "live_not_found" || error.code === "source_page_not_found") {
    return NextResponse.json({ error: "Playback source not found" }, { status: 404 });
  }
  if (error.code === "event_conflict") {
    return NextResponse.json({ error: "Usage event conflict" }, { status: 409 });
  }
  if (error.code === "stream_minutes_exhausted") {
    return NextResponse.json(
      { error: "Stream quota exhausted", code: "stream_minutes_exhausted" },
      { status: 429, headers: { "Cache-Control": "private, no-store" } },
    );
  }
  return NextResponse.json({ error: "Invalid usage event" }, { status: 400 });
}

function admissionRequiredResponse() {
  return NextResponse.json(
    { error: "Playback unavailable" },
    { status: 403, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "stream-usage", 120, 60_000);
  if (limited) return limited;

  const parsed = StreamUsagePayload.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Invalid usage event" }, { status: 400 });

  try {
    const token = liveViewerTokenFromRequest(request);
    if (!token) return admissionRequiredResponse();

    const db = getDb();
    const admitted = await getActiveLiveViewerSession(db, {
      vendorId: parsed.data.vendorId,
      liveId: parsed.data.liveId,
      token,
    });
    if (!admitted) return admissionRequiredResponse();

    const registration = await verifiedRegistrationSubject(db, request, parsed.data.vendorId, parsed.data.liveId);
    const result = await recordStreamUsageLedgerEntry({ ...parsed.data, viewerKeyHash: admitted.tokenHash, ...(registration ? { customerKeyHash: registration.subjectKeyHash } : {}) });
    const [total, liveDuration] = await Promise.all([
      db.streamUsageLedgerEntry.aggregate({
        where: { vendorId: parsed.data.vendorId, liveId: parsed.data.liveId, viewerKeyHash: admitted.tokenHash },
        _sum: { watchSeconds: true },
      }),
      db.live.findFirst({
        where: { id: parsed.data.liveId, vendorId: parsed.data.vendorId },
        select: { video: { select: { durationSec: true } } },
      }),
    ]);
    const watchSecondsTotal = total._sum.watchSeconds ?? 0;
    const durationSeconds = liveDuration?.video?.durationSec ?? 0;
    const watchPercent = durationSeconds > 0 ? Math.min(100, Math.round(watchSecondsTotal / durationSeconds * 100)) : null;
    try {
      const hasPurchased = registration ? await db.commerceOrder.count({ where: {
        vendorId: parsed.data.vendorId,
        automationCustomerKeyHash: registration.subjectKeyHash,
        status: "paid",
      } }) > 0 : undefined;
      const automationEvent = {
        vendorId: parsed.data.vendorId,
        eventId: parsed.data.eventId,
        subjectType: registration?.subjectType ?? "viewer_session",
        subjectId: registration?.subjectId ?? admitted.id,
        subjectKeyHash: registration?.subjectKeyHash ?? admitted.tokenHash,
        watchSecondsTotal,
        hasPurchased,
        recipientEmail: registration?.recipientEmail,
      } as const;
      await dispatchAutomationEvent(db, { ...automationEvent, trigger: "viewer_watch_progress" });
      await dispatchAutomationEvent(db, { ...automationEvent, trigger: "webinar_attended_duration_gte" });
    } catch {
      // Usage is already committed; automation failures are isolated from quota accounting.
    }
    return NextResponse.json(
      { ok: true, duplicate: result.duplicate, watchSecondsTotal, watchPercent },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof StreamUsageValidationError) return errorResponse(error);
    return NextResponse.json({ error: "Unable to record usage" }, { status: 500 });
  }
}
