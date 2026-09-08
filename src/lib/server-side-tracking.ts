import { createHash } from "node:crypto";
import { revealCommerceOrderPii } from "@/lib/commerce-order-pii";
import { unprotectFacebookAccessToken } from "@/lib/tracking-credentials";

/** Events that may be sent to external server-side measurement providers. */
export const SERVER_SIDE_TRACKING_EVENTS = ["Lead", "ViewContent", "Schedule", "Purchase"] as const;
export type ServerSideTrackingEventName = typeof SERVER_SIDE_TRACKING_EVENTS[number];

export type TrackingCustomer = {
  email?: string | null;
  phone?: string | null;
  /** A server-issued opaque visitor or customer identifier; it is hashed before dispatch. */
  externalId?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
};

export type ServerSideTrackingEvent = {
  vendorId: string;
  eventName: ServerSideTrackingEventName;
  eventId: string;
  occurredAt: Date;
  eventSourceUrl: string;
  customer?: TrackingCustomer;
  valueCents?: number;
  currency?: string;
  contentIds?: readonly string[];
};

/**
 * This is deliberately a runtime-only configuration. The persistence layer
 * supplies the decrypted token only inside a server-owned call site.
 */
export type ServerSideTrackingSettings = {
  facebookPixelId?: string | null;
  facebookAccessToken?: string | null;
  testEventCode?: string | null;
  enableLeadEvent?: boolean;
  enablePurchaseEvent?: boolean;
};

export type MetaCapiPayload = {
  data: Array<{
    event_name: ServerSideTrackingEventName;
    event_time: number;
    event_id: string;
    action_source: "website";
    event_source_url: string;
    user_data: Record<string, string[]> & {
      client_ip_address?: string;
      client_user_agent?: string;
    };
    custom_data?: {
      currency?: string;
      value?: number;
      content_ids?: string[];
    };
  }>;
  test_event_code?: string;
};

export type GoogleEnhancedConversionPayload = {
  eventName: ServerSideTrackingEventName;
  eventTime: number;
  eventSourceUrl: string;
  userData: {
    sha256EmailAddress?: string;
    sha256PhoneNumber?: string;
    sha256ExternalId?: string;
  };
  value?: number;
  currency?: string;
};

export type MetaCapiAdapter = {
  dispatch(input: { pixelId: string; accessToken: string; payload: MetaCapiPayload }): Promise<void>;
};

export type TrackingDispatchResult =
  | { status: "delivered"; provider: "meta"; eventId: string }
  | { status: "skipped"; reason: "disabled" | "not_configured" }
  | { status: "failed"; reason: "invalid_input" | "provider_rejected" };

/** Persisted setting projection accepted by any server-owned funnel entry point. */
export type StoredServerSideTrackingSettings = {
  facebookPixelId: string | null;
  facebookAccessTokenEncrypted: string | null;
  facebookTestEventCode: string | null;
  enableLeadEvent: boolean;
  enablePurchaseEvent: boolean;
};

type PaidCommerceOrder = {
  id: string;
  vendorId: string;
  status: string;
  paidAt: Date | null;
  paidAmountCents: number;
  currency: string;
  automationCustomerKeyHash: string | null;
  buyerEncryptedEnvelope: string;
  shippingEncryptedEnvelope: string | null;
  items: Array<{ productId: string | null }>;
};

/** The narrow persistence contract prevents this facade from widening tenant reads. */
export type ServerSideTrackingDatabase = {
  trackingSetting: {
    findUnique(input: {
      where: { vendorId: string };
      select: Record<string, boolean>;
    }): Promise<StoredServerSideTrackingSettings | null>;
  };
  commerceOrder: {
    findFirst(input: {
      where: { vendorId: string; primaryPaymentTransactionId: string; status: "paid" };
      select: Record<string, boolean | { select: Record<string, boolean> }>;
    }): Promise<PaidCommerceOrder | null>;
  };
};

