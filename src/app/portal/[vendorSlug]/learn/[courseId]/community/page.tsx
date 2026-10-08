import { portalText } from "@/lib/student-portal-translations";
import { resolveStudentPortalLocale } from "@/lib/student-portal-locale";
import { notFound } from "next/navigation";
import { CourseCommunity } from "@/components/course-community";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { getCourseCommunity } from "@/lib/course-community";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";
export const dynamic = "force-dynamic";
export default async function CourseCommunityPage({
  params
}: {
  params: Promise<{
    vendorSlug: string;
    courseId: string;
  }>;
}) {
  const locale = await resolveStudentPortalLocale();
  const t = (text: string) => portalText(locale, text);
  const {
    vendorSlug,
    courseId
  } = await params;
  const {
    session
  } = await requireStudentPortalSession(vendorSlug);
  const feed = await getCourseCommunity(getDb(), session, courseId);
  if (!feed) notFound();
  const courseUrl = `/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(courseId)}`;
  return <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950"><div className="mx-auto max-w-3xl"><a href={courseUrl} className="inline-flex min-h-11 items-center font-bold text-blue-700">{t("\u2190 \u56DE\u5230\u8AB2\u7A0B")}</a><h1 className="mt-4 text-3xl font-bold">{feed.course.name}{t("\u30FB\u5B78\u54E1\u8A0E\u8AD6")}</h1><p className="mt-3 text-slate-600">{t("\u5206\u4EAB\u5B78\u7FD2\u5FC3\u5F97\u3001\u4E92\u76F8\u56DE\u8986\u3002\u53EA\u6709\u9019\u9580\u8AB2\u7A0B\u7684\u6709\u6548\u5B78\u54E1\u80FD\u67E5\u770B\u8207\u53C3\u8207\u3002")}</p><CourseCommunity locale={locale} endpoint={`${courseUrl}/community/data`} initialFeed={feed} csrfToken={await getCsrfToken()} /></div></main>;
}
