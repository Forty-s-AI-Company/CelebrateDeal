import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { getPaymentProvider, UnsupportedPaymentProviderError } from "@/lib/payment-providers";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveRequestAttribution } from "@/lib/attribution";
import {
  ExternalStorefrontError,
  resolveExternalStorefrontRedirect,
} from "@/lib/external-storefront";

const CheckoutRequest = z.object({
  vendorId: z.string().min(1),
  productId: z.string().min(1),
});

function orderNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CD-${stamp}-${suffix}`;
}

export async function POST(request: Request) {
  const sameOrigin = requireSameOriginRequest(request, { requireClientHeader: true });
  if (sameOrigin) return sameOrigin;

  const limited = await checkRateLimit(request, "checkout", 20, 60_000);
  if (limited) return limited;

  const parsed = CheckoutRequest.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid checkout request" }, { status: 400 });
  }

  const db = getDb();
  const product = await db.product.findFirst({
    where: {
      id: parsed.data.productId,
      vendorId: parsed.data.vendorId,
      isActive: true,
    },
    include: { vendor: true },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not available" }, { status: 404 });
  }

  const attribution = await resolveRequestAttribution(request, product.vendorId);
  if (product.checkoutMode === "external") {
    try {
      const redirect = await resolveExternalStorefrontRedirect({
        vendorId: product.vendorId,
        productId: product.id,
        affiliateId: attribution?.affiliate.id,
      });
      return NextResponse.json({
        ok: true,
        checkoutMode: "external",
        redirectUrl: redirect.redirectUrl,
        trackingIdentity: {
          vendorId: product.vendorId,
          productId: product.id,
          affiliateId: attribution?.affiliate.id ?? null,
          referralCode: attribution?.affiliate.code ?? null,
          attributionClickId: attribution?.id ?? null,
          affiliateProductLinkId: redirect.affiliateProductLinkId,
        },
      });
    } catch (error) {
      if (!(error instanceof ExternalStorefrontError)) throw error;
      const status = error.code === "ownership_mismatch" ? 404 : 422;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
  }

  if (product.inventory <= 0) {
    return NextResponse.json({ error: "Product is sold out" }, { status: 409 });
  }

  const order = orderNumber();
  let provider: ReturnType<typeof getPaymentProvider>;
  try {
    provider = getPaymentProvider(process.env.PAYMENT_PROVIDER);
  } catch (error) {
    if (!(error instanceof UnsupportedPaymentProviderError)) throw error;
    return NextResponse.json({ error: "Payment service is not configured" }, { status: 503 });
  }
  const transaction = await db.paymentTransaction.create({
    data: {
      vendorId: parsed.data.vendorId,
      providerName: provider.id,
      orderNumber: order,
      paymentMode: "platform",
      grossAmountCents: product.priceCents,
      netAmountCents: product.priceCents,
      currency: product.currency,
      status: "pending",
      metadata: {
        productId: parsed.data.productId,
        productName: product.name,
        referralCode: attribution?.affiliate.code,
        affiliateId: attribution?.affiliate.id,
        commissionRateBps: attribution?.affiliate.commissionRateBps,
        attributionPolicyVersion: attribution?.policyVersion,
        attributionClickId: attribution?.id,
      },
    },
  });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const checkoutSession = provider.createCheckoutSession
    ? await provider.createCheckoutSession({
        transaction,
        product,
        vendor: product.vendor,
        referralCode: attribution?.affiliate.code,
        appUrl,
      })
    : {
        provider: provider.id,
        mode: "manual" as const,
        checkoutUrl: null,
        nextAction: "provider_checkout_adapter_pending",
        externalRequired: true,
      };

  await db.paymentTransaction.update({
    where: { id: transaction.id },
    data: {
      metadata: {
        productId: parsed.data.productId,
        productName: product.name,
        referralCode: attribution?.affiliate.code,
        affiliateId: attribution?.affiliate.id,
        commissionRateBps: attribution?.affiliate.commissionRateBps,
        attributionPolicyVersion: attribution?.policyVersion,
        attributionClickId: attribution?.id,
        checkoutSession: {
          provider: checkoutSession.provider,
          mode: checkoutSession.mode,
          nextAction: checkoutSession.nextAction,
          externalRequired: checkoutSession.externalRequired ?? false,
        },
      } as Prisma.InputJsonObject,
    },
  });

  return NextResponse.json({
    ok: true,
    provider: checkoutSession.provider,
    orderNumber: order,
    transactionId: transaction.id,
    amountCents: product.priceCents,
    currency: product.currency,
    checkoutUrl: checkoutSession.checkoutUrl,
    formAction: checkoutSession.formAction,
    formMethod: checkoutSession.formMethod,
    formPayload: checkoutSession.formPayload,
    nextAction: checkoutSession.nextAction,
    externalRequired: checkoutSession.externalRequired ?? false,
  });
}
