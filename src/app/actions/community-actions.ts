"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createCommunityComment, createCommunityPost, toggleCommunityLike, type CommunityDatabase } from "@/lib/community";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { requireStudentPortalSession } from "@/lib/student-portal-auth";

const Slug = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const value = (data: FormData, key: string) => typeof data.get(key) === "string" ? String(data.get(key)) : "";

async function context(data: FormData) {
  await assertServerActionSecurity(data);
  const vendorSlug = Slug.parse(value(data, "vendorSlug"));
  const { session } = await requireStudentPortalSession(vendorSlug);
  return { vendorSlug, scope: { vendorId: session.vendorId, customerKeyHash: session.customerKeyHash }, db: getDb() as unknown as CommunityDatabase };
}

export async function createCommunityPostAction(data: FormData) {
  const { db, scope, vendorSlug } = await context(data);
  await createCommunityPost(db, { ...scope, authorName: value(data, "authorName") || "學員", body: value(data, "body") });
  revalidatePath(`/portal/${vendorSlug}/community`);
}

export async function createCommunityCommentAction(data: FormData) {
  const { db, scope, vendorSlug } = await context(data);
  await createCommunityComment(db, { ...scope, postId: value(data, "postId"), authorName: value(data, "authorName") || "學員", body: value(data, "body") });
  revalidatePath(`/portal/${vendorSlug}/community`);
}

export async function toggleCommunityLikeAction(data: FormData) {
  const { db, scope, vendorSlug } = await context(data);
  await toggleCommunityLike(db, { ...scope, postId: value(data, "postId") });
  revalidatePath(`/portal/${vendorSlug}/community`);
}
