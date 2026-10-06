import { notFound } from "next/navigation";
import { CourseCommunity } from "@/components/course-community";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { getCourseCommunity, getCourseCommunityReplies } from "@/lib/course-community";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";
export const dynamic = "force-dynamic";
/** Open the notification's exact thread after checking current purchase rights. */
export default async function DiscussionPage({ params }: { params: Promise<{vendorSlug:string;courseId:string;postId:string}> }) {
 const {vendorSlug,courseId,postId}=await params;
 const {session}=await requireStudentPortalSession(vendorSlug);
 const db=getDb();
 const [feed,thread]=await Promise.all([getCourseCommunity(db,session,courseId),getCourseCommunityReplies(db,session,courseId,postId)]);
 if(!feed || !thread)notFound();
 const path=`/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(courseId)}/community`;
 return <main className="min-h-screen bg-slate-100 px-4 py-8"><div className="mx-auto max-w-3xl"><a href={path} className="inline-flex min-h-11 items-center font-bold text-blue-700">回到課程討論</a><h1 className="mt-4 text-3xl font-bold">{feed.course.name}・討論回覆</h1><CourseCommunity endpoint={`${path}/data`} initialFeed={feed} initialThread={thread} csrfToken={await getCsrfToken()} /></div></main>;
}
