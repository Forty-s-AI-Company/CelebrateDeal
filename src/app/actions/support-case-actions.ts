"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireFinanceAdmin, requireVendorManagerMfa, requireVendorSupportMfa } from "@/lib/auth";
import {
  addSupportCaseNote,
  addSupportCaseCustomerReply,
  assignSupportCase,
  createSupportCase,
  requestSupportRefundHandoff,
  reviewSupportRefundHandoff,
  SUPPORT_CASE_CATEGORIES,
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_STATUSES,
  SupportCaseDomainError,
  transitionSupportCase,
} from "@/lib/support-case-domain";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";

const Identifier = z.string().trim().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/u);
const RequestKey = z.string().uuid();
const Category = z.enum(SUPPORT_CASE_CATEGORIES);
const Priority = z.enum(SUPPORT_CASE_PRIORITIES);
const Status = z.enum(SUPPORT_CASE_STATUSES);
const FinanceStatus = z.enum(["reviewing", "declined", "completed"]);

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function revision(formData: FormData) {
  const value = text(formData, "revision");
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function moneyToCents(value: string) {
  if (!/^\d{1,9}(?:\.\d{1,2})?$/u.test(value)) return null;
  const [whole, decimal = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function casePath(id: string, query?: string) {
  const path = `/support-cases/${encodeURIComponent(id)}`;
  return query ? `${path}?${query}` : path;
}

function adminHandoffPath(id: string, query?: string) {
  const path = `/admin/support-cases/${encodeURIComponent(id)}`;
  return query ? `${path}?${query}` : path;
}

async function serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return getDb().$transaction(operation, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

function refreshMerchantSupport(orderId: string, supportCaseId?: string) {
  revalidatePath("/support-cases");
  revalidatePath(`/orders/${encodeURIComponent(orderId)}`);
  if (supportCaseId) revalidatePath(casePath(supportCaseId));
}

export async function createSupportCaseAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const orderId = Identifier.safeParse(text(formData, "orderId"));
  const intakeKey = RequestKey.safeParse(text(formData, "intakeKey"));
  const category = Category.safeParse(text(formData, "category"));
  const priority = Priority.safeParse(text(formData, "priority"));
  if (!orderId.success || !intakeKey.success || !category.success || !priority.success) {
    redirect("/orders?error=support_invalid");
  }
  const context = await requireVendorManagerMfa(`/orders/${encodeURIComponent(orderId.data)}`);
  let supportCase;
  try {
    supportCase = await serializable((tx) => createSupportCase(tx, {
      vendorId: context.vendor.id,
      orderId: orderId.data,
      intakeKey: intakeKey.data,
      category: category.data,
      priority: priority.data,
      summary: text(formData, "summary"),
      actorMemberId: context.member.id,
    }));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const existing = await getDb().supportCase.findUnique({
        where: {
          vendorId_intakeKey: { vendorId: context.vendor.id, intakeKey: intakeKey.data },
        },
        select: { id: true, orderId: true },
      });
      if (existing) redirect(casePath(existing.id, "updated=duplicate_intake"));
    }
    redirect(`/orders/${encodeURIComponent(orderId.data)}?error=support_create`);
  }
  refreshMerchantSupport(orderId.data, supportCase.id);
  redirect(casePath(supportCase.id, "updated=created"));
}

export async function addSupportCaseNoteAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const supportCaseId = Identifier.safeParse(text(formData, "supportCaseId"));
  const expectedRevision = revision(formData);
  const dedupKey = RequestKey.safeParse(text(formData, "dedupKey"));
  const note = text(formData, "note");
  if (
    !supportCaseId.success
    || expectedRevision === null
    || !dedupKey.success
    || note.length < 1
    || note.length > 4_000
  ) {
    redirect("/support-cases?error=invalid_case");
  }
  const context = await requireVendorSupportMfa(casePath(supportCaseId.data));
  try {
    const updated = await serializable((tx) => addSupportCaseNote(tx, {
      vendorId: context.vendor.id,
      supportCaseId: supportCaseId.data,
      expectedRevision,
      dedupKey: dedupKey.data,
      note,
      actorMemberId: context.member.id,
    }));
    const supportCase = await getDb().supportCase.findFirst({
      where: { id: updated.id, vendorId: context.vendor.id },
      select: { orderId: true },
    });
    if (supportCase) refreshMerchantSupport(supportCase.orderId, updated.id);
  } catch {
    redirect(casePath(supportCaseId.data, "error=case_conflict"));
  }
  redirect(casePath(supportCaseId.data, "updated=note"));
}

export async function assignSupportCaseAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const supportCaseId = Identifier.safeParse(text(formData, "supportCaseId"));
  const assignedMemberId = Identifier.safeParse(text(formData, "assignedMemberId"));
  const expectedRevision = revision(formData);
  const dedupKey = RequestKey.safeParse(text(formData, "dedupKey"));
  if (!supportCaseId.success || !assignedMemberId.success || expectedRevision === null || !dedupKey.success) {
    redirect("/support-cases?error=invalid_case");
  }
  const context = await requireVendorManagerMfa(casePath(supportCaseId.data));
  try {
    await serializable((tx) => assignSupportCase(tx, {
      vendorId: context.vendor.id,
      supportCaseId: supportCaseId.data,
      expectedRevision,
      assignedMemberId: assignedMemberId.data,
      actorMemberId: context.member.id,
      dedupKey: dedupKey.data,
    }));
  } catch {
    redirect(casePath(supportCaseId.data, "error=case_conflict"));
  }
  revalidatePath("/support-cases");
  revalidatePath(casePath(supportCaseId.data));
  redirect(casePath(supportCaseId.data, "updated=assignment"));
}

