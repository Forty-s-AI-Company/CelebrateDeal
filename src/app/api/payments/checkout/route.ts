import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getDb } from "@/lib/db";
import { getPaymentProvider } from "@/lib/payment-providers";
import type { CheckoutSessionResult } from "@/lib/payment-providers/types";
import { checkRateLimit } from "@/lib/rate-limit";

const CheckoutRequest = z.object({
  vendorId: z.string().min(1),
  productId: z.string().min(1),
  referralCode: z.string().optional(),
});

const FORM_SUBMISSION_COOKIE = "celebratedeal_form_submission";

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

  const parsed = CheckoutRequest.safeParse(await readJsonBody(request));
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

  if (product.inventory <= 0) {
    return NextResponse.json({ error: "Product is sold out" }, { status: 409 });
  }

  const cookieSubmissionId = formSubmissionIdFromRequest(request);
  const formSubmission = cookieSubmissionId
    ? await db.formSubmission.findFirst({
        where: { id: cookieSubmissionId, form: { vendorId: parsed.data.vendorId } },
        select: { id: true },
      })
    : null;
  const formSubmissionId = formSubmission?.id;
  const transactionMetadata = {
    productId: parsed.data.productId,
    productName: product.name,
    referralCode: parsed.data.referralCode,
    ...(formSubmissionId ? { formSubmissionId } : {}),
  };

  const order = orderNumber();
  const provider = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
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
      metadata: transactionMetadata,
    },
  });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  let checkoutSession: CheckoutSessionResult;
  try {
    checkoutSession = provider.createCheckoutSession
      ? await provider.createCheckoutSession({
          transaction,
          product,
          vendor: product.vendor,
          referralCode: parsed.data.referralCode,
          appUrl,
        })
      : {
          provider: provider.id,
          mode: "manual" as const,
          checkoutUrl: null,
          nextAction: "provider_checkout_adapter_pending",
          externalRequired: true,
        };
  } catch {
    await db.paymentTransaction.update({
      where: { id: transaction.id },
      data: { status: "failed" },
    });
    return NextResponse.json({ error: "Unable to start checkout" }, { status: 502 });
  }

  await db.paymentTransaction.update({
    where: { id: transaction.id },
    data: {
      metadata: {
        ...transactionMetadata,
        checkoutSession: {
          provider: checkoutSession.provider,
          mode: checkoutSession.mode,
          nextAction: checkoutSession.nextAction,
          externalRequired: checkoutSession.externalRequired ?? false,
        },
      } as Prisma.InputJsonObject,
    },
  });

  const response = NextResponse.json({
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

  if (formSubmissionId) {
    response.cookies.set(FORM_SUBMISSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: 0,
    });
  }

  return response;
}

function formSubmissionIdFromRequest(request: Request) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;

  const value = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${FORM_SUBMISSION_COOKIE}=`))?.slice(FORM_SUBMISSION_COOKIE.length + 1);
  return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
}
