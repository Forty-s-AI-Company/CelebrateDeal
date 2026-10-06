import { NextResponse } from "next/server";
import { requireSameOriginRequest, readJsonBody } from "@/lib/api-security";
import { getCsrfToken, verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";
import { LearnerConsultationReminderInput, confirmLearnerConsultationReminder, listLearnerConsultationReminders } from "@/lib/learner-consultation-reminders";

type Context = { params: Promise<{ vendorSlug: string; courseId: string }> };
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** Session owns tenant/recipient; caller can name only its exact booking revision. */
export async function GET(request: Request, { params }: Context) {
  const boundary = requireSameOriginRequest(request, { requireClientHeader: true });
  if (boundary) return boundary;
  const after = new URL(request.url).searchParams.get("after") ?? undefined;
  if (after && !/^[A-Za-z0-9_-]{1,128}$/u.test(after)) return NextResponse.json({ error: "invalid_cursor" }, { status: 400, headers });
  const { vendorSlug, courseId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  try {
    const result = await listLearnerConsultationReminders(getDb(), session, courseId, after);
    if (!result) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
    return NextResponse.json({ ...result, csrfToken: await getCsrfToken() }, { headers });
  } catch { return NextResponse.json({ error: "reminders_unavailable" }, { status: 503, headers }); }
}

export async function POST(request: Request, { params }: Context) {
  const boundary = requireSameOriginRequest(request, { requireClientHeader: true });
  if (boundary) return boundary;
  if (!await verifyCsrfToken(request.headers.get("x-csrf-token"))) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  const input = LearnerConsultationReminderInput.safeParse(await readJsonBody(request, 2048));
  if (!input.success) return NextResponse.json({ error: "invalid_booking" }, { status: 400, headers });
  const { vendorSlug, courseId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  try {
    const result = await confirmLearnerConsultationReminder(getDb(), session, courseId, input.data);
    const status = { scheduled: 200, not_found: 404, verification_required: 409 }[result.status];
    return NextResponse.json(result, { status, headers });
  } catch { return NextResponse.json({ error: "reminder_unavailable" }, { status: 503, headers }); }
}
