"use client";

import { useMemo, useRef, useState } from "react";
import { courseChapters, courseCompletion, shouldAutoCompleteLesson, type CourseLesson, type CourseLessonProgress } from "@/lib/course-learning";

type Lesson = CourseLesson & { videoUrl: string | null };

export function CoursePlayer({ vendorSlug, course, lessons, initialProgress, csrfToken }: {
  vendorSlug: string;
  course: { id: string; name: string };
  lessons: Lesson[];
  initialProgress: CourseLessonProgress[];
  csrfToken: string;
}) {
  const [selectedId, setSelectedId] = useState(lessons[0]?.id ?? "");
  const [progress, setProgress] = useState(initialProgress);
  const [notice, setNotice] = useState<string | null>(null);
  const lastSent = useRef<Record<string, number>>({});
  const pending = useRef(new Set<string>());
  const queuedProgress = useRef(new Map<string, { lesson: Lesson; seconds: number; markedComplete: boolean }>());
  const selected = lessons.find((lesson) => lesson.id === selectedId) ?? lessons[0] ?? null;
  const completion = useMemo(() => courseCompletion(lessons, progress), [lessons, progress]);
  const progressByLesson = useMemo(() => new Map(progress.map((item) => [item.lessonId, item])), [progress]);

  async function save(lesson: Lesson, watchedSeconds: number, markedComplete: boolean) {
    // Coalesce pending checkpoints; a later media event cannot undo manual completion.
    if (pending.current.has(lesson.id)) {
      const queued = queuedProgress.current.get(lesson.id);
      queuedProgress.current.set(lesson.id, {
        lesson, seconds: Math.max(queued?.seconds ?? 0, watchedSeconds),
        markedComplete: markedComplete || queued?.markedComplete === true,
      });
      return;
    }
    pending.current.add(lesson.id);
    try {
      const response = await fetch(`/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(course.id)}/progress`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-celebratedeal-client": "web", "x-csrf-token": csrfToken },
        body: JSON.stringify({ lessonId: lesson.id, watchedSeconds, markedComplete }),
      });
      if (!response.ok) { setNotice("目前無法儲存進度，請稍後再試。 "); return; }
      const body = await response.json() as { lessonId?: unknown; watchedSeconds?: unknown; completedAt?: unknown };
      if (typeof body.lessonId !== "string" || typeof body.watchedSeconds !== "number" || (body.completedAt !== null && typeof body.completedAt !== "string")) {
        setNotice("收到的進度資料不完整，請重新整理後再試。");
        return;
      }
      const saved: CourseLessonProgress = { lessonId: body.lessonId, watchedSeconds: body.watchedSeconds, completedAt: body.completedAt ? new Date(body.completedAt) : null };
      setProgress((current) => [...current.filter((item) => item.lessonId !== saved.lessonId), saved]);
      setNotice(saved.completedAt ? "這個單元已完成，繼續保持。" : "播放位置已記住。");
    } catch {
      setNotice("目前無法儲存進度，請稍後再試。");
    } finally {
      pending.current.delete(lesson.id);
      const queued = queuedProgress.current.get(lesson.id);
      queuedProgress.current.delete(lesson.id);
      if (queued) void save(queued.lesson, queued.seconds, queued.markedComplete);
    }
  }

  if (!selected) return <section className="rounded-2xl border border-slate-200 bg-white p-8"><h2 className="text-xl font-bold">課程內容準備中</h2><p className="mt-2 text-slate-600">講師尚未發布單元，之後回來就能開始學習。</p></section>;
  const resume = progressByLesson.get(selected.id)?.watchedSeconds ?? 0;
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><header className="border-b border-slate-200 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-blue-700">學習進度</p><h1 className="mt-1 text-2xl font-bold">{course.name}</h1></div><span className="rounded-full bg-blue-50 px-3 py-1.5 text-sm font-bold text-blue-800">{completion.percent}% 完成</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${completion.percent}%` }} /></div></header><div className="grid lg:grid-cols-[300px_minmax(0,1fr)]"><aside className="border-b border-slate-200 bg-slate-50 p-4 lg:border-b-0 lg:border-r">{courseChapters(lessons).map((chapter) => <section key={chapter.title} className="mb-5"><h2 className="px-2 text-sm font-bold text-slate-700">{chapter.title}</h2><ol className="mt-2 space-y-1">{chapter.lessons.map((lesson) => { const done = Boolean(progressByLesson.get(lesson.id)?.completedAt); return <li key={lesson.id}><button type="button" onClick={() => { setSelectedId(lesson.id); setNotice(null); }} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2.5 text-left text-sm ${lesson.id === selected.id ? "bg-white font-bold text-blue-800 shadow-sm" : "text-slate-700 hover:bg-white"}`}><span aria-label={done ? "已完成" : "未完成"} className={`grid size-5 shrink-0 place-items-center rounded-full text-xs ${done ? "bg-emerald-600 text-white" : "border border-slate-300 text-transparent"}`}>✓</span>{lesson.title}</button></li>; })}</ol></section>)}</aside><div className="p-5 sm:p-6">{selected.videoUrl ? <video key={selected.id} controls className="aspect-video w-full rounded-xl bg-slate-950" src={selected.videoUrl} onLoadedMetadata={(event) => { if (resume > 0 && event.currentTarget.duration > resume) { event.currentTarget.currentTime = resume; setNotice(`已從 ${Math.floor(resume / 60)} 分 ${resume % 60} 秒繼續播放。`); } }} onTimeUpdate={(event) => { const seconds = Math.floor(event.currentTarget.currentTime); const isNinetyPercent = shouldAutoCompleteLesson(seconds, selected.durationSeconds); const previousSeconds = lastSent.current[selected.id] ?? 0; const crossedCompletion = isNinetyPercent && !shouldAutoCompleteLesson(previousSeconds, selected.durationSeconds) && !progressByLesson.get(selected.id)?.completedAt; if (crossedCompletion || seconds - previousSeconds >= 15 || (queuedProgress.current.has(selected.id) && seconds > previousSeconds)) { lastSent.current[selected.id] = seconds; void save(selected, seconds, false); } }} onEnded={(event) => { const seconds = Math.floor(event.currentTarget.currentTime); lastSent.current[selected.id] = seconds; void save(selected, seconds, false); }} /> : <div className="grid aspect-video place-items-center rounded-xl bg-slate-950 p-8 text-center text-white"><p>這個單元目前沒有影片，請閱讀講師提供的教材後手動標記完成。</p></div>}<div className="mt-5 flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold text-slate-600">{selected.chapterTitle}</p><h2 className="text-xl font-bold">{selected.title}</h2>{notice ? <p role="status" className="mt-2 text-sm text-slate-600">{notice}</p> : null}</div><button type="button" onClick={() => void save(selected, selected.durationSeconds || resume, true)} className="min-h-11 rounded-xl bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800">{progressByLesson.get(selected.id)?.completedAt ? "已標記完成" : "標記完成"}</button></div>{completion.complete ? <a href={`/portal/${encodeURIComponent(vendorSlug)}/learn/${encodeURIComponent(course.id)}/certificate`} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-amber-500 px-4 text-sm font-bold text-slate-950 hover:bg-amber-400">下載完課證書</a> : null}</div></div></section>;
}
