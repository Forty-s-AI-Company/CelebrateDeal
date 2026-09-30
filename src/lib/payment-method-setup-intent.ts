import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { PaymentMethodSetupVerificationInput } from "@/lib/payment-method-reference";
import { newPayUniSetupOrderNumber, payUniSetupNonce } from "@/lib/payuni-setup-correlation";

export const PAYMENT_METHOD_SETUP_CONSENT_VERSION = "payment-method-setup/v1";
export const PAYMENT_METHOD_SETUP_TTL_MS = 15 * 60 * 1000;

type SetupScope = {
  vendorId: string;
  providerName: string;
  scopeType: "VENDOR" | "MEMBERSHIP";
  teamId: string | null;
  membershipId: string | null;
};

type SetupIntentRecord = Omit<SetupScope, "scopeType"> & {
  scopeType: string;
  id: string;
  nonceHash: string;
  consentVersion: string;
  consentedAt: Date;
  status: string;
  expiresAt: Date;
  createdAt: Date;
};

type CreateDb = {
  paymentMethodSetupIntent: {
    create(args: Prisma.PaymentMethodSetupIntentCreateArgs): Promise<{ id: string }>;
  };
};

type ConsumeDb = {
  paymentMethodSetupIntent: {
    findUnique(args: Prisma.PaymentMethodSetupIntentFindUniqueArgs): Promise<SetupIntentRecord | null>;
    updateMany(args: Prisma.PaymentMethodSetupIntentUpdateManyArgs): Promise<{ count: number }>;
  };
};

export class PaymentMethodSetupIntentRejectedError extends Error {
  constructor() {
    super("payment_method_setup_intent_rejected");
    this.name = "PaymentMethodSetupIntentRejectedError";
  }
}

function nonceDigest(nonce: string) {
  return createHash("sha256").update(nonce).digest();
}

/** Creates one short-lived server-owned consent record before provider handoff. */
export async function createPaymentMethodSetupIntent(
  db: CreateDb,
  input: SetupScope & { consentActorId: string; consentAccepted: boolean; payUniCorrelation?: boolean; now?: Date },
) {
  if (!input.consentAccepted) throw new PaymentMethodSetupIntentRejectedError();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.consentActorId)) throw new PaymentMethodSetupIntentRejectedError();
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(input.providerName)) throw new PaymentMethodSetupIntentRejectedError();
  if ((input.scopeType === "VENDOR" && (input.teamId || input.membershipId))
    || (input.scopeType === "MEMBERSHIP" && (!input.teamId || !input.membershipId))) {
    throw new PaymentMethodSetupIntentRejectedError();
  }
  const now = input.now ?? new Date();
  // PAYUNi returns only MerTradeNo in its signed setup result. A bounded order
  // ID and domain-separated nonce allow us to reconstruct the original proof.
  const payUniOrderNumber = input.payUniCorrelation ? newPayUniSetupOrderNumber() : null;
  if (payUniOrderNumber && input.providerName !== "payuni") throw new PaymentMethodSetupIntentRejectedError();
  const nonce = payUniOrderNumber
    ? payUniSetupNonce(payUniOrderNumber)
    : randomBytes(32).toString("base64url");
  const intent = await db.paymentMethodSetupIntent.create({
    data: {
      ...(payUniOrderNumber ? { id: payUniOrderNumber } : {}),
      vendorId: input.vendorId,
      providerName: input.providerName,
      scopeType: input.scopeType,
      teamId: input.teamId,
      membershipId: input.membershipId,
      nonceHash: nonceDigest(nonce).toString("hex"),
      consentActorId: input.consentActorId,
      consentVersion: PAYMENT_METHOD_SETUP_CONSENT_VERSION,
      consentedAt: now,
      expiresAt: new Date(now.getTime() + PAYMENT_METHOD_SETUP_TTL_MS),
    },
    select: { id: true },
  });
  // The nonce is only handed to the adapter; it is never persisted or logged.
  return { intentId: intent.id, setupNonce: nonce };
}

/** Must run in the same serializable transaction as the verified reference write. */
export async function consumePaymentMethodSetupIntent(
  db: ConsumeDb,
  event: PaymentMethodSetupVerificationInput,
  now = new Date(),
) {
  if (!event.setupIntentId || !event.setupNonce || !/^[A-Za-z0-9_-]{40,50}$/.test(event.setupNonce)) {
    throw new PaymentMethodSetupIntentRejectedError();
  }
  const intent = await db.paymentMethodSetupIntent.findUnique({
    where: { id: event.setupIntentId },
    select: {
      id: true, vendorId: true, providerName: true, scopeType: true, teamId: true,
      membershipId: true, nonceHash: true, consentVersion: true, consentedAt: true,
      status: true, expiresAt: true, createdAt: true,
    },
  });
  if (!intent || intent.status !== "pending" || intent.expiresAt <= now
    || intent.consentVersion !== PAYMENT_METHOD_SETUP_CONSENT_VERSION
    || intent.vendorId !== event.vendorId || intent.providerName !== event.providerName
    || intent.scopeType !== event.scopeType
    || intent.teamId !== (event.teamId ?? null)
    || intent.membershipId !== (event.membershipId ?? null)) {
    throw new PaymentMethodSetupIntentRejectedError();
  }
  const signedVerifiedAt = new Date(event.verifiedAt);
  if (!Number.isFinite(signedVerifiedAt.getTime())
    || signedVerifiedAt < intent.consentedAt
    || signedVerifiedAt > new Date(now.getTime() + 5 * 60 * 1000)) {
    throw new PaymentMethodSetupIntentRejectedError();
  }
  const expected = Buffer.from(intent.nonceHash, "hex");
  const actual = nonceDigest(event.setupNonce);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new PaymentMethodSetupIntentRejectedError();
  }
  const result = await db.paymentMethodSetupIntent.updateMany({
    where: { id: intent.id, vendorId: intent.vendorId, status: "pending", expiresAt: { gt: now } },
    data: { status: "verified", consumedAt: now, providerEventId: event.eventId },
  });
  if (result.count !== 1) throw new PaymentMethodSetupIntentRejectedError();
}
