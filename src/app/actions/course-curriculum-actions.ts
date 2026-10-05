"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { CurriculumConflict, saveCourseLesson } from "@/lib/course-curriculum";
import { getDb } from "@/lib/db";

export async function saveCourseLessonAction(form: FormData) {
  await assertServerActionSecurity(form);
  const vendor = await requireVendorManager();
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
    else if (failure instanceof CurriculumConflict || (failure instanceof Prisma.PrismaClientKnownRequestError && failure.code === "P2034")) error = "conflict";
    else throw failure;
  }
  if (error) redirect(`${path}?error=${error}`);
  revalidatePath(path);
  revalidatePath(`/portal/${encodeURIComponent(vendor.slug)}`, "layout");
  redirect(`${path}?saved=1`);
}