const MAX_EVENT_ID_LENGTH = 128;
const MAX_URL_LENGTH = 2_048;
const MAX_IDENTIFIER_LENGTH = 512;
const META_GRAPH_API_VERSION = "v22.0";

function nonEmpty(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Meta normalization: lowercase/trim email and numbers-only phone before hashing. */
export function hashTrackingEmail(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)) {
    throw new TypeError("A valid email is required for tracking hashing.");
  }
  return sha256(normalized);
}

export function hashTrackingPhone(value: string) {
  const normalized = value.replace(/[^0-9]/gu, "");
  if (normalized.length < 7 || normalized.length > 20) {
    throw new TypeError("A valid phone is required for tracking hashing.");
  }
  return sha256(normalized);
}

function hashTrackingExternalId(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_IDENTIFIER_LENGTH) throw new TypeError("Invalid external identifier.");
  return sha256(normalized);
}

function sourceUrl(value: string) {
  if (!value || value.length > MAX_URL_LENGTH) throw new TypeError("Invalid event source URL.");
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new TypeError("Invalid event source URL.");
  }
  url.hash = "";
  return url.toString();
}

function eventIsEnabled(eventName: ServerSideTrackingEventName, settings: ServerSideTrackingSettings) {
  if (eventName === "Lead") return settings.enableLeadEvent !== false;
  if (eventName === "Purchase") return settings.enablePurchaseEvent !== false;
  return true;
}

function validCurrency(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/u.test(normalized)) throw new TypeError("Invalid currency.");
  return normalized;
}

function valueFromCents(valueCents: number | undefined) {
  if (valueCents === undefined) return undefined;
  if (!Number.isSafeInteger(valueCents) || valueCents < 0) throw new TypeError("Invalid conversion value.");
  return valueCents / 100;
}

function validatedEvent(event: ServerSideTrackingEvent) {
  if (!event.vendorId.trim() || !event.eventId.trim() || event.eventId.length > MAX_EVENT_ID_LENGTH) {
    throw new TypeError("Invalid tracking event identity.");
  }
  if (!SERVER_SIDE_TRACKING_EVENTS.includes(event.eventName) || Number.isNaN(event.occurredAt.getTime())) {
    throw new TypeError("Invalid tracking event.");
  }
  const eventSourceUrl = sourceUrl(event.eventSourceUrl);
  const value = valueFromCents(event.valueCents);
  const currency = validCurrency(event.currency);
  if (value !== undefined && !currency) throw new TypeError("Currency is required with conversion value.");
  if (event.contentIds?.some((id) => !id.trim() || id.length > 128)) throw new TypeError("Invalid content identifier.");
  return { eventSourceUrl, value, currency };
}

/**
 * Builds a Meta CAPI request without retaining a raw email, phone, visitor id,
 * or access token in the returned payload.
 */
export function buildMetaCapiPayload(event: ServerSideTrackingEvent, settings: Pick<ServerSideTrackingSettings, "testEventCode"> = {}): MetaCapiPayload {
  const { eventSourceUrl, value, currency } = validatedEvent(event);
  const customer = event.customer ?? {};
  const userData: MetaCapiPayload["data"][number]["user_data"] = {};
  const email = nonEmpty(customer.email);
  const phone = nonEmpty(customer.phone);
  const externalId = nonEmpty(customer.externalId);
  if (email) userData.em = [hashTrackingEmail(email)];
  if (phone) userData.ph = [hashTrackingPhone(phone)];
  if (externalId) userData.external_id = [hashTrackingExternalId(externalId)];
  if (customer.clientIpAddress && customer.clientIpAddress.length <= 64) userData.client_ip_address = customer.clientIpAddress;
  if (customer.clientUserAgent && customer.clientUserAgent.length <= 512) userData.client_user_agent = customer.clientUserAgent;

  const customData = {
    ...(currency ? { currency } : {}),
    ...(value !== undefined ? { value } : {}),
    ...(event.contentIds?.length ? { content_ids: [...event.contentIds] } : {}),
  };
  return {
    data: [{
      event_name: event.eventName,
      event_time: Math.floor(event.occurredAt.getTime() / 1_000),
      event_id: event.eventId.trim(),
      action_source: "website",
      event_source_url: eventSourceUrl,
      user_data: userData,
      ...(Object.keys(customData).length ? { custom_data: customData } : {}),
    }],
    ...(nonEmpty(settings.testEventCode) ? { test_event_code: nonEmpty(settings.testEventCode)! } : {}),
  };
}

