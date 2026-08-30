import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireVendorManagerMfa } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { transitionShippingFulfillment } from "@/lib/commerce-order-fulfillment";

const ShippingActionStatus = z.enum(["packing", "shipped", "delivered", "returned"]);

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

async function runFulfillmentTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
  return getDb().$transaction(operation, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

function refreshOrder(orderId: string) {
  revalidatePath("/orders");
  revalidatePath(orderPath(orderId));
}

/**
 * Completes the shipping transition while leaving the final navigation to the
 * caller. Server Actions and native POST routes therefore share the exact
 * same CSRF, MFA, tenant, CAS and failure handling.
 */
export async function completeShippingFulfillment(formData: FormData) {
  await assertServerActionSecurity(formData);
  const orderId = text(formData, "orderId");
  const context = await requireVendorManagerMfa(orderPath(orderId));
  const fulfillmentId = text(formData, "fulfillmentId");
  const revision = positiveRevision(formData);
  const nextStatus = ShippingActionStatus.safeParse(text(formData, "nextStatus"));
  if (!orderId || !fulfillmentId || revision === null || !nextStatus.success) {
    return orderPath(orderId || "invalid", "error=invalid_fulfillment");
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
    return orderPath(orderId, "error=fulfillment_conflict");
  }

  refreshOrder(orderId);
  return orderPath(orderId, "updated=shipping");
}
