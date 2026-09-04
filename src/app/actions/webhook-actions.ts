"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFinanceAdmin } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { retryWebhookEvent } from "@/lib/webhook-retry";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function retryWebhookEventAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const id = text(formData, "id");
  const event = await getDb().webhookEvent.findUnique({ where: { id } });
  if (!event) redirect("/admin/billing/dashboard?error=webhook");
  if (event.retryCount >= event.maxRetries) redirect("/admin/billing/dashboard?error=max_retries");
  await retryWebhookEvent(id, member.role);

  revalidatePath("/admin/billing/dashboard");
  revalidatePath("/admin/billing/webhooks");
  revalidatePath(`/admin/billing/webhooks/${id}`);
  redirect("/admin/billing/dashboard");
}
