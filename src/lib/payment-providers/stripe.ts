import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentWebhookPayload } from "@/lib/payment-webhooks";
import {
  PaymentQueryProviderError,
  RefundProviderError,
  type CheckoutSessionInput,
  type PaymentProviderAdapter,
  type ProviderNormalizeResult,
  type QueryPaymentInput,
  type PaymentQueryResult,
  type RefundPaymentInput,
} from "@/lib/payment-providers/types";

const STRIPE_API_URL = "https://api.stripe.com/v1";
const STRIPE_CHECKOUT_HOST = "checkout.stripe.com";
const STRIPE_SUPPORTED_CURRENCIES = new Set(["TWD", "USD", "HKD", "EUR", "SGD"]);
const WEBHOOK_TOLERANCE_SECONDS = 300;

export type StripeProviderConfig = {
  secretKey?: string;
  webhookSecret?: string;
};

export type StripeTransport = (url: string, init: RequestInit) => Promise<Response>;

export type StripeProviderOptions = {
  /** Injection point for offline tests; production uses the platform fetch. */
  transport?: StripeTransport;
  getConfig?: () => StripeProviderConfig;
  now?: () => number;
};

type StripeObject = Record<string, unknown>;

function configuredStripe(): StripeProviderConfig {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY?.trim(),
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim(),
  };
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()) {
    throw new Error(`Invalid Stripe ${field}.`);
  }
  return value;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() && value === value.trim() ? value : undefined;
}

function validCurrency(value: unknown) {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!STRIPE_SUPPORTED_CURRENCIES.has(currency)) throw new Error("Unsupported Stripe currency.");
  return currency;
}

function safeAmount(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`Invalid Stripe ${field}.`);
  return value as number;
}

function stripePaymentIntentId(value: unknown) {
  const id = requiredText(value, "payment intent reference");
  // A strict opaque identifier protects the URL path and refuses card values.
  if (!/^pi_[A-Za-z0-9]+$/.test(id)) throw new Error("Invalid Stripe payment intent reference.");
  return id;
}

function requestUrl(path: string) {
  return `${STRIPE_API_URL}${path}`;
}

function formBody(values: Record<string, string | number>) {
  return new URLSearchParams(Object.entries(values).map(([key, value]) => [key, String(value)])).toString();
}

function checkoutUrl(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid Stripe Checkout URL.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid Stripe Checkout URL.");
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== STRIPE_CHECKOUT_HOST) {
    throw new Error("Invalid Stripe Checkout URL.");
  }
  return parsed.toString();
}

function parseJsonObject(raw: string) {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid Stripe response.");
  return parsed as StripeObject;
}

function callbackUrl(appUrl: string, outcome: "success" | "cancel") {
  const url = new URL("/checkout/result", appUrl);
  url.searchParams.set("payment", outcome);
  if (outcome === "success") url.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  return url.toString();
}

function paymentEventType(type: string, object: StripeObject) {
  if (["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(type)) {
    // Completing Checkout does not settle delayed payment methods.
    if (object.payment_status !== "paid") throw new Error("Stripe Checkout payment is not settled.");
    return "paid" as const;
  }
  if (["payment_intent.succeeded", "charge.succeeded"].includes(type)) return "paid" as const;
  if (type === "charge.refunded") {
    const refunded = safeAmount(object.amount_refunded ?? object.amount, "refund amount");
    const gross = safeAmount(object.amount, "gross amount");
    return refunded === gross ? "refunded" as const : "partially_refunded" as const;
  }
  if (["payment_intent.payment_failed", "charge.failed", "checkout.session.async_payment_failed"].includes(type)) return "failed" as const;
  throw new Error("Unsupported Stripe event type.");
}

function webhookObject(rawBody: string) {
  const event = parseJsonObject(rawBody);
  const eventId = requiredText(event.id, "event ID");
  const type = requiredText(event.type, "event type");
  const data = event.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid Stripe event data.");
  const object = (data as StripeObject).object;
  if (!object || typeof object !== "object" || Array.isArray(object)) throw new Error("Invalid Stripe event object.");
  return { event, eventId, type, object: object as StripeObject };
}

function objectMetadata(object: StripeObject) {
  const metadata = object.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as StripeObject : {};
}

function parseStripeSignature(value: string | null) {
  if (!value || value.length > 4096) return undefined;
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of value.split(",")) {
    const [key, candidate] = part.split("=", 2);
    if (key === "t" && /^\d{1,12}$/.test(candidate ?? "")) timestamp = Number(candidate);
    if (key === "v1" && candidate && /^[a-fA-F0-9]{64}$/.test(candidate)) signatures.push(candidate.toLowerCase());
  }
  return timestamp === undefined || signatures.length === 0 ? undefined : { timestamp, signatures };
}

function stripeApiHeaders(secretKey: string, idempotencyKey?: string): HeadersInit {
  return {
    authorization: `Bearer ${secretKey}`,
    "content-type": "application/x-www-form-urlencoded",
    ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
  };
}

