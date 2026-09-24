import { createHash } from "node:crypto";
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
import { parseCheckoutInvoiceSelection } from "@/lib/taiwan-invoice-validator";
import { createInvoiceCheckoutIdentityHash } from "@/lib/taiwan-invoice-request";
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
import { resolvePublishedFunnelCheckout, type ResolvedFunnelCheckout } from "@/lib/funnel-commerce-service";
import {
  AUTOMATION_VOUCHER_COOKIE,
  resolveEligibleAutomationVoucherClaim,
} from "@/lib/live-interaction";
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

class VoucherClaimConflictError extends Error {}

type EligibleAutomationVoucherClaim = {
  id: string;
  source: "automation";
  discountAmountCents: number;
} | null;

type CheckoutRequestData = z.infer<typeof CheckoutRequest>;
type CheckoutAdmission = NonNullable<ReturnType<typeof verifyCheckoutAdmission>>;
const existingCheckoutInclude = {
  primaryCommerceOrder: {
    select: {
      id: true,
      vendorId: true,
      checkoutIdempotencyKey: true,
      checkoutIdentityHash: true,
      totalAmountCents: true,
      currency: true,
      items: {
        select: {
          productId: true,
          productSlug: true,
          lineIndex: true,
          fulfillmentType: true,
          unitPriceCents: true,
          nonSensitiveSnapshot: true,
        },
        orderBy: { lineIndex: "asc" },
      },
    },
  },
} as const satisfies Prisma.PaymentTransactionInclude;
type ExistingCheckoutTransaction = Prisma.PaymentTransactionGetPayload<{ include: typeof existingCheckoutInclude }>;
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

function requestCookie(request: Request, name: string) {
  for (const segment of (request.headers.get("cookie") ?? "").split(";").slice(0, 100)) {
    const separator = segment.indexOf("=");
    if (separator <= 0 || segment.slice(0, separator).trim() !== name) continue;
    const value = segment.slice(separator + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/u.test(value) ? value : null;
  }
  return null;
}

async function eligibleAutomationVoucherClaim(
  request: Request,
  input: { vendorId: string; productId: string; priceCents: number; currency: string },
): Promise<EligibleAutomationVoucherClaim> {
  return resolveEligibleAutomationVoucherClaim(
    getDb(),
    requestCookie(request, AUTOMATION_VOUCHER_COOKIE),
    input,
  );
}

async function consumeAutomationVoucherClaim(
  tx: Prisma.TransactionClient,
  claim: EligibleAutomationVoucherClaim,
  input: { vendorId: string; orderId: string; now: Date },
) {
  if (!claim) return;
  const consumed = await tx.automationVoucherGrant.updateMany({
    where: {
      id: claim.id,
      vendorId: input.vendorId,
      usedOrderId: null,
      expiresAt: { gt: input.now },
    },
    data: { usedOrderId: input.orderId, redeemedAt: input.now },
  });
  if (consumed.count !== 1) throw new VoucherClaimConflictError();
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
  voucherClaimId?: string;
  discountAmountCents?: number;
  checkoutAmountCents?: number;
  orderBumpProductId?: string;
  orderBumpPriceCents?: number;
  funnel?: ResolvedFunnelCheckout;
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
    ...(input.voucherClaimId ? { voucherClaimId: input.voucherClaimId } : {}),
    ...(input.discountAmountCents ? { discountAmountCents: input.discountAmountCents } : {}),
    ...(input.checkoutAmountCents ? { checkoutAmountCents: input.checkoutAmountCents } : {}),
    ...(input.orderBumpProductId ? { orderBumpProductId: input.orderBumpProductId } : {}),
    ...(input.orderBumpPriceCents ? { orderBumpPriceCents: input.orderBumpPriceCents } : {}),
    ...(input.funnel ? {
      funnel: {
        slug: input.funnel.reference.slug,
        stepId: input.funnel.reference.stepId,
        pageId: input.funnel.pageId,
        version: input.funnel.version,
        productRevision: input.funnel.product.revision,
        ...(input.funnel.orderBump ? { orderBumpRevision: input.funnel.orderBump.revision } : {}),
        ...(input.funnel.binding.agreement ? { agreementLabel: input.funnel.binding.agreement.label } : {}),
      },
    } : {}),
    ...(wp4SourceBoundTransactionMetadata("buyer_order", { productId: input.productId }) ?? {}),
  };
}

