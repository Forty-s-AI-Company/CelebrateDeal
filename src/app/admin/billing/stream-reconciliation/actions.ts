"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireFinanceAdmin } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import {
  importStreamUsageReconciliation,
  resolveStreamUsageReconciliation,
  StreamUsageReconciliationError,
} from "@/lib/stream-usage-reconciliation";

const PAGE_PATH = "/admin/billing/stream-reconciliation";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function requiredInteger(formData: FormData, key: string) {
  const raw = text(formData, key);
  if (!/^\d+$/.test(raw)) return Number.NaN;
  return Number.parseInt(raw, 10);
}

function optionalInteger(formData: FormData, key: string) {
  const raw = text(formData, key);
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) return Number.NaN;
  return Number.parseInt(raw, 10);
}

function safeDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return new Date(Number.NaN);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(Number.NaN) : date;
}

function knownErrorCode(error: unknown) {
  return error instanceof StreamUsageReconciliationError ? error.code : null;
}

export async function importStreamUsageReconciliationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const provider = text(formData, "provider").toUpperCase();
  const sourceReference = text(formData, "sourceReference");

  let outcome: Awaited<ReturnType<typeof importStreamUsageReconciliation>>;
  try {
    outcome = await importStreamUsageReconciliation({
      vendorId: text(formData, "vendorId"),
      provider,
      monthKey: text(formData, "monthKey"),
      sourceDigest: text(formData, "sourceDigest").toLowerCase(),
      sourceReference: sourceReference || null,
      providerWatchMinutes: requiredInteger(formData, "providerWatchMinutes"),
      providerStorageMinutes: optionalInteger(formData, "providerStorageMinutes"),
      capturedAt: safeDate(text(formData, "capturedAt")),
      actorId: member.id,
      actorLabel: member.role,
    });
  } catch (error) {
    const code = knownErrorCode(error);
    if (code) redirect(`${PAGE_PATH}?error=${encodeURIComponent(code)}`);
    throw error;
  }

  revalidatePath(PAGE_PATH);
  revalidatePath("/billing/usage");
  redirect(`${PAGE_PATH}?status=${outcome.duplicate ? "duplicate" : "imported"}`);
}

export async function resolveStreamUsageReconciliationAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const { member } = await requireFinanceAdmin();
  const resolution = text(formData, "resolution");

  try {
    await resolveStreamUsageReconciliation({
      id: text(formData, "id"),
      resolution: resolution as "ACCEPT_INTERNAL" | "ACCEPT_PROVIDER" | "ESCALATED",
      note: text(formData, "note"),
      actorId: member.id,
      actorLabel: member.role,
    });
  } catch (error) {
    const code = knownErrorCode(error);
    if (code) redirect(`${PAGE_PATH}?error=${encodeURIComponent(code)}`);
    throw error;
  }

  revalidatePath(PAGE_PATH);
  revalidatePath("/billing/usage");
  redirect(`${PAGE_PATH}?status=resolved`);
}