export async function transitionSupportCaseAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const supportCaseId = Identifier.safeParse(text(formData, "supportCaseId"));
  const nextStatus = Status.safeParse(text(formData, "nextStatus"));
  const expectedRevision = revision(formData);
  const dedupKey = RequestKey.safeParse(text(formData, "dedupKey"));
  if (!supportCaseId.success || !nextStatus.success || expectedRevision === null || !dedupKey.success) {
    redirect("/support-cases?error=invalid_case");
  }
  const context = await requireVendorManagerMfa(casePath(supportCaseId.data));
  try {
    await serializable((tx) => transitionSupportCase(tx, {
      vendorId: context.vendor.id,
      supportCaseId: supportCaseId.data,
      expectedRevision,
      nextStatus: nextStatus.data,
      actorMemberId: context.member.id,
      dedupKey: dedupKey.data,
    }));
  } catch {
    redirect(casePath(supportCaseId.data, "error=invalid_transition"));
  }
  revalidatePath("/support-cases");
  revalidatePath(casePath(supportCaseId.data));
  redirect(casePath(supportCaseId.data, "updated=status"));
}

export async function addSupportCaseCustomerReplyAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const supportCaseId = Identifier.safeParse(text(formData, "supportCaseId"));
  const expectedRevision = revision(formData);
  const dedupKey = RequestKey.safeParse(text(formData, "dedupKey"));
  const message = text(formData, "message");
  if (
    !supportCaseId.success
    || expectedRevision === null
    || !dedupKey.success
    || message.length < 1
    || message.length > 4_000
  ) {
    redirect("/support-cases?error=invalid_case");
  }
  const context = await requireVendorSupportMfa(casePath(supportCaseId.data));
  try {
    await serializable((tx) => addSupportCaseCustomerReply(tx, {
      vendorId: context.vendor.id,
      supportCaseId: supportCaseId.data,
      expectedRevision,
      dedupKey: dedupKey.data,
      message,
      actorMemberId: context.member.id,
    }));
  } catch {
    redirect(casePath(supportCaseId.data, "error=case_conflict"));
  }
  revalidatePath("/support-cases");
  revalidatePath(casePath(supportCaseId.data));
  revalidatePath(`/support/requests/${encodeURIComponent(supportCaseId.data)}`);
  redirect(casePath(supportCaseId.data, "updated=customer_reply"));
}

export async function requestSupportRefundHandoffAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const supportCaseId = Identifier.safeParse(text(formData, "supportCaseId"));
  const expectedRevision = revision(formData);
  const dedupKey = RequestKey.safeParse(text(formData, "dedupKey"));
  const amount = moneyToCents(text(formData, "requestedAmount"));
  const reason = text(formData, "reason");
  if (
    !supportCaseId.success
    || expectedRevision === null
    || !dedupKey.success
    || amount === null
    || reason.length < 1
    || reason.length > 4_000
  ) {
    redirect("/support-cases?error=invalid_refund");
  }
  const context = await requireVendorManagerMfa(casePath(supportCaseId.data));
  try {
    const handoff = await serializable((tx) => requestSupportRefundHandoff(tx, {
      vendorId: context.vendor.id,
      supportCaseId: supportCaseId.data,
      expectedRevision,
      requestedAmountCents: amount,
      reason,
      actorMemberId: context.member.id,
      dedupKey: dedupKey.data,
    }));
    revalidatePath("/admin/support-cases");
    revalidatePath(adminHandoffPath(handoff.id));
  } catch {
    redirect(casePath(supportCaseId.data, "error=refund_unavailable"));
  }
  revalidatePath("/support-cases");
  revalidatePath(casePath(supportCaseId.data));
  redirect(casePath(supportCaseId.data, "updated=refund_requested"));
}

export async function reviewSupportRefundHandoffAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const handoffId = Identifier.safeParse(text(formData, "handoffId"));
  const expectedRevision = revision(formData);
  const nextStatus = FinanceStatus.safeParse(text(formData, "nextStatus"));
  const dedupKey = RequestKey.safeParse(text(formData, "dedupKey"));
  const submittedRefundIds = [
    ...formData.getAll("completedRefundIds"),
    formData.get("completedRefundId"),
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const completedRefundIds = submittedRefundIds.map((value) => Identifier.safeParse(value.trim()));
  const invalidRefundIds = completedRefundIds.some((result) => !result.success)
    || completedRefundIds.length > 50
    || new Set(submittedRefundIds.map((value) => value.trim())).size !== submittedRefundIds.length;
  if (
    !handoffId.success
    || expectedRevision === null
    || !nextStatus.success
    || !dedupKey.success
    || invalidRefundIds
    || (nextStatus.success && nextStatus.data === "completed" && completedRefundIds.length === 0)
  ) {
    redirect("/admin/support-cases?error=invalid_handoff");
  }
  const validatedRefundIds = completedRefundIds.map((result) => {
    if (!result.success) {
      throw new Error("Validated refund IDs unexpectedly contained an invalid value.");
    }
    return result.data;
  });
  const { user } = await requireFinanceAdmin();
  try {
    const handoff = await serializable((tx) => reviewSupportRefundHandoff(tx, {
      handoffId: handoffId.data,
      expectedRevision,
      nextStatus: nextStatus.data,
      actorUserId: user.id,
      completedRefundIds: validatedRefundIds,
      dedupKey: dedupKey.data,
    }));
    revalidatePath("/admin/support-cases");
    revalidatePath(adminHandoffPath(handoff.id));
    revalidatePath(`/support-cases/${encodeURIComponent(handoff.supportCaseId)}`);
  } catch (error) {
    const code = error instanceof SupportCaseDomainError ? error.code : "refund_conflict";
    redirect(adminHandoffPath(handoffId.data, `error=${encodeURIComponent(code)}`));
  }
  redirect(adminHandoffPath(handoffId.data, `updated=${nextStatus.data}`));
}
