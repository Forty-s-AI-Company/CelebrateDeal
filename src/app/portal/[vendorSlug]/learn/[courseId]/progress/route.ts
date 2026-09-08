import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest, readJsonBody } from "@/lib/api-security";
import { verifyCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { saveStudentLessonProgress } from "@/lib/student-course-learning";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

const ProgressInput = z.object({
  lessonId: z.string().trim().min(1).max(160),
  watchedSeconds: z.number().finite().min(0).max(24 * 60 * 60),
  markedComplete: z.boolean(),
}).strict();

/** Persists only the authenticated learner's progress for a purchased course. */
export async function POST(request: Request, { params }: { params: Promise<{ vendorSlug: string; courseId: string }> }) {
  const boundary = requireSameOriginRequest(request, { requireClientHeader: true });
  if (boundary) return boundary;
  if (!await verifyCsrfToken(request.headers.get("x-csrf-token"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const input = ProgressInput.safeParse(await readJsonBody(request, 4 * 1024));
  if (!input.success) return NextResponse.json({ error: "invalid_progress" }, { status: 400 });
  const { vendorSlug, courseId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  try {
    const progress = await saveStudentLessonProgress(getDb() as never, session, { courseId, ...input.data });
    if (!progress) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(progress, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "invalid_progress" }, { status: 400 });
  }
}
