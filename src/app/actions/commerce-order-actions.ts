"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  grantCommerceEntitlement,
  transitionServiceFulfillment,
  transitionShippingFulfillment,
} from "@/lib/commerce-order-fulfillment";
import { requireVendorManagerMfa } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";

const ShippingActionStatus = z.enum(["packing", "shipped", "delivered", "returned"]);
const ServiceActionStatus = z.enum(["scheduled", "completed"]);

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(formData: FormData, key: string) {
  return text(formData, key) || null;
}

function positiveRevision(formData: FormData) {
  const value = text(formData, "revision");
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function orderPath(orderId: string, query?: string) {
  const path = `/orders/${encodeURIComponent(orderId)}`;
  return query ? `${path}?${query}` : path;
}

function parseTaipeiLocalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) return null;
  const parsed = new Date(`${value}:00+08:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function runFulfillmentTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return getDb().$transaction(operation, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

function refreshOrder(orderId: string) {
  revalidatePath("/orders");
  revalidatePath(orderPath(orderId));
}

export async function transitionShippingFulfillmentAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const orderId = text(formData, "orderId");
  const context = await requireVendorManagerMfa(orderPath(orderId));
  const fulfillmentId = text(formData, "fulfillmentId");
  const revision = positiveRevision(formData);
  const nextStatus = ShippingActionStatus.safeParse(text(formData, "nextStatus"));
  if (!orderId || !fulfillmentId || revision === null || !nextStatus.success) {
    redirect(orderPath(orderId || "invalid", "error=invalid_fulfillment"));
  }

  try {
    const result = await runFulfillmentTransaction((tx) => transitionShippingFulfillment(tx, {
      vendorId: context.vendor.id,
      fulfillmentId,
      expectedRevision: revision,
      nextStatus: nextStatus.data,
      carrierName: optionalText(formData, "carrierName"),
      trackingNumber: optionalText(formData, "trackingNumber"),
      trackingUrl: optionalText(formData, "trackingUrl"),
      actor: { id: context.member.id },
    }));
    if (result.orderId !== orderId) throw new Error("Order identity mismatch.");
  } catch {
    redirect(orderPath(orderId, "error=fulfillment_conflict"));
  }

  refreshOrder(orderId);
  redirect(orderPath(orderId, "updated=shipping"));
}

export async function grantCommerceEntitlementAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const orderId = text(formData, "orderId");
  const context = await requireVendorManagerMfa(orderPath(orderId));
  const entitlementId = text(formData, "entitlementId");
  const revision = positiveRevision(formData);
  if (!orderId || !entitlementId || revision === null) {
    redirect(orderPath(orderId || "invalid", "error=invalid_fulfillment"));
  }

  try {
    const result = await runFulfillmentTransaction((tx) => grantCommerceEntitlement(tx, {
      vendorId: context.vendor.id,
      entitlementId,
      expectedRevision: revision,
      actor: { id: context.member.id },
    }));
    if (result.orderId !== orderId) throw new Error("Order identity mismatch.");
  } catch {
    redirect(orderPath(orderId, "error=fulfillment_conflict"));
  }

  refreshOrder(orderId);
  redirect(orderPath(orderId, "updated=entitlement"));
}

export async function transitionServiceFulfillmentAction(formData: FormData) {
  await assertServerActionSecurity(formData);
  const orderId = text(formData, "orderId");
  const context = await requireVendorManagerMfa(orderPath(orderId));
  const fulfillmentId = text(formData, "fulfillmentId");
  const revision = positiveRevision(formData);
  const nextStatus = ServiceActionStatus.safeParse(text(formData, "nextStatus"));
  const scheduledAt = nextStatus.success && nextStatus.data === "scheduled"
    ? parseTaipeiLocalDate(text(formData, "scheduledAt"))
    : null;
  if (
    !orderId
    || !fulfillmentId
    || revision === null
    || !nextStatus.success
    || (nextStatus.data === "scheduled" && !scheduledAt)
  ) {
    redirect(orderPath(orderId || "invalid", "error=invalid_fulfillment"));
  }

  try {
    const result = await runFulfillmentTransaction((tx) => transitionServiceFulfillment(tx, {
      vendorId: context.vendor.id,
      fulfillmentId,
      expectedRevision: revision,
      nextStatus: nextStatus.data,
      scheduledAt,
      actor: { id: context.member.id },
    }));
    if (result.orderId !== orderId) throw new Error("Order identity mismatch.");
  } catch {
    redirect(orderPath(orderId, "error=fulfillment_conflict"));
  }

  refreshOrder(orderId);
  redirect(orderPath(orderId, "updated=service"));
}
