import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  parsePublicHttpsDeliveryUrl,
  revealOrderItemDeliverySnapshot,
} from "@/lib/product-delivery";

export const BUYER_SUPPORT_COOKIE_PREFIX = "celebrate_support_";
export const BUYER_SUPPORT_TTL_SECONDS = 60 * 60 * 24 * 180;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const COOKIE_KEY_PATTERN = /^[a-f0-9]{32}$/u;
const MAX_SUPPORT_COOKIES = 50;

type BuyerSupportDatabase = Pick<PrismaClient, "$transaction" | "buyerSupportOrderGrant">;
type CookieSource = { getAll(): Array<{ name: string; value: string }> };

export const buyerOrderDetailSelect = {
  id: true,
  vendorId: true,
  orderNumber: true,
  status: true,
  currency: true,
  subtotalAmountCents: true,
  totalAmountCents: true,
  paidAmountCents: true,
  refundedAmountCents: true,
  buyerMaskedName: true,
  buyerMaskedEmail: true,
  buyerMaskedPhone: true,
  shippingMaskedSummary: true,
  paidAt: true,
  failedAt: true,
  refundedAt: true,
  createdAt: true,
  updatedAt: true,
  vendor: { select: { name: true } },
  items: {
    orderBy: { lineIndex: "asc" as const },
    take: 100,
    select: {
      id: true,
      productName: true,
      fulfillmentType: true,
      unitPriceCents: true,
      quantity: true,
      lineTotalCents: true,
      imageUrl: true,
      shippingFulfillment: {
        select: {
          status: true,
          carrierName: true,
          packingAt: true,
          shippedAt: true,
          deliveredAt: true,
          returnedAt: true,
          cancelledAt: true,
          updatedAt: true,
        },
      },
      entitlement: {
        select: {
          status: true,
          grantedAt: true,
          expiresAt: true,
          revokedAt: true,
          updatedAt: true,
        },
      },
      serviceFulfillment: {
        select: {
          status: true,
          scheduledAt: true,
          completedAt: true,
          cancelledAt: true,
          serviceMaskedSummary: true,
          updatedAt: true,
        },
      },
      deliverySnapshot: {
        select: {
          id: true,
          deliveryKind: true,
          title: true,
          destinationMaskedSummary: true,
          instructionsMaskedSummary: true,
          revokedAt: true,
        },
      },
    },
  },
} satisfies Prisma.CommerceOrderSelect;

export type BuyerSupportCookie = {
  name: string;
  value: string;
  expiresAt: Date;
};

export function buyerVisibleSupportCaseScopes(
  grants: Array<{ id: string; vendorId: string; orderId: string }>,
): Prisma.SupportCaseWhereInput[] {
  return grants.map((grant) => ({
    vendorId: grant.vendorId,
    orderId: grant.orderId,
    OR: [
      { createdByBuyerGrantId: grant.id },
      { events: { some: { audience: "buyer" } } },
    ],
  }));
}

export function hashBuyerSupportToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function newToken() {
  return randomBytes(32).toString("base64url");
}

function cookieName(cookieKey: string) {
  if (!COOKIE_KEY_PATTERN.test(cookieKey)) throw new Error("Invalid buyer support cookie key.");
  return `${BUYER_SUPPORT_COOKIE_PREFIX}${cookieKey}`;
}

function requestCookies(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  const values = new Map<string, string>();
  for (const part of header.split(";").slice(0, 100)) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name.startsWith(BUYER_SUPPORT_COOKIE_PREFIX) && TOKEN_PATTERN.test(value)) values.set(name, value);
  }
  return values;
}

function supportCookies(source: CookieSource) {
  return source.getAll()
    .filter(({ name, value }) => name.startsWith(BUYER_SUPPORT_COOKIE_PREFIX) && TOKEN_PATTERN.test(value))
    .slice(0, MAX_SUPPORT_COOKIES);
}

export function buyerSupportCookieOptions(input: { expiresAt: Date; secure: boolean }) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: input.secure,
    path: "/",
    expires: input.expiresAt,
    maxAge: Math.max(1, Math.floor((input.expiresAt.getTime() - Date.now()) / 1000)),
  };
}