async function resolveFunnelCheckoutRequest(
  database: ReturnType<typeof getDb>,
  data: CheckoutRequestData,
  existing: { status: string } | null,
) {
  if (!data.funnel) return { ok: true as const, funnel: undefined };
  const funnel = await resolvePublishedFunnelCheckout(
    data.funnel,
    database,
    existing?.status === "pending" ? { allowReservedInventory: true } : undefined,
  );
  if (!funnel) return { ok: false as const, response: NextResponse.json({ error: "Funnel checkout is no longer available" }, { status: 409 }) };
  const requestMatchesBinding = data.vendorId === funnel.vendorId
    && data.productId === funnel.product.id
    && (!data.orderBump || Boolean(funnel.orderBump && data.orderBump.productId === funnel.orderBump.id))
    && (!funnel.binding.agreement || data.agreementAccepted === true);
  const snapshotMatches = data.funnel.expectedVersion === funnel.version
    && data.funnel.expectedProductRevision === funnel.product.revision
    && (!data.orderBump || data.funnel.expectedOrderBumpRevision === funnel.orderBump?.revision);
  if (!requestMatchesBinding || (existing?.status !== "pending" && !snapshotMatches)) {
    return { ok: false as const, response: NextResponse.json({ error: "Funnel checkout details changed; reload checkout" }, { status: 409 }) };
  }
  return { ok: true as const, funnel };
}

async function resolveCheckoutOrderBump(
  database: ReturnType<typeof getDb>,
  data: CheckoutRequestData,
  product: { id: string; currency: string; fulfillmentType: CommerceCheckoutFulfillmentType },
  projectId?: string,
) {
  const requested = data.orderBump;
  if (!requested) return { ok: true as const, orderBumpProduct: null };
  const orderBumpProduct = await database.product.findFirst({
    where: {
      vendorId: data.vendorId,
      ...(requested.productId ? { id: requested.productId } : { slug: requested.sku }),
      isActive: true,
      fulfillmentTypeConfirmed: true,
      priceCents: { gt: 0 },
      ...(projectId ? { salesProjectLinks: { some: { vendorId: data.vendorId, projectId } } } : {}),
    },
    include: { deliveryConfig: { select: { status: true, fulfillmentType: true } } },
  });
  if (
    !orderBumpProduct
    || orderBumpProduct.id === product.id
    || orderBumpProduct.currency !== product.currency
    || (product.fulfillmentType !== "physical" && orderBumpProduct.fulfillmentType === "physical")
    || unavailableCheckoutProductResponse(orderBumpProduct)
  ) {
    return { ok: false as const, response: NextResponse.json({ error: "Order bump not available" }, { status: 409 }) };
  }
  return { ok: true as const, orderBumpProduct };
}

