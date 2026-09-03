import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { readJsonBody, requireSameOriginRequest } from "@/lib/api-security";
import { getCanonicalAppUrl, getPaymentReturnAppUrl } from "@/lib/app-url";
import {
  checkoutRequiresPhone,
  checkoutRequiresShipping,
  CommerceCheckoutRequestSchema,
  type CommerceCheckoutFulfillmentType,
} from "@/lib/commerce-checkout";
import {
  checkoutSessionTokenFromRequest,
  verifyCheckoutAdmission,
} from "@/lib/checkout-admission";
import {
  CommerceOrderPiiValidationError,
  createCommerceOrderIdentityHash,
  parseCommerceOrderPii,
  type CommerceOrderPii,
} from "@/lib/commerce-order-pii";
import { createCommerceOrderForCheckout } from "@/lib/commerce-orders";
import {
  CommerceCustomCheckoutValidationError,
  createCustomCheckoutIdentityHash,
  parseCustomCheckoutFields,
  validateCustomCheckoutAnswers,
} from "@/lib/commerce-custom-checkout";
import { getDb } from "@/lib/db";
import {
  CheckoutIdempotencyConflictError,
  createReservedPaymentTransaction,
  failPendingCheckoutAndReleaseInventory,
  InventoryUnavailableError,
  ProductChangedError,
} from "@/lib/inventory-reservations";
import { coursePolicySnapshotFromProduct } from "@/lib/course-policy-snapshot";
import { isExplicitLocalE2eRuntime } from "@/lib/app-url";
import { getPaymentProvider } from "@/lib/payment-providers";
import {
  checkoutReadinessAllowsNewTransaction,
  checkoutSessionHasUsableDestination,
  type CheckoutProviderReadiness,
  type CheckoutSessionResult,
} from "@/lib/payment-providers/types";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buyerSupportCookieOptions,
  issueBuyerSupportGrant,
  type BuyerSupportCookie,
} from "@/lib/buyer-support-access";
import { allowsLegacyAffiliateAttribution } from "@/lib/live-quota-policy";
import { wp4SourceBoundTransactionMetadata } from "@/lib/wp4-source-bound-transaction";
import {
  ATTRIBUTION_TTL_SECONDS,
  attributionCookieFromRequest,
  normalizeReferralCode,
  visitorIdFromRequest,
} from "@/lib/team-funnel-attribution";

const CheckoutRequest = CommerceCheckoutRequestSchema.extend({
  // Kept only for backward-compatible request parsing. Attribution remains
  // server-owned and this value is never trusted or persisted.
  referralCode: z.string().max(128).optional(),
});

const FORM_SUBMISSION_COOKIE = "celebratedeal_form_submission";

type CheckoutRequestData = z.infer<typeof CheckoutRequest>;
type CheckoutAdmission = NonNullable<ReturnType<typeof verifyCheckoutAdmission>>;
type CheckoutAdmissionResult =
  | { ok: true; admission: CheckoutAdmission }
  | { ok: false; response: NextResponse };

function validatedCheckoutAdmission(
  request: Request,
  data: CheckoutRequestData,
): CheckoutAdmissionResult {
  let admission;
  try {
    admission = verifyCheckoutAdmission({
      admissionToken: data.admissionToken,
      sessionToken: checkoutSessionTokenFromRequest(request),
    });
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Checkout admission unavailable" }, { status: 503 }),
    };
  }
  if (
    !admission
    || admission.vendorId !== data.vendorId
    || admission.productId !== data.productId
    || admission.idempotencyKey !== data.idempotencyKey
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Checkout admission expired or invalid" }, { status: 409 }),
    };
  }
  return { ok: true, admission };
}

function orderNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `CD-${stamp}-${suffix}`;
}

function metadataObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function hasReadyProductDelivery(product: {
  fulfillmentType: string;
  deliveryConfig: { status: string; fulfillmentType: string } | null;
}) {
  return product.fulfillmentType === "physical"
    || (
      product.deliveryConfig?.status === "active"
      && product.deliveryConfig.fulfillmentType === product.fulfillmentType
    );
}

