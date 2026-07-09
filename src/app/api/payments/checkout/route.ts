import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";

const CheckoutRequest = z.object({
  vendorId: z.string().min(1),
  productId: z.string().optional(),
  amountCents: z.number().int().positive(),
  currency: z.string().default("TWD"),
  referralCode: z.string().optional(),
});

function orderNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CD-${stamp}-${suffix}`;
}

export async function POST(request: Request) {
  const parsed = CheckoutRequest.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid checkout request" }, { status: 400 });
  }

  const order = orderNumber();
  const transaction = await getDb().paymentTransaction.create({
    data: {
      vendorId: parsed.data.vendorId,
      providerName: process.env.PAYMENT_PROVIDER ?? "demo",
      orderNumber: order,
      paymentMode: "platform",
      grossAmountCents: parsed.data.amountCents,
      netAmountCents: parsed.data.amountCents,
      currency: parsed.data.currency,
      status: "pending",
      metadata: {
        productId: parsed.data.productId,
        referralCode: parsed.data.referralCode,
      },
    },
  });

  return NextResponse.json({
    ok: true,
    provider: process.env.PAYMENT_PROVIDER ?? "demo",
    orderNumber: order,
    transactionId: transaction.id,
    checkoutUrl: null,
    nextAction: "provider_checkout_adapter_pending",
  });
}
