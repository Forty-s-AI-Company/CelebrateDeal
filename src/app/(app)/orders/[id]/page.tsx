import { notFound } from "next/navigation";
import { CommerceOrderDetail } from "@/components/commerce-order-detail";
import { PageHeader } from "@/components/ui";
import { requireVendorManagerMfa } from "@/lib/auth";
import { revealCommerceOrderPii, type CommerceOrderPii } from "@/lib/commerce-order-pii";
import {
  revealCustomCheckoutAnswers,
  safeParseCustomCheckoutFields,
  type CustomCheckoutAnswers,
  type CustomCheckoutFields,
} from "@/lib/commerce-custom-checkout";
import { commerceOrderDetailInclude } from "@/lib/commerce-order-read-model";
import { getDb } from "@/lib/db";

export default async function OrderDetailPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string | string[]; updated?: string | string[] }>;
}) {
  const { id } = await params;
  const { vendor } = await requireVendorManagerMfa(`/orders/${encodeURIComponent(id)}`);
  const order = await getDb().commerceOrder.findFirst({
    where: { id, vendorId: vendor.id },
    include: commerceOrderDetailInclude,
  });
  if (!order) notFound();

  let pii: CommerceOrderPii | null = null;
  try {
    pii = revealCommerceOrderPii({
      buyerEncrypted: order.buyerEncryptedEnvelope,
      shippingEncrypted: order.shippingEncryptedEnvelope,
    }, { vendorId: vendor.id, orderId: order.id });
  } catch {
    // The page remains useful with masks and fails closed for fulfillment PII.
  }
  const customCheckoutAnswersByItemId: Record<string, {
    fields: CustomCheckoutFields;
    answers: CustomCheckoutAnswers | null;
    unavailable: boolean;
  }> = {};
  // This second, tenant-scoped read deliberately selects only the envelope and
  // immutable definition snapshot after MFA has completed.
  const customItems = await getDb().commerceOrderItem.findMany({
    where: { vendorId: vendor.id, orderId: order.id },
    select: { id: true, nonSensitiveSnapshot: true, customCheckoutAnswersEncryptedEnvelope: true },
  });
  for (const item of customItems) {
    const snapshot = item.nonSensitiveSnapshot;
    const definition = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
      ? safeParseCustomCheckoutFields((snapshot as Record<string, unknown>).customCheckoutFields)
      : safeParseCustomCheckoutFields(undefined);
    if (!definition.success || !item.customCheckoutAnswersEncryptedEnvelope) {
      if (!definition.success || item.customCheckoutAnswersEncryptedEnvelope) {
        customCheckoutAnswersByItemId[item.id] = { fields: [], answers: null, unavailable: true };
      }
      continue;
    }
    try {
      customCheckoutAnswersByItemId[item.id] = {
        fields: definition.data,
        answers: revealCustomCheckoutAnswers(item.customCheckoutAnswersEncryptedEnvelope, definition.data, {
          vendorId: vendor.id,
          orderId: order.id,
          orderItemId: item.id,
        }),
        unavailable: false,
      };
    } catch {
      // Fail closed: never render a raw envelope or partial plaintext.
      customCheckoutAnswersByItemId[item.id] = { fields: definition.data, answers: null, unavailable: true };
    }
  }
  const query = await searchParams;
  const error = Array.isArray(query?.error) ? query?.error[0] : query?.error;
  const updated = Array.isArray(query?.updated) ? query?.updated[0] : query?.updated;
  return (
    <>
      <PageHeader title={`訂單 ${order.orderNumber}`} description="查看付款、買家資料、履約與退款事件；所有動作都有防重送與 revision 衝突保護。" />
      <CommerceOrderDetail order={order} pii={pii} customCheckoutAnswersByItemId={customCheckoutAnswersByItemId} feedback={{ error, updated }} />
    </>
  );
}