export async function issueBuyerSupportGrant(
  db: BuyerSupportDatabase,
  input: { request: Request; vendorId: string; orderId: string; now?: Date },
): Promise<BuyerSupportCookie> {
  const now = input.now ?? new Date();
  const existing = await db.buyerSupportOrderGrant.findUnique({
    where: { vendorId_orderId: { vendorId: input.vendorId, orderId: input.orderId } },
    select: { id: true, cookieKey: true, tokenHash: true, expiresAt: true, revokedAt: true },
  });
  const incoming = existing ? requestCookies(input.request).get(cookieName(existing.cookieKey)) : null;
  if (
    existing
    && !existing.revokedAt
    && existing.expiresAt > now
    && incoming
    && hashBuyerSupportToken(incoming) === existing.tokenHash
  ) {
    await db.buyerSupportOrderGrant.update({
      where: { id: existing.id },
      data: { lastAccessedAt: now },
    });
    return { name: cookieName(existing.cookieKey), value: incoming, expiresAt: existing.expiresAt };
  }

  const token = newToken();
  const tokenHash = hashBuyerSupportToken(token);
  const expiresAt = new Date(now.getTime() + BUYER_SUPPORT_TTL_SECONDS * 1000);
  const cookieKey = existing?.cookieKey ?? randomBytes(16).toString("hex");
  const grant = await db.$transaction(async (tx) => {
    const current = await tx.buyerSupportOrderGrant.findUnique({
      where: { vendorId_orderId: { vendorId: input.vendorId, orderId: input.orderId } },
      select: { id: true, cookieKey: true, rotationCount: true },
    });
    if (!current) {
      return tx.buyerSupportOrderGrant.create({
        data: {
          id: randomUUID(), vendorId: input.vendorId, orderId: input.orderId,
          cookieKey, tokenHash, expiresAt, revokedAt: null, lastAccessedAt: now,
          rotationCount: 0, createdAt: now, updatedAt: now,
        },
        select: { cookieKey: true },
      });
    }
    const claimed = await tx.buyerSupportOrderGrant.updateMany({
      where: { id: current.id, rotationCount: current.rotationCount },
      data: {
        tokenHash, expiresAt, revokedAt: null, lastAccessedAt: now,
        rotationCount: { increment: 1 }, updatedAt: now,
      },
    });
    if (claimed.count !== 1) throw new Error("buyer_support_conflict");
    return { cookieKey: current.cookieKey };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  return { name: cookieName(grant.cookieKey), value: token, expiresAt };
}

export async function rotateBuyerSupportGrant(
  tx: Prisma.TransactionClient,
  input: { grantId: string; expectedRotationCount: number; now?: Date },
) {
  const now = input.now ?? new Date();
  const token = newToken();
  const expiresAt = new Date(now.getTime() + BUYER_SUPPORT_TTL_SECONDS * 1000);
  const tokenHash = hashBuyerSupportToken(token);
  const grant = await tx.buyerSupportOrderGrant.findUnique({
    where: { id: input.grantId },
    select: { id: true, cookieKey: true, rotationCount: true, revokedAt: true, expiresAt: true },
  });
  if (!grant || grant.revokedAt || grant.expiresAt <= now || grant.rotationCount !== input.expectedRotationCount) {
    throw new Error("buyer_support_unavailable");
  }
  const claimed = await tx.buyerSupportOrderGrant.updateMany({
    where: { id: grant.id, rotationCount: input.expectedRotationCount, revokedAt: null, expiresAt: { gt: now } },
    data: {
      tokenHash, expiresAt, lastAccessedAt: now,
      rotationCount: { increment: 1 }, updatedAt: now,
    },
  });
  if (claimed.count !== 1) throw new Error("buyer_support_conflict");
  return { cookie: { name: cookieName(grant.cookieKey), value: token, expiresAt }, rotationCount: input.expectedRotationCount + 1 };
}

export async function resolveBuyerSupportGrants(
  db: Pick<PrismaClient, "buyerSupportOrderGrant">,
  source: CookieSource,
  now = new Date(),
) {
  const cookies = supportCookies(source);
  if (cookies.length === 0) return [];
  const candidates = await db.buyerSupportOrderGrant.findMany({
    where: {
      tokenHash: { in: cookies.map(({ value }) => hashBuyerSupportToken(value)) },
      revokedAt: null,
      expiresAt: { gt: now },
    },
    include: {
      order: {
        select: {
          id: true, vendorId: true, orderNumber: true, status: true, currency: true,
          totalAmountCents: true, refundedAmountCents: true, buyerMaskedName: true,
          buyerMaskedEmail: true, createdAt: true,
          vendor: { select: { name: true } },
          items: { orderBy: { lineIndex: "asc" }, take: 1, select: { productId: true } },
        },
      },
    },
    take: MAX_SUPPORT_COOKIES,
  });
  const byName = new Map(cookies.map((item) => [item.name, item.value]));
  return candidates.filter((grant) => {
    const token = byName.get(cookieName(grant.cookieKey));
    return token && hashBuyerSupportToken(token) === grant.tokenHash;
  });
}

export async function resolveBuyerSupportGrant(
  db: Pick<PrismaClient, "buyerSupportOrderGrant">,
  source: CookieSource,
  grantId: string,
  now = new Date(),
) {
  const grants = await resolveBuyerSupportGrants(db, source, now);
  return grants.find((grant) => grant.id === grantId) ?? null;
}

export async function resolveBuyerOrderDetail(
  db: Pick<PrismaClient, "buyerSupportOrderGrant" | "commerceOrder">,
  source: CookieSource,
  grantId: string,
  now = new Date(),
) {
  const grant = await resolveBuyerSupportGrant(db, source, grantId, now);
  if (!grant) return null;

  return db.commerceOrder.findFirst({
    where: {
      id: grant.orderId,
      vendorId: grant.vendorId,
      buyerSupportOrderGrants: {
        some: {
          id: grant.id,
          tokenHash: grant.tokenHash,
          revokedAt: null,
          expiresAt: { gt: now },
        },
      },
    },
    select: buyerOrderDetailSelect,
  });
}

function safeAllowlistSnapshot(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Prisma.JsonObject;
  if (
    typeof record.hostname !== "string"
    || typeof record.pathPrefix !== "string"
    || record.allowQuery !== false
  ) return null;
  return {
    hostname: record.hostname,
    pathPrefix: record.pathPrefix,
    allowQuery: false as const,
  };
}

/**
 * Decrypt one immutable delivery snapshot only after the exact HttpOnly buyer
 * grant, paid order, active fulfillment and non-revoked snapshot all match.
 */
export async function resolveBuyerOrderItemDelivery(
  db: Pick<PrismaClient, "buyerSupportOrderGrant" | "commerceOrderItem">,
  source: CookieSource,
  input: { grantId: string; itemId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const grant = await resolveBuyerSupportGrant(db, source, input.grantId, now);
  if (!grant || grant.revokedAt || grant.expiresAt <= now) return null;

  const item = await db.commerceOrderItem.findFirst({
    where: {
      id: input.itemId,
      vendorId: grant.vendorId,
      orderId: grant.orderId,
      order: {
        buyerSupportOrderGrants: {
          some: {
            id: grant.id,
            tokenHash: grant.tokenHash,
            revokedAt: null,
            expiresAt: { gt: now },
          },
        },
      },
    },
    select: {
      id: true,
      vendorId: true,
      orderId: true,
      productName: true,
      fulfillmentType: true,
      order: { select: { orderNumber: true, status: true } },
      entitlement: { select: { status: true, expiresAt: true, revokedAt: true } },
      serviceFulfillment: { select: { status: true, cancelledAt: true } },
      deliverySnapshot: {
        select: {
          id: true,
          deliveryKind: true,
          title: true,
          destinationEncryptedEnvelope: true,
          instructionsEncryptedEnvelope: true,
          allowlistSnapshot: true,
          revokedAt: true,
        },
      },
    },
  });
  if (!item || !["paid", "partially_refunded"].includes(item.order.status)) return null;
  const snapshot = item.deliverySnapshot;
  if (!snapshot || snapshot.revokedAt) return null;

  if (item.fulfillmentType === "digital" || item.fulfillmentType === "course") {
    if (
      item.entitlement?.status !== "granted"
      || item.entitlement.revokedAt
      || (item.entitlement.expiresAt && item.entitlement.expiresAt <= now)
    ) return null;
  } else if (item.fulfillmentType === "service") {
    if (!item.serviceFulfillment || item.serviceFulfillment.status === "cancelled" || item.serviceFulfillment.cancelledAt) return null;
  } else {
    return null;
  }

  try {
    const revealed = revealOrderItemDeliverySnapshot(snapshot, {
      vendorId: item.vendorId,
      orderId: item.orderId,
      orderItemId: item.id,
      snapshotId: snapshot.id,
    });
    let destinationUrl: string | null = null;
    if (revealed.destinationUrl) {
      const allowlist = safeAllowlistSnapshot(snapshot.allowlistSnapshot);
      if (!allowlist) return null;
      const parsed = parsePublicHttpsDeliveryUrl(revealed.destinationUrl);
      if (parsed.hostname !== allowlist.hostname || parsed.pathPrefix !== allowlist.pathPrefix) return null;
      destinationUrl = parsed.url;
    } else if (snapshot.allowlistSnapshot !== null) {
      return null;
    }
    return {
      orderNumber: item.order.orderNumber,
      productName: item.productName,
      deliveryKind: snapshot.deliveryKind,
      title: snapshot.title,
      destinationUrl,
      instructions: revealed.instructions,
    };
  } catch {
    return null;
  }
}
