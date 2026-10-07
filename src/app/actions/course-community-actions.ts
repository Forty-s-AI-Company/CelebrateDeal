"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { moderateCourseCommunity } from "@/lib/course-community";

export async function moderateCourseCommunityAction(form: FormData) {
  await assertServerActionSecurity(form);
  const { vendor, auth } = await requireVendorManagerContext();
  const productId = form.get("productId");
  if (typeof productId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/u.test(productId)) throw new Error("Invalid course");
  const result = await moderateCourseCommunity(getDb(), { vendorId: vendor.id, role: auth.member!.role }, {
    productId, postId: form.get("postId"), expectedRevision: Number(form.get("expectedRevision")), isPinned: form.get("isPinned") === "on", isAnnouncement: form.get("isAnnouncement") === "on", hidden: form.get("hidden") === "on",
  });
  const path = `/products/${encodeURIComponent(productId)}/community`;
  if (!result) redirect(`${path}?error=unavailable`);
  revalidatePath(path);
  revalidatePath(`/portal/${encodeURIComponent(vendor.slug)}/learn/${encodeURIComponent(productId)}/community`);
  redirect(`${path}?saved=1`);
}
