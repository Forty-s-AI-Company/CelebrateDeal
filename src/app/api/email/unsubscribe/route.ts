import { NextResponse } from "next/server";
import { readFormDataBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { verifyEmailUnsubscribeToken } from "@/lib/email-delivery-pii";

function resultRedirect(request: Request, status: "done" | "invalid") {
  return NextResponse.redirect(new URL(`/unsubscribe?status=${status}`, request.url), { status: 303 });
}

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: false });
  if (sameOrigin) return sameOrigin;
  const formData = await readFormDataBody(request);
  const token = formData?.get("token");
  const deliveryId = typeof token === "string" && token.length <= 512
    ? verifyEmailUnsubscribeToken(token)
    : null;
  if (!deliveryId) return resultRedirect(request, "invalid");

  const db = getDb();
  const delivery = await db.emailDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      vendorId: true,
      recipientHash: true,
      recipientMaskedEmail: true,
    },
  });
  if (!delivery) return resultRedirect(request, "invalid");

  await db.$transaction(async (tx) => {
    await tx.emailSuppression.upsert({
      where: {
        vendorId_recipientHash: {
          vendorId: delivery.vendorId,
          recipientHash: delivery.recipientHash,
        },
      },
      create: {
        vendorId: delivery.vendorId,
        recipientHash: delivery.recipientHash,
        recipientMaskedEmail: delivery.recipientMaskedEmail,
        reason: "recipient_request",
        source: "unsubscribe_link",
      },
      update: {
        recipientMaskedEmail: delivery.recipientMaskedEmail,
        reason: "recipient_request",
        source: "unsubscribe_link",
        suppressedAt: new Date(),
        resubscribedAt: null,
      },
    });
    await tx.emailDelivery.updateMany({
      where: {
        vendorId: delivery.vendorId,
        recipientHash: delivery.recipientHash,
        status: { in: ["queued", "failed"] },
      },
      data: {
        status: "suppressed",
        nextAttemptAt: null,
        lastErrorCode: "recipient_suppressed",
      },
    });
  });
  return resultRedirect(request, "done");
}