function unavailableCheckoutProductResponse(product: {
  checkoutUrl: string | null;
  fulfillmentType: string;
  deliveryConfig: { status: string; fulfillmentType: string } | null;
}) {
  if (product.checkoutUrl) {
    return NextResponse.json({ error: "External checkout required" }, { status: 409 });
  }
  if (!hasReadyProductDelivery(product)) {
    return NextResponse.json({ error: "Product delivery is not ready" }, { status: 409 });
  }
  return null;
}

function checkoutTransactionMetadata(input: {
  productId: string;
  productName: string;
  coursePolicySnapshot: ReturnType<typeof coursePolicySnapshotFromProduct>;
  referralCode?: string;
  affiliateClickId?: string;
  formSubmissionId?: string;
  /** Only assigned from a server-validated, verified registration. */
  sourceLiveId?: string;
}) {
  return {
    // This server-owned marker distinguishes a merchant buyer checkout from
    // the two platform billing flows during the fixed WP4 Sandbox runner.
    // It is not supplied by the browser and is retained with the immutable
    // product identity below.
    billingPurpose: "buyer_order",
    productId: input.productId,
    productName: input.productName,
    ...(input.coursePolicySnapshot ? { coursePolicySnapshot: input.coursePolicySnapshot } : {}),
    ...(input.referralCode ? { referralCode: input.referralCode } : {}),
    ...(input.affiliateClickId ? { affiliateClickId: input.affiliateClickId } : {}),
    ...(input.formSubmissionId ? { formSubmissionId: input.formSubmissionId } : {}),
    ...(input.sourceLiveId ? { sourceLiveId: input.sourceLiveId } : {}),
    ...(wp4SourceBoundTransactionMetadata("buyer_order", { productId: input.productId }) ?? {}),
  };
}

type ValidatedCheckoutIdentity =
  | { ok: true; pii: CommerceOrderPii; checkoutIdentityHash: string }
  | { ok: false; response: NextResponse };

function validateCheckoutIdentity(
  input: { buyer: unknown; shipping?: unknown },
  vendorId: string,
  fulfillmentType: CommerceCheckoutFulfillmentType,
  productId: string,
  customCheckoutFields: unknown,
  customCheckoutAnswers: unknown,
): ValidatedCheckoutIdentity {
  let pii: CommerceOrderPii;
  try {
    pii = parseCommerceOrderPii({ buyer: input.buyer, shipping: input.shipping ?? null });
  } catch (error) {
    const status = error instanceof CommerceOrderPiiValidationError ? 400 : 503;
    const message = status === 400
      ? "Invalid buyer or shipping details"
      : "Unable to validate checkout";
    return { ok: false, response: NextResponse.json({ error: message }, { status }) };
  }

  if (
    (checkoutRequiresShipping(fulfillmentType) && !pii.shipping)
    || (!checkoutRequiresShipping(fulfillmentType) && pii.shipping)
    || (checkoutRequiresPhone(fulfillmentType) && !pii.buyer.phone)
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid buyer or shipping details" }, { status: 400 }),
    };
  }

  try {
    return {
      ok: true,
      pii,
      checkoutIdentityHash: createCustomCheckoutIdentityHash({
        vendorId,
        productId,
        basePiiHash: createCommerceOrderIdentityHash(pii, vendorId),
        definitions: customCheckoutFields,
        answers: customCheckoutAnswers,
      }),
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unable to validate checkout" }, { status: 503 }),
    };
  }
}

function validateCustomCheckoutAnswersForProduct(definitions: unknown, input: unknown) {
  try {
    const fields = parseCustomCheckoutFields(definitions);
    return { ok: true as const, fields, answers: validateCustomCheckoutAnswers(fields, input) };
  } catch (error) {
    return error instanceof CommerceCustomCheckoutValidationError
      ? { ok: false as const, response: NextResponse.json({ error: "Invalid custom checkout answers" }, { status: 400 }) }
      : { ok: false as const, response: NextResponse.json({ error: "Custom checkout fields unavailable" }, { status: 503 }) };
  }
}