function refundContext(input: RefundPaymentInput) {
  const { transaction, refundAmountCents, requestId } = input;
  const paymentIntent = stripePaymentIntentId(transaction.providerTradeNo);
  const grossAmountCents = safeAmount(transaction.grossAmountCents, "transaction amount");
  const refundedAmountCents = safeAmount(transaction.refundedAmountCents, "transaction refunded amount");
  if (
    transaction.providerName !== "stripe"
    || !Number.isSafeInteger(refundAmountCents)
    || refundAmountCents <= 0
    || refundAmountCents > grossAmountCents - refundedAmountCents
    || !/^[A-Za-z0-9_-]{1,128}$/.test(requestId)
  ) throw new RefundProviderError("request_contract");
  return { paymentIntent, refundAmountCents, requestId };
}

function queryContext(input: QueryPaymentInput) {
  const { transaction } = input;
  let paymentIntent: string;
  try {
    paymentIntent = stripePaymentIntentId(transaction.providerTradeNo);
  } catch {
    throw new PaymentQueryProviderError("request_contract");
  }
  if (
    transaction.providerName !== "stripe"
    || !Number.isSafeInteger(transaction.grossAmountCents)
    || transaction.grossAmountCents <= 0
    || !Number.isSafeInteger(transaction.refundedAmountCents)
    || transaction.refundedAmountCents < 0
  ) throw new PaymentQueryProviderError("request_contract");
  return { paymentIntent, transaction };
}

