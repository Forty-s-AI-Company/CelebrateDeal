import { NextResponse } from "next/server";
import { requireSameOriginRequest, readJsonBody } from "@/lib/api-security";
import { getCsrfToken, verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";
import { listLearnerNotificationPreferences, saveLearnerNotificationConsent } from "@/lib/learner-notification-preferences";
import { LearnerNotificationConsentInput } from "@/lib/learner-notification-contract";

type Context = { params: Promise<{ vendorSlug: string; courseId: string }> };
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** Server session selects the tenant and recipient; caller input never selects either. */
export async function GET(request: Request, { params }: Context) {
  const boundary = requireSameOriginRequest(request, { requireClientHeader: true });
  if (boundary) return boundary;
  const { vendorSlug, courseId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  const preferences = await listLearnerNotificationPreferences(getDb(), session, courseId);
  if (!preferences) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  return NextResponse.json({ preferences, csrfToken: await getCsrfToken() }, { headers });
}

export async function POST(request: Request, { params }: Context) {
  const boundary = requireSameOriginRequest(request, { requireClientHeader: true });
  if (boundary) return boundary;
  if (!await verifyCsrfToken(request.headers.get("x-csrf-token"))) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  const input = LearnerNotificationConsentInput.safeParse(await readJsonBody(request, 4096));
  if (!input.success) return NextResponse.json({ error: "invalid_consent" }, { status: 400, headers });
  const { vendorSlug, courseId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  try {
    const result = await saveLearnerNotificationConsent(getDb(), session, courseId, input.data);
    const status = { saved: 200, not_found: 404, conflict: 409, verification_required: 409 }[result.status];
    return NextResponse.json(result, { status, headers });
  } catch {
    return NextResponse.json({ error: "consent_unavailable" }, { status: 503, headers });
  }
}
