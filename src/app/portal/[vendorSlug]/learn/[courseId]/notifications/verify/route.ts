import { NextResponse } from "next/server";
import { requireSameOriginRequest, readJsonBody } from "@/lib/api-security";
import { verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";
import { consumeLearnerContactVerification, LearnerContactVerificationInput } from "@/lib/learner-notification-verification";

type Context = { params: Promise<{ vendorSlug: string; courseId: string }> };
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** Recipient proof is submitted in the bounded POST body, never a URL or log.
 * Session and course entitlement select the scope; proof leaves consent disabled. */
export async function POST(request: Request, { params }: Context) {
 const boundary = requireSameOriginRequest(request, { requireClientHeader: true });
 if (boundary) return boundary;
 if (!await verifyCsrfToken(request.headers.get("x-csrf-token"))) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
 const input = LearnerContactVerificationInput.safeParse(await readJsonBody(request, 4096));
 if (!input.success) return NextResponse.json({ error: "invalid_challenge" }, { status: 400, headers });
 const { vendorSlug, courseId } = await params;
 const { session } = await requireStudentPortalSession(vendorSlug);
 try {
  const result = await consumeLearnerContactVerification(getDb(), session, courseId, input.data);
  if (result.status !== "verified") return NextResponse.json({ status: result.status }, { status: result.status === "not_found" ? 404 : 409, headers });
  const p = result.preference;
  // Explicit projection prevents internal proof/contact fields from leaking.
  return NextResponse.json({ status: "verified", preference: { channel: p.channel, enabled: p.enabled, revision: p.revision, destinationVerifiedAt: p.destinationVerifiedAt } }, { headers });
 } catch {
  return NextResponse.json({ error: "verification_unavailable" }, { status: 503, headers });
 }
}