export function createStripePaymentProvider(options: StripeProviderOptions = {}): PaymentProviderAdapter {
  const transport = options.transport ?? fetch;
  const getConfig = options.getConfig ?? configuredStripe;
  const now = options.now ?? Date.now;

  return {
    id: "stripe",
    checkoutReadiness() {
      const secretKey = getConfig().secretKey;
      return secretKey && /^sk_(?:test|live)_[A-Za-z0-9_]+$/.test(secretKey) ? "ready" : "unavailable";
    },
    async createCheckoutSession(input: CheckoutSessionInput) {
      const secretKey = getConfig().secretKey;
      if (!secretKey || !/^sk_(?:test|live)_[A-Za-z0-9_]+$/.test(secretKey)) {
        throw new Error("Stripe payment provider is unavailable.");
      }
      const amount = safeAmount(input.transaction.grossAmountCents, "checkout amount");
      if (amount <= 0) throw new Error("Invalid Stripe checkout amount.");
      const currency = validCurrency(input.transaction.currency);
      const name = input.product?.name ?? input.billingPlan?.name ?? input.description;
      if (!name || !name.trim()) throw new Error("Stripe checkout requires a server-selected product or billing plan.");
      const orderNumber = input.transaction.orderNumber ?? input.transaction.id;
      if (!orderNumber || orderNumber !== orderNumber.trim()) throw new Error("Invalid Stripe order number.");

      const body = formBody({
        mode: "payment",
        success_url: callbackUrl(input.returnAppUrl ?? input.appUrl, "success"),
        cancel_url: callbackUrl(input.returnAppUrl ?? input.appUrl, "cancel"),
        client_reference_id: input.transaction.id,
        "line_items[0][price_data][currency]": currency.toLowerCase(),
        "line_items[0][price_data][product_data][name]": name.trim().slice(0, 250),
        "line_items[0][price_data][unit_amount]": amount,
        "line_items[0][quantity]": 1,
        "metadata[transactionId]": input.transaction.id,
        "metadata[orderNumber]": orderNumber,
        "metadata[vendorId]": input.vendor.id,
        // Stripe does not copy Session metadata to its PaymentIntent.
        "payment_intent_data[metadata][transactionId]": input.transaction.id,
        "payment_intent_data[metadata][orderNumber]": orderNumber,
        "payment_intent_data[metadata][vendorId]": input.vendor.id,
      });
      let response: Response;
      try {
        response = await transport(requestUrl("/checkout/sessions"), {
          method: "POST", headers: stripeApiHeaders(secretKey, `checkout:${input.transaction.id}`), body, redirect: "error", signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new Error("Stripe checkout session could not be created.");
      }
      if (!response.ok) throw new Error("Stripe checkout session could not be created.");
      try {
        const payload = parseJsonObject(await response.text());
        requiredText(payload.id, "checkout session ID");
        return { provider: "stripe", mode: "redirect", checkoutUrl: checkoutUrl(payload.url), nextAction: "redirect_to_stripe_checkout", externalRequired: true };
      } catch {
        throw new Error("Stripe checkout session could not be created.");
      }
    },
    async verifySignature(request, rawBody) {
      const webhookSecret = getConfig().webhookSecret;
      if (!webhookSecret || !/^whsec_[A-Za-z0-9_]+$/.test(webhookSecret)) return false;
      const signature = parseStripeSignature(request.headers.get("stripe-signature"));
      if (!signature || Math.abs(Math.floor(now() / 1000) - signature.timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
      const expected = createHmac("sha256", webhookSecret).update(`${signature.timestamp}.${rawBody}`).digest("hex");
      return signature.signatures.some((candidate) => safeEqual(candidate, expected));
    },
    async normalizePayload(rawBody): Promise<ProviderNormalizeResult> {
      const { event, eventId, type, object } = webhookObject(rawBody);
      const metadata = objectMetadata(object);
      const orderNumber = requiredText(metadata.orderNumber, "order number");
      const grossAmountCents = safeAmount(object.amount_total ?? object.amount ?? object.amount_received, "gross amount");
      const refundAmountCents = safeAmount(object.amount_refunded ?? (type.startsWith("refund.") ? object.amount : 0), "refund amount");
      const currency = validCurrency(object.currency).toUpperCase();
      const providerTradeNo = stripePaymentIntentId(type.startsWith("payment_intent.") ? object.id : object.payment_intent);
      const created = event.created;
      const occurredAt = Number.isSafeInteger(created) && (created as number) >= 0
        ? new Date((created as number) * 1000).toISOString()
        : undefined;
      const payload = PaymentWebhookPayload.parse({
        provider: "stripe", eventId, eventType: paymentEventType(type, object), orderNumber, providerTradeNo,
        vendorId: optionalText(metadata.vendorId), paymentMode: "platform", grossAmountCents,
        netAmountCents: grossAmountCents, refundAmountCents, currency, occurredAt,
        ...(type === "charge.refunded" ? { cumulativeRefundAmountCents: refundAmountCents } : {}),
      });
      // Persist only non-sensitive event identifiers and accounting fields.
      return { payload, rawPayload: { id: eventId, type, created: event.created, objectId: optionalText(object.id), currency, grossAmountCents, refundAmountCents } };
    },
    async refundPayment(input) {
      const secretKey = getConfig().secretKey;
      if (!secretKey || !/^sk_(?:test|live)_[A-Za-z0-9_]+$/.test(secretKey)) throw new RefundProviderError("authentication");
      const context = refundContext(input);
      let response: Response;
      try {
        response = await transport(requestUrl("/refunds"), {
          method: "POST", headers: stripeApiHeaders(secretKey, context.requestId),
          body: formBody({ payment_intent: context.paymentIntent, amount: context.refundAmountCents }), redirect: "error", signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new RefundProviderError("network");
      }
      if (!response.ok) throw new RefundProviderError("provider_response");
      try {
        const result = parseJsonObject(await response.text());
        const refundId = requiredText(result.id, "refund ID");
        if (!/^re_[A-Za-z0-9]+$/.test(refundId) || result.status !== "succeeded" || safeAmount(result.amount, "refund amount") !== context.refundAmountCents) {
          throw new Error("Invalid Stripe refund response.");
        }
        return { providerEventId: refundId };
      } catch {
        throw new RefundProviderError("provider_response");
      }
    },
    async queryPayment(input): Promise<PaymentQueryResult> {
      const secretKey = getConfig().secretKey;
      if (!secretKey || !/^sk_(?:test|live)_[A-Za-z0-9_]+$/.test(secretKey)) throw new PaymentQueryProviderError("authentication");
      const { paymentIntent, transaction } = queryContext(input);
      let response: Response;
      try {
        response = await transport(requestUrl(`/payment_intents/${encodeURIComponent(paymentIntent)}?expand[]=latest_charge`), {
          method: "GET", headers: { authorization: `Bearer ${secretKey}` }, redirect: "error", signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new PaymentQueryProviderError("network");
      }
      if (!response.ok) throw new PaymentQueryProviderError("provider_response");
      try {
        const result = parseJsonObject(await response.text());
        const providerTradeNo = stripePaymentIntentId(result.id);
        const grossAmountCents = safeAmount(result.amount, "payment amount");
        const charge = result.latest_charge as StripeObject | null;
        if (!charge || typeof charge !== "object" || Array.isArray(charge)
          || charge.payment_intent !== paymentIntent || charge.amount !== grossAmountCents
          || validCurrency(charge.currency) !== validCurrency(transaction.currency)) {
          throw new Error("Invalid Stripe charge binding.");
        }
        const refundedAmountCents = safeAmount(charge.amount_refunded, "refunded amount");
        if (
          providerTradeNo !== paymentIntent || result.status !== "succeeded" || grossAmountCents !== transaction.grossAmountCents
          || validCurrency(result.currency) !== validCurrency(transaction.currency) || refundedAmountCents > grossAmountCents
        ) throw new Error("Invalid Stripe payment response.");
        const remainingRefundableAmountCents = grossAmountCents - refundedAmountCents;
        return {
          providerTradeNo, orderNumber: transaction.orderNumber ?? transaction.id, grossAmountCents, refundedAmountCents,
          remainingRefundableAmountCents,
          status: refundedAmountCents === 0 ? "paid" : remainingRefundableAmountCents === 0 ? "refunded" : "partially_refunded",
        };
      } catch {
        throw new PaymentQueryProviderError("provider_response");
      }
    },
  };
}

export const stripePaymentProvider = createStripePaymentProvider();