function checkoutSessionMetadata(session: CheckoutSessionResult) {
  return {
    provider: session.provider,
    mode: session.mode,
    ...(session.checkoutUrl ? { checkoutUrl: session.checkoutUrl } : {}),
    ...(session.formAction ? { formAction: session.formAction } : {}),
    ...(session.formMethod ? { formMethod: session.formMethod } : {}),
    ...(session.formPayload ? { formPayload: session.formPayload } : {}),
    nextAction: session.nextAction,
    externalRequired: session.externalRequired ?? false,
  } as Prisma.InputJsonObject;
}

function admittedCheckoutProvider() {
  try {
    const provider = getPaymentProvider(process.env.PAYMENT_PROVIDER ?? "demo");
    const readiness = provider.checkoutReadiness();
    return checkoutReadinessAllowsNewTransaction(
      readiness,
      process.env.NODE_ENV,
      isExplicitLocalE2eRuntime(),
    ) ? { provider, readiness } : null;
  } catch {
    return null;
  }
}

async function createUsableCheckoutSession(
  provider: ReturnType<typeof getPaymentProvider>,
  readiness: CheckoutProviderReadiness,
  input: Parameters<NonNullable<ReturnType<typeof getPaymentProvider>["createCheckoutSession"]>>[0],
) {
  const session = provider.createCheckoutSession
    ? await provider.createCheckoutSession(input)
    : {
        provider: provider.id,
        mode: "manual" as const,
        checkoutUrl: null,
        nextAction: "provider_checkout_adapter_pending",
        externalRequired: true,
      };
  if (!checkoutSessionHasUsableDestination(session, readiness)) {
    throw new Error("Payment provider returned no usable checkout destination.");
  }
  return session;
}

function storedCheckoutSession(metadata: unknown): CheckoutSessionResult | null {
  const stored = metadataObject(metadataObject(metadata).checkoutSession);
  if (typeof stored.provider !== "string" || typeof stored.nextAction !== "string") return null;
  if (stored.mode !== "redirect" && stored.mode !== "form_post" && stored.mode !== "manual") return null;

  const rawPayload = metadataObject(stored.formPayload);
  const formPayload = Object.fromEntries(
    Object.entries(rawPayload).filter(([name, value]) => (
      /^[A-Za-z0-9_.-]{1,128}$/.test(name)
      && typeof value === "string"
      && value.length <= 4096
    )),
  ) as Record<string, string>;

  if (stored.mode === "redirect" && typeof stored.checkoutUrl !== "string") return null;
  if (stored.mode === "form_post" && (
    typeof stored.formAction !== "string"
    || stored.formMethod !== "POST"
    || Object.keys(formPayload).length === 0
  )) return null;

  return {
    provider: stored.provider,
    mode: stored.mode,
    checkoutUrl: typeof stored.checkoutUrl === "string" ? stored.checkoutUrl : null,
    ...(typeof stored.formAction === "string" ? { formAction: stored.formAction } : {}),
    ...(stored.formMethod === "POST" ? { formMethod: "POST" as const } : {}),
    ...(Object.keys(formPayload).length > 0 ? { formPayload } : {}),
    nextAction: stored.nextAction,
    externalRequired: typeof stored.externalRequired === "boolean" ? stored.externalRequired : false,
  };
}

function checkoutResponse({
  request,
  transaction,
  product,
  checkoutSession,
  formSubmissionId,
  buyerSupportCookie,
}: {
  request: Request;
  transaction: { id: string; orderNumber: string | null; grossAmountCents: number; currency: string; metadata?: unknown };
  product: { priceCents: number; currency: string };
  checkoutSession: CheckoutSessionResult;
  formSubmissionId: string | null;
  buyerSupportCookie: BuyerSupportCookie;
}) {
  const secureCookie = process.env.NODE_ENV === "production"
    || new URL(request.url).protocol === "https:";
  const response = NextResponse.json(
    {
      ok: true,
      provider: checkoutSession.provider,
      orderNumber: transaction.orderNumber ?? transaction.id,
      transactionId: transaction.id,
      amountCents: transaction.grossAmountCents || product.priceCents,
      currency: transaction.currency || product.currency,
      checkoutUrl: checkoutSession.checkoutUrl,
      formAction: checkoutSession.formAction,
      formMethod: checkoutSession.formMethod,
      formPayload: checkoutSession.formPayload,
      nextAction: checkoutSession.nextAction,
      externalRequired: checkoutSession.externalRequired ?? false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );

  if (formSubmissionId) {
    response.cookies.set(FORM_SUBMISSION_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: secureCookie,
      path: "/",
      maxAge: 0,
    });
  }
  response.cookies.set(
    buyerSupportCookie.name,
    buyerSupportCookie.value,
    buyerSupportCookieOptions({
      expiresAt: buyerSupportCookie.expiresAt,
      secure: secureCookie,
    }),
  );

  return response;
}