/** Builds the equivalent Google Enhanced Conversions identity envelope. */
export function buildGoogleEnhancedConversionPayload(event: ServerSideTrackingEvent): GoogleEnhancedConversionPayload {
  const { eventSourceUrl, value, currency } = validatedEvent(event);
  const customer = event.customer ?? {};
  const email = nonEmpty(customer.email);
  const phone = nonEmpty(customer.phone);
  const externalId = nonEmpty(customer.externalId);
  return {
    eventName: event.eventName,
    eventTime: Math.floor(event.occurredAt.getTime() / 1_000),
    eventSourceUrl,
    userData: {
      ...(email ? { sha256EmailAddress: hashTrackingEmail(email) } : {}),
      ...(phone ? { sha256PhoneNumber: hashTrackingPhone(phone) } : {}),
      ...(externalId ? { sha256ExternalId: hashTrackingExternalId(externalId) } : {}),
    },
    ...(value !== undefined ? { value } : {}),
    ...(currency ? { currency } : {}),
  };
}

/** Deterministic in-memory adapter for tests and explicitly offline runtimes. */
export class DeterministicMetaCapiAdapter implements MetaCapiAdapter {
  readonly delivered: Array<{ pixelId: string; payload: MetaCapiPayload }> = [];

  async dispatch(input: { pixelId: string; accessToken: string; payload: MetaCapiPayload }) {
    // Intentionally omit input.accessToken. Tests can prove no secret is retained.
    this.delivered.push({ pixelId: input.pixelId, payload: input.payload });
  }
}

