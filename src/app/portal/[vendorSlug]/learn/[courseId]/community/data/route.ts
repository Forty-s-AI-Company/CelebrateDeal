import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest, readJsonBody } from "@/lib/api-security";
import { getCsrfToken, verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { CommunityConflict, CommunityMutation, getCourseCommunity, getCourseCommunityReplies, mutateCourseCommunity } from "@/lib/course-community";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
type Context = { params: Promise<{ vendorSlug: string; courseId: string }> };
const query = z.object({ postId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u).optional(), cursor: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/u).optional() }).strict();

/** Authenticated GET also refreshes CSRF after long discussion sessions. */
export async function GET(request: Request, { params }: Context) {
  const boundary = requireSameOriginRequest(request, { requireClientHeader: true });
  if (boundary) return boundary;
  const url = new URL(request.url);
  if ([...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)) return NextResponse.json({ error: "invalid_query" }, { status: 400, headers });
  const input = query.safeParse(Object.fromEntries(url.searchParams));
  if (!input.success) return NextResponse.json({ error: "invalid_query" }, { status: 400, headers });
  const { vendorSlug, courseId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  const result = input.data.postId ? await getCourseCommunityReplies(getDb(), session, courseId, input.data.postId, input.data.cursor) : await getCourseCommunity(getDb(), session, courseId, input.data.cursor);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  return NextResponse.json({ ...result, csrfToken: await getCsrfToken() }, { headers });
}

/** Tenant and learner identity always come from the portal session. */
export async function POST(request: Request, { params }: Context) {
  const boundary = requireSameOriginRequest(request, { requireClientHeader: true });
  if (boundary) return boundary;
  if (!await verifyCsrfToken(request.headers.get("x-csrf-token"))) return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  const input = CommunityMutation.safeParse(await readJsonBody(request, 24 * 1024));
  if (!input.success) return NextResponse.json({ error: "invalid_content" }, { status: 400, headers });
  const { vendorSlug, courseId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  try {
    const result = await mutateCourseCommunity(getDb(), session, courseId, input.data);
    return result ? NextResponse.json(result, { headers }) : NextResponse.json({ error: "not_found" }, { status: 404, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof CommunityConflict ? "request_conflict" : "unavailable" }, { status: error instanceof CommunityConflict ? 409 : 503, headers });
  }
}
