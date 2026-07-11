import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSameOriginRequest } from "@/lib/api-security";
import { resolveRequestAttribution } from "@/lib/attribution";
import { CourseDomainError, enrollInCourse } from "@/lib/courses";
import { getDb } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const CourseEnrollmentPayload = z.object({
  courseId: z.string().trim().min(1).max(128),
  sessionId: z.string().trim().min(1).max(128).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(320),
  phone: z.string().trim().max(40).nullable().optional(),
});

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;
  const limited = await checkRateLimit(request, "course-enrollments", 10, 60_000);
  if (limited) return limited;

  const parsed = CourseEnrollmentPayload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid enrollment" }, { status: 400 });
  const course = await getDb().course.findFirst({
    where: { id: parsed.data.courseId, status: "published" },
    select: { id: true, vendorId: true },
  });
  if (!course) return NextResponse.json({ error: "Course not found" }, { status: 404 });
  const attribution = await resolveRequestAttribution(request, course.vendorId);

  try {
    const result = await enrollInCourse({
      ...parsed.data,
      affiliateId: attribution?.affiliate.id,
      attributionClickId: attribution?.id,
      referralCode: attribution?.affiliate.code,
    });
    return NextResponse.json({ ok: true, enrollmentId: result.enrollment.id, idempotentReplay: result.idempotentReplay });
  } catch (error) {
    if (!(error instanceof CourseDomainError)) throw error;
    const status = error.code === "not_found" ? 404
      : error.code === "blocked" ? 403
        : ["capacity_reached", "session_unavailable"].includes(error.code) ? 409
          : 422;
    return NextResponse.json({ error: error.message, code: error.code }, { status });
  }
}
