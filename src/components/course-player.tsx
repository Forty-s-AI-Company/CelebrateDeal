"use client";

import { portalText } from "@/lib/student-portal-translations";
import type { StudentPortalLocale } from "@/lib/student-portal-locale";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { courseChapters, courseCompletion, shouldAutoCompleteLesson, type CourseLesson, type CourseLessonProgress } from "@/lib/course-learning";
type Lesson = CourseLesson & {
  videoUrl: string | null;
};
const subscribeToHydration = () => () => {};
const clientHydrationSnapshot = () => true;
const serverHydrationSnapshot = () => false;

export function CoursePlayer({
  vendorSlug,
  course,
  lessons,
  initialProgress,
  csrfToken,
  locale = "zh-TW"
}: {
  vendorSlug: string;
  course: {
    id: string;
    name: string;
  };
  lessons: Lesson[];
  initialProgress: CourseLessonProgress[];
  csrfToken: string;
  locale?: StudentPortalLocale;
}) {
  const t = (text: string) => portalText(locale, text);
  // Keep translated SSR controls inactive until client handlers are attached.
  const interactive = useSyncExternalStore(subscribeToHydration, clientHydrationSnapshot, serverHydrationSnapshot);
  const [selectedId, setSelectedId] = useState(lessons[0]?.id ?? "");
  const [progress, setProgress] = useState(initialProgress);
  const [notice, setNotice] = useState<string | null>(null);
  const lastSent = useRef<Record<string, number>>({});
  const currentCsrf = useRef(csrfToken);
  const pending = useRef(new Set<string>());
  const queuedProgress = useRef(new Map<string, {
    lesson: Lesson;
    seconds: number;
    markedComplete: boolean;
  }>());
  const selected = lessons.find(lesson => lesson.id === selectedId) ?? lessons[0] ?? null;
  const completion = useMemo(() => courseCompletion(lessons, progress), [lessons, progress]);
  const progressByLesson = useMemo(() => new Map(progress.map(item => [item.lessonId, item])), [progress]);
  async function save(lesson: Lesson, watchedSeconds: number, markedComplete: boolean) {
    // Coalesce pending checkpoints; a later media event cannot undo manual completion.
    if (pending.current.has(lesson.id)) {
      const queued = queuedProgress.current.get(lesson.id);
      queuedProgress.current.set(lesson.id, {
        lesson,
        seconds: Math.max(queued?.seconds ?? 0, watchedSeconds),
        markedComplete: markedComplete || queued?.markedComplete === true
      });
      return;
    }
    pending.current.add(lesson.id);
    try {
      const endpoint = `/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(course.id)}/progress`;
      const post = () => fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-celebratedeal-client": "web",
          "x-csrf-token": currentCsrf.current
        },
        body: JSON.stringify({
          lessonId: lesson.id,
          watchedSeconds,
          markedComplete
        })
      });
      let response = await post();
      // Keep this checkpoint in flight while refreshing once. A revoked right
      // or another rejection must not become an unbounded retry loop.
      if (response.status === 403) {
        const refreshed = await fetch(endpoint, {
          method: "GET",
          cache: "no-store",
          headers: {
            "x-celebratedeal-client": "web"
          }
        });
        if (refreshed.ok) {
          const token = (await refreshed.json()) as {
            csrfToken?: unknown;
          };
          if (typeof token.csrfToken === "string" && token.csrfToken.length > 0 && token.csrfToken.length <= 2048) {
            currentCsrf.current = token.csrfToken;
            response = await post();
          }
        }
      }
      if (!response.ok) {
        setNotice(t("\u76EE\u524D\u7121\u6CD5\u5132\u5B58\u9032\u5EA6\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002 "));
        return;
      }
      const body = (await response.json()) as {
        lessonId?: unknown;
        watchedSeconds?: unknown;
        completedAt?: unknown;
      };
      if (body.lessonId !== lesson.id || typeof body.watchedSeconds !== "number" || !Number.isInteger(body.watchedSeconds) || body.watchedSeconds < 0 || body.watchedSeconds > 86400 || body.completedAt !== null && (typeof body.completedAt !== "string" || !Number.isFinite(Date.parse(body.completedAt)))) {
        setNotice(t("\u6536\u5230\u7684\u9032\u5EA6\u8CC7\u6599\u4E0D\u5B8C\u6574\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u5F8C\u518D\u8A66\u3002"));
        return;
      }
      const saved: CourseLessonProgress = {
        lessonId: body.lessonId,
        watchedSeconds: body.watchedSeconds,
        completedAt: body.completedAt ? new Date(body.completedAt) : null
      };
      setProgress(current => [...current.filter(item => item.lessonId !== saved.lessonId), saved]);
      setNotice(saved.completedAt ? t("\u9019\u500B\u55AE\u5143\u5DF2\u5B8C\u6210\uFF0C\u7E7C\u7E8C\u4FDD\u6301\u3002") : t("\u64AD\u653E\u4F4D\u7F6E\u5DF2\u8A18\u4F4F\u3002"));
    } catch {
      setNotice(t("\u76EE\u524D\u7121\u6CD5\u5132\u5B58\u9032\u5EA6\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002"));
    } finally {
      pending.current.delete(lesson.id);
      const queued = queuedProgress.current.get(lesson.id);
      queuedProgress.current.delete(lesson.id);
      if (queued) void save(queued.lesson, queued.seconds, queued.markedComplete);
    }
  }
  if (!selected) return <section className="rounded-2xl border border-slate-200 bg-white p-8"><h2 className="text-xl font-bold">{t("\u8AB2\u7A0B\u5167\u5BB9\u6E96\u5099\u4E2D")}</h2><p className="mt-2 text-slate-600">{t("\u8B1B\u5E2B\u5C1A\u672A\u767C\u5E03\u55AE\u5143\uFF0C\u4E4B\u5F8C\u56DE\u4F86\u5C31\u80FD\u958B\u59CB\u5B78\u7FD2\u3002")}</p></section>;
  const resume = progressByLesson.get(selected.id)?.watchedSeconds ?? 0;
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><header className="border-b border-slate-200 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-blue-700">{t("\u5B78\u7FD2\u9032\u5EA6")}</p><h1 className="mt-1 text-2xl font-bold">{course.name}</h1></div><span className="rounded-full bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-800">{completion.percent}{t("% \u5B8C\u6210")}</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-[width]" style={{
          width: `${completion.percent}%`
        }} /></div></header><div className="grid lg:grid-cols-[300px_minmax(0,1fr)]"><aside className="border-b border-slate-200 bg-slate-50 p-4 lg:border-b-0 lg:border-r">{courseChapters(lessons).map(chapter => <section key={chapter.title} className="mb-5"><h2 className="px-2 text-sm font-bold text-slate-700">{chapter.title}</h2><ol className="mt-2 space-y-1">{chapter.lessons.map(lesson => {
              const done = Boolean(progressByLesson.get(lesson.id)?.completedAt);
              return <li key={lesson.id}><button type="button" disabled={!interactive} onClick={() => {
                  setSelectedId(lesson.id);
                  setNotice(null);
                }} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-sm ${lesson.id === selected.id ? "bg-white font-bold text-blue-800 shadow-sm" : "text-slate-700 hover:bg-white"}`}><span aria-label={done ? t("\u5DF2\u5B8C\u6210") : t("\u672A\u5B8C\u6210")} className={`grid size-5 shrink-0 place-items-center rounded-full text-xs ${done ? "bg-emerald-600 text-white" : "border border-slate-300 text-transparent"}`}>✓</span>{lesson.title}</button></li>;
            })}</ol></section>)}</aside><div className="p-5 sm:p-6">{selected.videoUrl ? <video key={selected.id} controls className="aspect-video w-full rounded-xl bg-slate-950" src={selected.videoUrl} onLoadedMetadata={event => {
          if (resume > 0 && event.currentTarget.duration > resume) {
            event.currentTarget.currentTime = resume;
            setNotice(locale === "en" ? `Resumed at ${Math.floor(resume / 60)}m ${resume % 60}s.` : `已從 ${Math.floor(resume / 60)} 分 ${resume % 60} 秒繼續播放。`);
          }
        }} onTimeUpdate={event => {
          const seconds = Math.floor(event.currentTarget.currentTime);
          const isNinetyPercent = shouldAutoCompleteLesson(seconds, selected.durationSeconds);
          const previousSeconds = lastSent.current[selected.id] ?? 0;
          const crossedCompletion = isNinetyPercent && !shouldAutoCompleteLesson(previousSeconds, selected.durationSeconds) && !progressByLesson.get(selected.id)?.completedAt;
          if (crossedCompletion || seconds - previousSeconds >= 15 || queuedProgress.current.has(selected.id) && seconds > previousSeconds) {
            lastSent.current[selected.id] = seconds;
            void save(selected, seconds, false);
          }
        }} onEnded={event => {
          const seconds = Math.floor(event.currentTarget.currentTime);
          lastSent.current[selected.id] = seconds;
          void save(selected, seconds, false);
        }} /> : <div className="grid aspect-video place-items-center rounded-xl bg-slate-950 p-8 text-center text-white"><p>{t("\u9019\u500B\u55AE\u5143\u76EE\u524D\u6C92\u6709\u5F71\u7247\uFF0C\u8ACB\u95B1\u8B80\u8B1B\u5E2B\u63D0\u4F9B\u7684\u6559\u6750\u5F8C\u624B\u52D5\u6A19\u8A18\u5B8C\u6210\u3002")}</p></div>}<div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">{selected.chapterTitle}</p><h2 className="text-xl font-bold">{selected.title}</h2>{notice ? <p role="status" className="mt-2 text-sm text-slate-600">{notice}</p> : null}</div><button type="button" disabled={!interactive} onClick={() => void save(selected, selected.durationSeconds || resume, true)} className="min-h-11 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800">{progressByLesson.get(selected.id)?.completedAt ? t("\u5DF2\u6A19\u8A18\u5B8C\u6210") : t("\u6A19\u8A18\u5B8C\u6210")}</button></div>{completion.complete ? <a href={`/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(course.id)}/certificate`} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-amber-500 px-4 text-sm font-bold text-slate-950 hover:bg-amber-400">{t("\u4E0B\u8F09\u5B8C\u8AB2\u8B49\u66F8")}</a> : null}</div></div></section>;
}
