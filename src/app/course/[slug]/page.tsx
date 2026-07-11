import { notFound } from "next/navigation";
import { CalendarDays, CheckCircle2, PlayCircle } from "lucide-react";
import { CourseConversionPanel } from "@/components/course-conversion-panel";
import { getPublicCourse } from "@/lib/courses";
import { formatDateTime } from "@/lib/format";

export default async function PublicCoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const course = await getPublicCourse(slug);
  if (!course) notFound();
  const heroImage = course.coverImageUrl ?? course.defaultProduct?.imageUrl ?? course.lessons.find((lesson) => lesson.video?.thumbnailUrl)?.video?.thumbnailUrl ?? null;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950">
      <section className="relative flex min-h-[68svh] items-end overflow-hidden bg-slate-900 px-4 pb-12 pt-24 text-white sm:px-8 lg:px-12">
        {heroImage ? <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${heroImage})` }} /> : null}
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative mx-auto w-full max-w-6xl">
          <p className="text-sm font-semibold text-blue-200">{course.vendor.name}</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-semibold sm:text-5xl">{course.title}</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-slate-200">{course.description ?? "完整課程內容與場次資訊，請在下方選擇適合的報名方式。"}</p>
          <a href="#enroll" className="mt-7 inline-flex h-11 items-center rounded-md bg-orange-500 px-5 text-sm font-bold text-white hover:bg-orange-600">查看場次並報名</a>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:px-12">
        <div className="grid gap-8">
          <section>
            <h2 className="text-2xl font-semibold">課程內容</h2>
            <div className="mt-4 divide-y divide-slate-200 border-y border-slate-200 bg-white">
              {course.lessons.map((lesson) => (
                <article key={lesson.id} className="p-4 sm:p-5">
                  <div className="flex items-start gap-3"><span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-blue-50 text-blue-700"><PlayCircle size={17} /></span><div><h3 className="font-semibold">{lesson.title}</h3>{lesson.description ? <p className="mt-1 text-sm leading-6 text-slate-500">{lesson.description}</p> : null}{lesson.isPreview ? <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 size={13} />可預覽</p> : null}</div></div>
                  {lesson.isPreview && lesson.video?.status === "ready" && lesson.video.videoUrl ? <video className="mt-4 aspect-video w-full bg-black" controls preload="metadata" src={lesson.video.videoUrl} /> : null}
                </article>
              ))}
            </div>
          </section>
          {course.sessions.length > 0 ? <section><h2 className="text-2xl font-semibold">近期場次</h2><div className="mt-4 grid gap-3">{course.sessions.map((session) => <div key={session.id} className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4"><div><p className="font-semibold">{session.title}</p><p className="mt-1 text-sm text-slate-500">{formatDateTime(session.startsAt)}</p></div><CalendarDays className="text-blue-600" size={20} /></div>)}</div></section> : null}
        </div>
        <aside id="enroll" className="self-start rounded-lg border border-slate-200 bg-white p-5 shadow-sm lg:sticky lg:top-6">
          <CourseConversionPanel
            courseId={course.id}
            courseSlug={course.slug}
            vendorId={course.vendorId}
            sessions={course.sessions.map((session) => ({ id: session.id, title: session.title, startsAt: session.startsAt.toISOString(), capacity: session.capacity }))}
            product={course.defaultProduct ? { id: course.defaultProduct.id, name: course.defaultProduct.name, priceCents: course.defaultProduct.priceCents, currency: course.defaultProduct.currency, imageUrl: course.defaultProduct.imageUrl } : null}
            submitLabel={course.registrationForm?.submitLabel ?? "完成報名"}
            successMessage={course.registrationForm?.successMessage ?? "報名成功"}
          />
        </aside>
      </section>
    </main>
  );
}
