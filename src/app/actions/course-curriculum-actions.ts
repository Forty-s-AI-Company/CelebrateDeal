"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { ChapterTitleTaken, CurriculumConflict, renameCourseChapter, saveCourseLesson } from "@/lib/course-curriculum";
import { ChapterNotEmpty, deleteCourseChapter, moveCourseChapter, moveCourseLesson } from "@/lib/course-chapter-manage";
import { getDb } from "@/lib/db";
import { isTransientTransactionConflict } from "@/lib/serializable-retry";
import { requireFeature } from "@/lib/feature-gates";

export async function saveCourseLessonAction(form: FormData) {
  await assertServerActionSecurity(form);
  const vendor = await requireVendorManager();
  requireFeature(vendor, "courses");
  const productId = form.get("productId");
  if (typeof productId !== "string" || !productId || productId.length > 160) throw new Error("Invalid course.");
  const path = `/products/${encodeURIComponent(productId)}/lessons`;
  let error: string | null = null;
  try {
    await saveCourseLesson(getDb(), vendor.id, {
      productId, lessonId: form.get("lessonId") || undefined,
      revision: Number(form.get("revision")), chapterTitle: form.get("chapterTitle"), title: form.get("title"),
      videoUrl: form.get("videoUrl"), durationSeconds: Number(form.get("durationSeconds")), published: form.get("published") === "on",
    });
  } catch (failure) {
    if (failure instanceof ZodError) error = "invalid";
    else if (failure instanceof CurriculumConflict || (failure instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(failure.code))) error = "conflict";
    else throw failure;
  }
  if (error) redirect(`${path}?error=${error}`);
  revalidatePath(path);
  revalidatePath(`/portal/${encodeURIComponent(vendor.slug)}`, "layout");
  redirect(`${path}?saved=1`);
}

/** F-5: same guard order as saveCourseLessonAction (CSRF, manager, `courses` gate);
 * the vendor comes from the session and every lookup is bound to it. */
export async function renameCourseChapterAction(form: FormData) {
  await assertServerActionSecurity(form);
  const vendor = await requireVendorManager();
  requireFeature(vendor, "courses");
  const productId = form.get("productId");
  if (typeof productId !== "string" || !productId || productId.length > 160) throw new Error("Invalid course.");
  const path = `/products/${encodeURIComponent(productId)}/lessons`;
  const chapterId = form.get("chapterId");
  // Only echoed back to locate the field error; renameCourseChapter validates it again.
  const chapterRef = typeof chapterId === "string" && chapterId.length > 0 && chapterId.length <= 160 ? encodeURIComponent(chapterId) : "";
  // A missing or malformed revision is a stale form, not a bad title.
  const rawRevision = form.get("revision");
  const revision = typeof rawRevision === "string" && /^\d+$/u.test(rawRevision) ? Number(rawRevision) : Number.NaN;
  if (!Number.isSafeInteger(revision)) redirect(`${path}?error=conflict`);
  let error: "invalid" | "duplicate" | "conflict" | null = null;
  try {
    await renameCourseChapter(getDb(), vendor.id, {
      productId, chapterId, revision, title: form.get("title"),
    });
  } catch (failure) {
    if (failure instanceof ZodError) error = "invalid";
    else if (failure instanceof ChapterTitleTaken || (failure instanceof Prisma.PrismaClientKnownRequestError && failure.code === "P2002")) error = "duplicate";
    else if (failure instanceof CurriculumConflict || (failure instanceof Prisma.PrismaClientKnownRequestError && failure.code === "P2034")) error = "conflict";
    else throw failure;
  }
  if (error === "conflict") redirect(`${path}?error=conflict`);
  if (error) redirect(`${path}?chapterError=${error}&chapter=${chapterRef}#chapter-${chapterRef}`);
  revalidatePath(path);
  revalidatePath(`/portal/${encodeURIComponent(vendor.slug)}`, "layout");
  redirect(`${path}?chapterSaved=1`);
}