async function existingCheckoutResponse({
  request,
  transaction,
  product,
  checkoutIdentityHash,
}: {
  request: Request;
  transaction: {
    id: string;
    vendorId: string;
    providerName: string;
    checkoutIdempotencyKey: string | null;
    orderNumber: string | null;
    grossAmountCents: number;
    currency: string;
    status: string;
    metadata: unknown;
    primaryCommerceOrder: { id: string; checkoutIdentityHash: string } | null;
  };
  product: { id: string; vendorId: string; priceCents: number; currency: string };
  checkoutIdentityHash: string;
}) {
  const metadata = metadataObject(transaction.metadata);
  if (
    transaction.vendorId !== product.vendorId
    || metadata.productId !== product.id
    || transaction.grossAmountCents !== product.priceCents
    || transaction.currency !== product.currency
  ) {
    return NextResponse.json({ error: "Idempotency key already used for another checkout" }, { status: 409 });
  }

  if (!transaction.primaryCommerceOrder) {
    return NextResponse.json({ error: "Checkout already in progress" }, { status: 425 });
  }
  if (transaction.primaryCommerceOrder.checkoutIdentityHash !== checkoutIdentityHash) {
    return NextResponse.json({ error: "Idempotency key already used for another checkout" }, { status: 409 });
  }

  const checkoutSession = storedCheckoutSession(transaction.metadata);
  if (transaction.status !== "pending") {
    return NextResponse.json({ error: "Checkout request already finished" }, { status: 409 });
  }
  if (!checkoutSession) {
    return NextResponse.json({ error: "Checkout already in progress" }, { status: 425 });
  }
  const formSubmissionId = typeof metadata.formSubmissionId === "string" ? metadata.formSubmissionId : null;
  try {
    const buyerSupportCookie = await issueBuyerSupportGrant(getDb(), {
      request,
      vendorId: transaction.vendorId,
      orderId: transaction.primaryCommerceOrder.id,
    });
    return checkoutResponse({ request, transaction, product, checkoutSession, formSubmissionId, buyerSupportCookie });
  } catch {
    return NextResponse.json({ error: "Checkout support access unavailable" }, { status: 503 });
  }
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

  const admissionResult = validatedCheckoutAdmission(request, parsed.data);
  if (!admissionResult.ok) return admissionResult.response;
  const { admission } = admissionResult;

  const db = getDb();
  const product = await db.product.findFirst({
    where: {
      id: parsed.data.productId,
      vendorId: parsed.data.vendorId,
      isActive: true,
      fulfillmentTypeConfirmed: true,
      priceCents: { gt: 0 },
    },
    include: {
      vendor: true,
      deliveryConfig: {
        select: { id: true, status: true, fulfillmentType: true },
      },
    },
  });

  if (!product) {
    return NextResponse.json({ error: "Product not available" }, { status: 404 });
  }
  const unavailableProductResponse = unavailableCheckoutProductResponse(product);
  if (unavailableProductResponse) return unavailableProductResponse;

  // Use the database definition, never a definition supplied by the browser.
  const customCheckout = validateCustomCheckoutAnswersForProduct(product.customCheckoutFields, parsed.data.customCheckoutAnswers);
  if (!customCheckout.ok) return customCheckout.response;

  const identity = validateCheckoutIdentity(
    parsed.data,
    parsed.data.vendorId,
    product.fulfillmentType,
    product.id,
    customCheckout.fields,
    customCheckout.answers,
  );
  if (!identity.ok) return identity.response;
  const { pii: checkoutPii, checkoutIdentityHash } = identity;

  const existing = await db.paymentTransaction.findUnique({
    where: {
      vendorId_checkoutIdempotencyKey: {
        vendorId: parsed.data.vendorId,
        checkoutIdempotencyKey: parsed.data.idempotencyKey,
      },
    },
    include: { primaryCommerceOrder: { select: { id: true, checkoutIdentityHash: true } } },
  });
  if (existing) {
    return await existingCheckoutResponse({ request, transaction: existing, product, checkoutIdentityHash });
  }

  if (admission.productRevision !== product.revision) {
    return NextResponse.json({ error: "Product changed; reload checkout" }, { status: 409 });
  }

  const admittedProvider = admittedCheckoutProvider();
  if (!admittedProvider) {
    return NextResponse.json({ error: "Checkout is temporarily unavailable" }, { status: 503 });
  }
  const { provider, readiness: checkoutReadiness } = admittedProvider;

  if (product.inventory <= 0) {
    return NextResponse.json({ error: "Product is sold out" }, { status: 409 });
  }

  const affiliateAttribution = await affiliateAttributionFromRequest(request, parsed.data.vendorId);
  const formSubmission = await verifiedLiveRegistrationFromRequest(request, parsed.data.vendorId);
  const formSubmissionId = formSubmission?.id;
  const sourceLiveId = formSubmission?.liveId ?? undefined;
  // Checkout attribution must come from the server-validated click only. Request
  // data can contain a forged referralCode and must never affect the transaction
  // or payment-provider metadata.
  const referralCode = affiliateAttribution?.referralCode;
  const coursePolicySnapshot = coursePolicySnapshotFromProduct(product);
  const transactionMetadata = checkoutTransactionMetadata({
    productId: parsed.data.productId,
    productName: product.name,
    coursePolicySnapshot,
    referralCode,
    affiliateClickId: affiliateAttribution?.affiliateClickId,
    formSubmissionId,
    sourceLiveId,
  });

  const order = orderNumber();
  let transaction;
  let commerceOrderId: string | null = null;
  try {
    transaction = await createReservedPaymentTransaction({
      vendorId: parsed.data.vendorId,
      productId: product.id,
      expectedProductRevision: product.revision,
      checkoutIdempotencyKey: parsed.data.idempotencyKey,
      transactionData: {
        vendorId: parsed.data.vendorId,
        checkoutIdempotencyKey: parsed.data.idempotencyKey,
        providerName: provider.id,
        orderNumber: order,
        paymentMode: "platform",
        grossAmountCents: product.priceCents,
        netAmountCents: product.priceCents,
        currency: product.currency,
        status: "pending",
        metadata: transactionMetadata,
      },
      createCommerceOrder: async (tx, createdTransaction) => {
        const commerceOrder = await createCommerceOrderForCheckout(tx, {
          vendorId: parsed.data.vendorId,
          productId: product.id,
          orderNumber: createdTransaction.orderNumber ?? order,
          checkoutIdempotencyKey: parsed.data.idempotencyKey,
          paymentTransactionId: createdTransaction.id,
          totalAmountCents: product.priceCents,
          currency: product.currency,
          buyer: checkoutPii.buyer,
          shipping: checkoutPii.shipping,
          customCheckoutAnswers: customCheckout.answers,
        });
        commerceOrderId = commerceOrder.id;
      },
    });
  } catch (error) {
    if (error instanceof CheckoutIdempotencyConflictError) {
      const winner = await db.paymentTransaction.findUnique({
        where: { id: error.transactionId },
        include: { primaryCommerceOrder: { select: { id: true, checkoutIdentityHash: true } } },
      });
      if (winner) return await existingCheckoutResponse({ request, transaction: winner, product, checkoutIdentityHash });
    }
    if (error instanceof InventoryUnavailableError) {
      return NextResponse.json({ error: "Product is sold out" }, { status: 409 });
    }
    if (error instanceof ProductChangedError) {
      return NextResponse.json({ error: "Product changed; reload checkout" }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to start checkout" }, { status: 502 });
  }
  let checkoutSession: CheckoutSessionResult;
  try {
    const appUrl = getCanonicalAppUrl();
    checkoutSession = await createUsableCheckoutSession(provider, checkoutReadiness, {
      transaction,
      product,
      vendor: product.vendor,
      referralCode,
      appUrl,
      returnAppUrl: getPaymentReturnAppUrl(request),
    });
  } catch {
    try {
      await failPendingCheckoutAndReleaseInventory({
        vendorId: parsed.data.vendorId,
        transactionId: transaction.id,
        reason: "provider_checkout_failed",
      });
    } catch {
      // Keep the provider failure response generic when the recovery write also fails.
    }
    return NextResponse.json({ error: "Unable to start checkout" }, { status: 502 });
  }

  try {
    await db.paymentTransaction.update({
      where: { id: transaction.id },
      data: {
        metadata: {
          ...transactionMetadata,
          checkoutSession: checkoutSessionMetadata(checkoutSession),
        } as Prisma.InputJsonObject,
      },
    });
  } catch {
    try {
      await failPendingCheckoutAndReleaseInventory({
        vendorId: parsed.data.vendorId,
        transactionId: transaction.id,
        reason: "checkout_metadata_failed",
      });
    } catch {
      // Keep the metadata persistence failure response generic when the recovery write also fails.
    }
    return NextResponse.json({ error: "Unable to start checkout" }, { status: 502 });
  }

  if (!commerceOrderId) {
    return NextResponse.json({ error: "Checkout support access unavailable" }, { status: 503 });
  }
  try {
    const buyerSupportCookie = await issueBuyerSupportGrant(db, {
      request,
      vendorId: parsed.data.vendorId,
      orderId: commerceOrderId,
    });
    return checkoutResponse({
      request,
      transaction: { ...transaction, metadata: transactionMetadata },
      product,
      checkoutSession,
      formSubmissionId: formSubmissionId ?? null,
      buyerSupportCookie,
    });
  } catch {
    return NextResponse.json({ error: "Checkout support access unavailable" }, { status: 503 });
  }
}

async function affiliateAttributionFromRequest(request: Request, vendorId: string) {
  const cookie = attributionCookieFromRequest(request);
  if (!cookie || cookie.visitorId !== visitorIdFromRequest(request)) return null;

  const click = await getDb().affiliateClick.findFirst({
    where: {
      id: cookie.clickId,
      vendorId,
      visitorId: cookie.visitorId,
      createdAt: { gte: new Date(Date.now() - ATTRIBUTION_TTL_SECONDS * 1000) },
      OR: [
        { affiliate: { is: { vendorId, isActive: true } } },
        { teamAttribution: { is: { vendorId } } },
      ],
    },
    select: {
      id: true,
      referralCode: true,
      affiliateId: true,
      affiliate: { select: { code: true, vendorId: true, isActive: true } },
      live: { select: { quotaPolicy: true } },
      teamAttribution: { select: { id: true } },
    },
  });
  const referralCode = normalizeReferralCode(click?.referralCode);
  const legacyAffiliateAllowed = !click?.live || allowsLegacyAffiliateAttribution(click.live.quotaPolicy);
  const hasVerifiedAffiliate = Boolean(
    legacyAffiliateAllowed
    && click?.affiliateId
    && referralCode
    && click.affiliate?.vendorId === vendorId
    && click.affiliate.isActive
    && click.affiliate?.code === referralCode
  );

  if (!click || (!hasVerifiedAffiliate && !click.teamAttribution)) return null;
  return {
    affiliateClickId: click.id,
    ...(hasVerifiedAffiliate && referralCode ? { referralCode } : {}),
  };
}

function formSubmissionIdFromRequest(request: Request) {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;

  const value = cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${FORM_SUBMISSION_COOKIE}=`))?.slice(FORM_SUBMISSION_COOKIE.length + 1);
  return value && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
}

async function verifiedLiveRegistrationFromRequest(request: Request, vendorId: string) {
  const submissionId = formSubmissionIdFromRequest(request);
  if (!submissionId) return null;

  // The browser never sends a live ID. Attribution is attached only when its
  // existing, httpOnly registration cookie resolves to this vendor's verified
  // submission and an actual live relation.
  return getDb().formSubmission.findFirst({
    where: {
      id: submissionId,
      verificationStatus: "VERIFIED",
      form: { vendorId },
      live: { is: { vendorId } },
    },
    select: { id: true, liveId: true },
  });
}
