import { notFound } from "next/navigation";
import { CourseCommunity } from "@/components/course-community";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { getCourseCommunity } from "@/lib/course-community";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

export const dynamic = "force-dynamic";

export default async function CourseCommunityPage({ params }: { params: Promise<{ vendorSlug: string; courseId: string }> }) {
  const { vendorSlug, courseId } = await params;
  const { session } = await requireStudentPortalSession(vendorSlug);
  const feed = await getCourseCommunity(getDb(), session, courseId);
  if (!feed) notFound();
  const courseUrl = `/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(courseId)}`;
  return <main className="min-h-screen bg-slate-100 px-4 py-8 text-slate-950"><div className="mx-auto max-w-3xl"><a href={courseUrl} className="inline-flex min-h-11 items-center font-bold text-blue-700">← 回到課程</a><h1 className="mt-4 text-3xl font-bold">{feed.course.name}・學員討論</h1><p className="mt-3 text-slate-600">分享學習心得、互相回覆。只有這門課程的有效學員能查看與參與。</p><CourseCommunity endpoint={`${courseUrl}/community/data`} initialFeed={feed} csrfToken={await getCsrfToken()} /></div></main>;
}