/** A unique violation raised by Prisma (P2002) or by raw SQL (P2010 carrying SQLSTATE 23505). */
function isUniqueViolation(failure: unknown) {
  if (!(failure instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const meta = failure.meta as { code?: unknown } | undefined;
  return failure.code === "P2002" || meta?.code === "23505";
}

/** Shared by the chapter order, chapter delete and lesson move actions: same guard
 * order as the rename action (CSRF, manager, `courses` gate), the vendor comes from
 * the session, and a missing or malformed revision is a stale form. A transaction
 * conflict (serialization failure or deadlock, also when raw SQL reports it as P2010)
 * or a unique violation means the course changed under the form: "conflict".
 * `foreignKey` says what a foreign-key violation (P2003) means for this action. */
async function manageChapters(
  form: FormData,
  foreignKey: "notEmpty" | "conflict",
  run: (vendorId: string, productId: string, revision: number) => Promise<unknown>,
) {
  await assertServerActionSecurity(form);
  const vendor = await requireVendorManager();
  requireFeature(vendor, "courses");
  const productId = form.get("productId");
  if (typeof productId !== "string" || !productId || productId.length > 160) throw new Error("Invalid course.");
  const path = `/products/${encodeURIComponent(productId)}/lessons`;
  const rawRevision = form.get("revision");
  const revision = typeof rawRevision === "string" && /^\d+$/u.test(rawRevision) ? Number(rawRevision) : Number.NaN;
  if (!Number.isSafeInteger(revision)) redirect(`${path}?error=conflict`);
  let error: "invalid" | "notEmpty" | "conflict" | null = null;
  let changed = true;
  try {
    changed = (await run(vendor.id, productId, revision)) !== false;
  } catch (failure) {
    if (failure instanceof ZodError) error = "invalid";
    else if (failure instanceof ChapterNotEmpty) error = "notEmpty";
    else if (failure instanceof Prisma.PrismaClientKnownRequestError && failure.code === "P2003") error = foreignKey;
    else if (failure instanceof CurriculumConflict || isUniqueViolation(failure) || isTransientTransactionConflict(failure)) error = "conflict";
    else throw failure;
  }
  return { path, vendor, error, changed };
}

function chapterAnchor(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.length > 0 && value.length <= 160 ? encodeURIComponent(value) : "";
}

/** F-5 chapter ordering: one step up or down. */
export async function moveCourseChapterAction(form: FormData) {
  const chapterId = form.get("chapterId");
  const direction = form.get("direction");
  const done = await manageChapters(form, "conflict", (vendorId, productId, revision) => moveCourseChapter(getDb(), vendorId, { productId, chapterId, direction, revision }));
  if (done.error === "conflict") redirect(`${done.path}?error=conflict`);
  const anchor = chapterAnchor(chapterId);
  if (done.error) redirect(`${done.path}?chapterError=${done.error}&chapter=${anchor}#chapter-${anchor}`);
  if (!done.changed) redirect(`${done.path}?noChange=1#chapter-${anchor}`);
  revalidatePath(done.path);
  revalidatePath(`/portal/${encodeURIComponent(done.vendor.slug)}`, "layout");
  redirect(`${done.path}?chapterMoved=1#chapter-${anchor}`);
}

/** F-5: only an empty chapter can be deleted; lessons and progress are never touched. */
export async function deleteCourseChapterAction(form: FormData) {
  const chapterId = form.get("chapterId");
  const done = await manageChapters(form, "notEmpty", (vendorId, productId, revision) => deleteCourseChapter(getDb(), vendorId, { productId, chapterId, revision }));
  if (done.error === "conflict") redirect(`${done.path}?error=conflict`);
  const anchor = chapterAnchor(chapterId);
  if (done.error) redirect(`${done.path}?chapterError=${done.error}&chapter=${anchor}#chapter-${anchor}`);
  revalidatePath(done.path);
  revalidatePath(`/portal/${encodeURIComponent(done.vendor.slug)}`, "layout");
  redirect(`${done.path}?chapterDeleted=1`);
}

/** F-5: moves a lesson to the end of another chapter of the same course. */
export async function moveCourseLessonAction(form: FormData) {
  const lessonId = form.get("lessonId");
  const targetChapterId = form.get("targetChapterId");
  const done = await manageChapters(form, "conflict", (vendorId, productId, revision) => moveCourseLesson(getDb(), vendorId, { productId, lessonId, targetChapterId, revision }));
  if (done.error === "conflict") redirect(`${done.path}?error=conflict`);
  if (done.error) redirect(`${done.path}?error=invalid`);
  const anchor = chapterAnchor(targetChapterId);
  if (!done.changed) redirect(`${done.path}?noChange=1#chapter-${anchor}`);
  revalidatePath(done.path);
  revalidatePath(`/portal/${encodeURIComponent(done.vendor.slug)}`, "layout");
  redirect(`${done.path}?lessonMoved=1#chapter-${anchor}`);
}
