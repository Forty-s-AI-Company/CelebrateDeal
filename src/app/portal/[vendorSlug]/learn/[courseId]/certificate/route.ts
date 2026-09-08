import { createCourseCertificate } from "@/lib/course-certificate";
import { getDb } from "@/lib/db";
import { studentCertificateDetails } from "@/lib/student-course-learning";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

/** Returns SVG rather than a user-controlled HTML document, with no-store PII-safe caching. */
export async function GET(_request: Request, { params }: { params: Promise<{ vendorSlug: string; courseId: string }> }) {
  const { vendorSlug, courseId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  const details = await studentCertificateDetails(getDb() as never, session, courseId);
  if (!details) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  const certificate = createCourseCertificate({ ...details, customerKeyHash: session.customerKeyHash, courseId });
  return new Response(certificate.svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "content-disposition": 'attachment; filename="course-certificate.svg"',
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
