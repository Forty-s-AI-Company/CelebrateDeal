import { notFound } from "next/navigation";
import { LearnerNotificationSettings } from "@/components/learner-notification-settings";
import { CoursePlayer } from "@/components/course-player";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { getStudentCourse } from "@/lib/student-course-learning";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";
import { resolveStudentPortalLocale } from "@/lib/student-portal-locale";
import { portalText } from "@/lib/student-portal-translations";
export const dynamic = "force-dynamic";
export default async function StudentCoursePage({ params }: {
    params: Promise<{
        vendorSlug: string;
        courseId: string;
    }>;
}) {
    const { vendorSlug, courseId } = await params;
    const { session } = await requireStudentPortalSession(vendorSlug);
    const course = await getStudentCourse(getDb(), session, courseId);
    if (!course)
        notFound();
    const locale = await resolveStudentPortalLocale();
    return <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 sm:px-6 sm:py-10"><div className="mx-auto max-w-7xl"><a href={`/portal/${encodeURIComponent(vendorSlug)}`} className="mb-5 inline-flex min-h-11 items-center text-sm font-bold text-blue-700 hover:underline">{portalText(locale, "\u2190 回到學員中心")}</a><a href={`/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(courseId)}/community`} className="mb-5 ml-5 inline-flex min-h-11 items-center font-bold text-blue-700">{portalText(locale, "學員討論")}</a><CoursePlayer locale={locale} vendorSlug={vendorSlug} course={course.course} lessons={course.lessons} initialProgress={course.progress} csrfToken={await getCsrfToken()}/><LearnerNotificationSettings locale={locale} vendorSlug={vendorSlug} courseId={courseId}/></div></main>;
}