/** Production adapter. It is never selected while Vitest is running. */
export class MetaCapiFetchAdapter implements MetaCapiAdapter {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async dispatch({ pixelId, accessToken, payload }: { pixelId: string; accessToken: string; payload: MetaCapiPayload }) {
    const response = await this.fetchImpl(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${encodeURIComponent(pixelId)}/events`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Keep the token out of URLs, logs and response data.
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) throw new Error(`Meta CAPI rejected the event (${response.status}).`);
  }
}

function defaultAdapter(): MetaCapiAdapter {
  // Vitest sets NODE_ENV=test. This guard makes accidental network use fail
  // safely even if a caller does not inject its own test adapter.
  return process.env.NODE_ENV === "test" ? new DeterministicMetaCapiAdapter() : new MetaCapiFetchAdapter();
}

/**
 * Sends a single event only after all local validation passes. Tracking failure
 * never blocks the product transaction and never exposes provider diagnostics.
 */
export async function dispatchServerSideTracking(
  event: ServerSideTrackingEvent,
  settings: ServerSideTrackingSettings,
  adapter: MetaCapiAdapter = defaultAdapter(),
): Promise<TrackingDispatchResult> {
  if (!eventIsEnabled(event.eventName, settings)) return { status: "skipped", reason: "disabled" };
  const pixelId = nonEmpty(settings.facebookPixelId);
  const accessToken = nonEmpty(settings.facebookAccessToken);
  if (!pixelId || !accessToken) return { status: "skipped", reason: "not_configured" };

  let payload: MetaCapiPayload;
  try {
    payload = buildMetaCapiPayload(event, settings);
  } catch {
    return { status: "failed", reason: "invalid_input" };
  }
  try {
    await adapter.dispatch({ pixelId, accessToken, payload });
    return { status: "delivered", provider: "meta", eventId: event.eventId.trim() };
  } catch {
    return { status: "failed", reason: "provider_rejected" };
  }
}

/**
 * Safe facade for all four funnel entry points. Call it only after the caller
 * has committed/validated its own record; it decrypts the tenant token only
 * inside this server module and returns a sanitized delivery outcome.
 */
export async function dispatchStoredServerSideTracking(
  event: ServerSideTrackingEvent,
  storedSettings: StoredServerSideTrackingSettings | null,
  adapter?: MetaCapiAdapter,
): Promise<TrackingDispatchResult> {
  if (!storedSettings?.facebookAccessTokenEncrypted) return { status: "skipped", reason: "not_configured" };
  if (!eventIsEnabled(event.eventName, storedSettings)) return { status: "skipped", reason: "disabled" };
  try {
    return await dispatchServerSideTracking(event, {
      facebookPixelId: storedSettings.facebookPixelId,
      facebookAccessToken: unprotectFacebookAccessToken(event.vendorId, storedSettings.facebookAccessTokenEncrypted),
      testEventCode: storedSettings.facebookTestEventCode,
      enableLeadEvent: storedSettings.enableLeadEvent,
      enablePurchaseEvent: storedSettings.enablePurchaseEvent,
    }, adapter);
  } catch {
    return { status: "failed", reason: "invalid_input" };
  }
}

/**
 * Dispatches Purchase only from a committed, tenant-qualified commerce order.
 * Missing/undecryptable state intentionally becomes a quiet `not_configured`
 * or `invalid_input` result; it must never affect webhook success semantics.
 */
export async function dispatchPaidCommerceOrderTracking(
  database: ServerSideTrackingDatabase,
  input: { vendorId: string; paymentTransactionId: string; eventSourceUrl: string; occurredAt: Date },
  adapter?: MetaCapiAdapter,
): Promise<TrackingDispatchResult> {
  const storedSettings = await database.trackingSetting.findUnique({
    where: { vendorId: input.vendorId },
    select: {
      facebookPixelId: true,
      facebookAccessTokenEncrypted: true,
      facebookTestEventCode: true,
      enableLeadEvent: true,
      enablePurchaseEvent: true,
    },
  });
  // Avoid even loading the encrypted buyer envelope if server-side tracking
  // is not configured for this tenant.
  if (!storedSettings?.facebookAccessTokenEncrypted) return { status: "skipped", reason: "not_configured" };

  const order = await database.commerceOrder.findFirst({
    where: {
      vendorId: input.vendorId,
      primaryPaymentTransactionId: input.paymentTransactionId,
      status: "paid",
    },
    select: {
      id: true,
      vendorId: true,
      status: true,
      paidAt: true,
      paidAmountCents: true,
      currency: true,
      automationCustomerKeyHash: true,
      buyerEncryptedEnvelope: true,
      shippingEncryptedEnvelope: true,
      items: { select: { productId: true } },
    },
  });
  if (!order) return { status: "skipped", reason: "not_configured" };

  try {
    const buyer = revealCommerceOrderPii({
      buyerEncrypted: order.buyerEncryptedEnvelope,
      shippingEncrypted: order.shippingEncryptedEnvelope,
    }, { vendorId: input.vendorId, orderId: order.id }).buyer;
    return await dispatchStoredServerSideTracking({
      vendorId: input.vendorId,
      eventName: "Purchase",
      eventId: `purchase:${input.paymentTransactionId}`,
      occurredAt: order.paidAt ?? input.occurredAt,
      eventSourceUrl: input.eventSourceUrl,
      customer: {
        email: buyer.email,
        phone: buyer.phone,
        externalId: order.automationCustomerKeyHash ?? order.id,
      },
      valueCents: order.paidAmountCents,
      currency: order.currency,
      contentIds: order.items.flatMap((item) => item.productId ? [item.productId] : []),
    }, storedSettings, adapter);
  } catch {
    // Decryption/configuration failures stay inside the integration boundary.
    return { status: "failed", reason: "invalid_input" };
  }
}
