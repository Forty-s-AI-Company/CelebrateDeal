"use server";

import { revalidatePath } from "next/cache";
import { assertServerActionSecurity } from "@/lib/csrf";
import { FunnelOperationsError, loadFunnelOperations, loadFunnelReports, saveFunnelOperations } from "@/lib/funnel-operations-service";

export async function readFunnelOperations(pageId: string) {
  return { editor: await loadFunnelOperations(pageId), reports: await loadFunnelReports(pageId) };
}

export async function updateFunnelOperations(form: FormData) {
  try {
    await assertServerActionSecurity(form);
    const raw = form.get("settings");
    if (typeof raw !== "string" || Buffer.byteLength(raw) > 16_384) return { ok: false as const, message: "設定資料過大或格式無效。" };
    const input = JSON.parse(raw) as unknown;
    const result = await saveFunnelOperations(input);
    revalidatePath("/landing-pages");
    return { ok: true as const, revision: result.revision, message: "設定已儲存。" };
  } catch (error) {
    return { ok: false as const, message: error instanceof FunnelOperationsError ? error.message : "無法儲存，請稍後重試；你的編輯仍保留。" };
  }
}