function funnelProductSnapshotResponse(
  funnel: ResolvedFunnelCheckout | undefined,
  product: { id: string; revision: number },
  orderBumpProduct: { id: string; revision: number } | null,
) {
  if (funnel && (funnel.product.id !== product.id || funnel.product.revision !== product.revision)) {
    return NextResponse.json({ error: "Funnel checkout details changed; reload checkout" }, { status: 409 });
  }
  if (funnel && orderBumpProduct && (!funnel.orderBump
    || funnel.orderBump.id !== orderBumpProduct.id
    || funnel.orderBump.revision !== orderBumpProduct.revision)) {
    return NextResponse.json({ error: "Funnel checkout details changed; reload checkout" }, { status: 409 });
  }
  return null;
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

function validateCheckoutInvoice(
  data: CheckoutRequestData,
  baseCheckoutIdentityHash: string,
) {
  const invoiceSelection = parseCheckoutInvoiceSelection(data.invoice ?? { type: "personal", carrier: "member" });
  if (!invoiceSelection) {
    return { ok: false as const, response: NextResponse.json({ error: "Invalid invoice selection" }, { status: 400 }) };
  }
  return {
    ok: true as const,
    invoiceSelection,
    hasExplicitInvoiceSelection: data.invoice !== undefined,
    checkoutIdentityHash: data.invoice === undefined
      ? baseCheckoutIdentityHash
      : createInvoiceCheckoutIdentityHash(baseCheckoutIdentityHash, invoiceSelection),
  };
}

function bindOrderBumpCheckoutIdentity(baseCheckoutIdentityHash: string, orderBumpProductId: string | null) {
  return orderBumpProductId
    ? createHash("sha256").update(`${baseCheckoutIdentityHash}\u0000order-bump\u0000${orderBumpProductId}`).digest("base64url")
    : baseCheckoutIdentityHash;
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

type ExistingCheckoutOrder = NonNullable<ExistingCheckoutTransaction["primaryCommerceOrder"]>;
type ExistingCheckoutOrderItem = ExistingCheckoutOrder["items"][number];

function replayBumpMatches(
  data: CheckoutRequestData,
  bumpId: string | null,
  bumpItem: ExistingCheckoutOrderItem | undefined,
) {
  if (bumpId === null) return data.orderBump === undefined;
  const requested = data.orderBump;
  return Boolean(
    requested
    && bumpItem?.productId === bumpId
    && (requested.productId === undefined || requested.productId === bumpId)
    && (requested.sku === undefined || requested.sku === bumpItem.productSlug),
  );
}

function replayOrderSnapshotMatches(
  transaction: ExistingCheckoutTransaction,
  order: ExistingCheckoutOrder,
  primaryItem: ExistingCheckoutOrderItem | undefined,
  data: CheckoutRequestData,
  bumpId: string | null,
  metadata: Record<string, unknown>,
) {
  return order.vendorId === data.vendorId
    && order.checkoutIdempotencyKey === data.idempotencyKey
    && order.totalAmountCents === transaction.grossAmountCents
    && order.currency === transaction.currency
    && (typeof metadata.checkoutAmountCents !== "number" || metadata.checkoutAmountCents === order.totalAmountCents)
    && order.items.length === (bumpId ? 2 : 1)
    && primaryItem?.productId === data.productId;
}

function replayFunnelMatches(data: CheckoutRequestData, metadata: Record<string, unknown>, bumpId: string | null) {
  if (!metadata.funnel) return data.funnel === undefined;
  if (!data.funnel) return false;
  const stored = metadataObject(metadata.funnel);
  return data.funnel.slug === stored.slug
    && data.funnel.stepId === stored.stepId
    && data.funnel.expectedVersion === stored.version
    && data.funnel.expectedProductRevision === stored.productRevision
    && (bumpId === null || data.funnel.expectedOrderBumpRevision === stored.orderBumpRevision)
    && (typeof stored.agreementLabel !== "string" || data.agreementAccepted === true);
}

async function existingCheckoutResponse({
  request,
  transaction,
  data,
}: {
  request: Request;
  transaction: ExistingCheckoutTransaction;
  data: CheckoutRequestData;
}) {
  const metadata = metadataObject(transaction.metadata);
  const order = transaction.primaryCommerceOrder;
  const primaryItem = order?.items.find((item) => item.lineIndex === 0);
  const bumpItem = order?.items.find((item) => item.lineIndex === 1);
  const bumpId = typeof metadata.orderBumpProductId === "string" ? metadata.orderBumpProductId : null;
  if (
    transaction.vendorId !== data.vendorId
    || transaction.checkoutIdempotencyKey !== data.idempotencyKey
    || metadata.productId !== data.productId
    || !replayBumpMatches(data, bumpId, bumpItem)
  ) {
    return NextResponse.json({ error: "Idempotency key already used for another checkout" }, { status: 409 });
  }

  if (!order) {
    return NextResponse.json({ error: "Checkout already in progress" }, { status: 425 });
  }
  if (!replayOrderSnapshotMatches(transaction, order, primaryItem, data, bumpId, metadata) || !primaryItem) {
    return NextResponse.json({ error: "Checkout snapshot unavailable" }, { status: 503 });
  }

  // Replays use the immutable order snapshot. A merchant may edit or deactivate
  // the product, bump, delivery settings, or Funnel after the session was saved.
  const snapshot = metadataObject(primaryItem.nonSensitiveSnapshot);
  if (!Array.isArray(snapshot.customCheckoutFields)) {
    return NextResponse.json({ error: "Checkout snapshot unavailable" }, { status: 503 });
  }
  if (!replayFunnelMatches(data, metadata, bumpId)) {
    return NextResponse.json({ error: "Idempotency key already used for another checkout" }, { status: 409 });
  }
  const customCheckout = validateCustomCheckoutAnswersForProduct(snapshot.customCheckoutFields, data.customCheckoutAnswers);
  if (!customCheckout.ok) return customCheckout.response;
  const identity = validateCheckoutIdentity(
    data,
    data.vendorId,
    primaryItem.fulfillmentType,
    data.productId,
    customCheckout.fields,
    customCheckout.answers,
  );
  if (!identity.ok) return identity.response;
  const invoice = validateCheckoutInvoice(data, identity.checkoutIdentityHash);
  if (!invoice.ok) return invoice.response;
  const checkoutIdentityHash = bindOrderBumpCheckoutIdentity(invoice.checkoutIdentityHash, bumpId);
  if (order.checkoutIdentityHash !== checkoutIdentityHash) {
    return NextResponse.json({ error: "Idempotency key already used for another checkout" }, { status: 409 });
  }

  const checkoutSession = storedCheckoutSession(transaction.metadata);
  if (transaction.status !== "pending") {
    return NextResponse.json({ error: "Checkout request already finished" }, { status: 409 });
  }
  if (!checkoutSession || checkoutSession.provider !== transaction.providerName) {
    return NextResponse.json({ error: "Checkout already in progress" }, { status: 425 });
  }
  const formSubmissionId = typeof metadata.formSubmissionId === "string" ? metadata.formSubmissionId : null;
  try {
    const buyerSupportCookie = await issueBuyerSupportGrant(getDb(), {
      request,
      vendorId: transaction.vendorId,
      orderId: order.id,
    });
    return checkoutResponse({
      request,
      transaction,
      product: { priceCents: primaryItem.unitPriceCents, currency: order.currency },
      checkoutSession,
      formSubmissionId,
      buyerSupportCookie,
    });
  } catch {
    return NextResponse.json({ error: "Checkout support access unavailable" }, { status: 503 });
  }
}

// The route intentionally keeps the admission, scope, revision and idempotency
// guards in one auditable transaction boundary; the surrounding helpers keep
// provider and persistence details out of this control flow.
// eslint-disable-next-line complexity
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
  const existing = await db.paymentTransaction.findUnique({
    where: {
      vendorId_checkoutIdempotencyKey: {
        vendorId: parsed.data.vendorId,
        checkoutIdempotencyKey: parsed.data.idempotencyKey,
      },
    },
    include: existingCheckoutInclude,
  });
  if (existing) return await existingCheckoutResponse({ request, transaction: existing, data: parsed.data });
  const funnelResult = await resolveFunnelCheckoutRequest(db, parsed.data, existing);
  if (!funnelResult.ok) return funnelResult.response;
  const funnel = funnelResult.funnel;
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
  const orderBumpResult = await resolveCheckoutOrderBump(db, parsed.data, product, funnel?.projectId);
  if (!orderBumpResult.ok) return orderBumpResult.response;
  const { orderBumpProduct } = orderBumpResult;

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
  const { pii: checkoutPii, checkoutIdentityHash: baseCheckoutIdentityHash } = identity;
  const invoice = validateCheckoutInvoice(parsed.data, baseCheckoutIdentityHash);
  if (!invoice.ok) return invoice.response;
  const { invoiceSelection, hasExplicitInvoiceSelection } = invoice;

  if (admission.productRevision !== product.revision) {
    return NextResponse.json({ error: "Product changed; reload checkout" }, { status: 409 });
  }
  const funnelSnapshotResponse = funnelProductSnapshotResponse(funnel, product, orderBumpProduct);
  if (funnelSnapshotResponse) return funnelSnapshotResponse;

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
  const voucherClaim = await eligibleAutomationVoucherClaim(request, {
    vendorId: parsed.data.vendorId,
    productId: product.id,
    priceCents: product.priceCents,
    currency: product.currency,
  });
  const discountAmountCents = voucherClaim?.discountAmountCents ?? 0;
  const checkoutAmountCents = product.priceCents + (orderBumpProduct?.priceCents ?? 0) - discountAmountCents;
  const transactionMetadata = checkoutTransactionMetadata({
    productId: parsed.data.productId,
    productName: product.name,
    coursePolicySnapshot,
    referralCode,
    affiliateClickId: affiliateAttribution?.affiliateClickId,
    formSubmissionId,
    sourceLiveId,
    voucherClaimId: voucherClaim?.id,
    discountAmountCents,
    checkoutAmountCents,
    ...(orderBumpProduct ? { orderBumpProductId: orderBumpProduct.id, orderBumpPriceCents: orderBumpProduct.priceCents } : {}),
    funnel,
  });

  const order = orderNumber();
  let transaction;
  let commerceOrderId: string | null = null;
  try {
    transaction = await createReservedPaymentTransaction({
      vendorId: parsed.data.vendorId,
      productId: product.id,
      expectedProductRevision: product.revision,
      ...(orderBumpProduct ? { additionalProducts: [{ productId: orderBumpProduct.id, expectedProductRevision: orderBumpProduct.revision }] } : {}),
      checkoutIdempotencyKey: parsed.data.idempotencyKey,
      transactionData: {
        vendorId: parsed.data.vendorId,
        checkoutIdempotencyKey: parsed.data.idempotencyKey,
        providerName: provider.id,
        orderNumber: order,
        paymentMode: "platform",
        grossAmountCents: checkoutAmountCents,
        netAmountCents: checkoutAmountCents,
        currency: product.currency,
        status: "pending",
        metadata: transactionMetadata,
      },
      createCommerceOrder: async (tx, createdTransaction) => {
        const commerceOrder = await createCommerceOrderForCheckout(tx, {
          vendorId: parsed.data.vendorId,
          productId: product.id,
          projectId: funnel?.projectId,
          orderNumber: createdTransaction.orderNumber ?? order,
          checkoutIdempotencyKey: parsed.data.idempotencyKey,
          paymentTransactionId: createdTransaction.id,
          totalAmountCents: checkoutAmountCents,
          discountAmountCents,
          ...(orderBumpProduct ? { orderBumpProductId: orderBumpProduct.id } : {}),
          currency: product.currency,
          buyer: checkoutPii.buyer,
          shipping: checkoutPii.shipping,
          customCheckoutAnswers: customCheckout.answers,
          ...(hasExplicitInvoiceSelection ? { invoiceSelection } : {}),
        });
        await consumeAutomationVoucherClaim(tx, voucherClaim, {
          vendorId: parsed.data.vendorId,
          orderId: commerceOrder.id,
          now: new Date(),
        });
        commerceOrderId = commerceOrder.id;
      },
    });
  } catch (error) {
    if (error instanceof CheckoutIdempotencyConflictError) {
      const winner = await db.paymentTransaction.findUnique({
        where: { id: error.transactionId },
        include: existingCheckoutInclude,
      });
      if (winner) return await existingCheckoutResponse({ request, transaction: winner, data: parsed.data });
    }
    if (error instanceof InventoryUnavailableError) {
      return NextResponse.json({ error: "Product is sold out" }, { status: 409 });
    }
    if (error instanceof ProductChangedError) {
      return NextResponse.json({ error: "Product changed; reload checkout" }, { status: 409 });
    }
    if (error instanceof VoucherClaimConflictError) {
      return NextResponse.json({ error: "Voucher already used or expired" }, { status: 409 });
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
