import type { Prisma, PrismaClient } from "@prisma/client";

export type PaymentMethodScopeType = "VENDOR" | "MEMBERSHIP";
export type PaymentMethodReferenceStatus = "pending" | "verified" | "expired" | "revoked";

/**
 * Provider adapters must reduce their signed callback to this verified-only
 * shape. Raw provider payloads, card data and setup tokens never cross this
 * boundary.
 */
export type PaymentMethodSetupVerificationInput = {
  providerName: string;
  eventId: string;
  vendorId: string;
  scopeType: PaymentMethodScopeType;
  teamId?: string | null;
  membershipId?: string | null;
  providerCustomerRef?: string | null;
  providerPaymentMethodRef: string;
  verifiedAt: string;
  expiresAt?: string | null;
};

const OPAQUE_REFERENCE_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export class PaymentMethodReferenceValidationError extends Error {
  constructor() {
    super("invalid_payment_method_reference");
    this.name = "PaymentMethodReferenceValidationError";
  }
}

export class PaymentMethodReferenceRequiredError extends Error {
  constructor() {
    super("payment_method_required");
    this.name = "PaymentMethodReferenceRequiredError";
  }
}

export class PaymentMethodSetupConflictError extends Error {
  constructor() {
    super("payment_method_setup_conflict");
    this.name = "PaymentMethodSetupConflictError";
  }
}

export class PaymentMethodReferenceNotFoundError extends Error {
  constructor() {
    super("payment_method_reference_not_found");
    this.name = "PaymentMethodReferenceNotFoundError";
  }
}

export type PaymentMethodReferenceInput = {
  vendorId: string;
  scopeType: PaymentMethodScopeType;
  teamId?: string | null;
  membershipId?: string | null;
  providerName: string;
  providerCustomerRef?: string | null;
  providerPaymentMethodRef: string;
  status?: PaymentMethodReferenceStatus;
  verifiedAt?: Date | null;
  expiresAt?: Date | null;
};

function normalizeId(value: string | null | undefined) {
  if (!value || !ID_PATTERN.test(value.trim())) throw new PaymentMethodReferenceValidationError();
  return value.trim();
}

function normalizeOpaqueReference(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  // A provider reference is safe to retain only when it is opaque. Reject a
  // contiguous card-like number even if a caller labels it as a provider ref.
  if (!OPAQUE_REFERENCE_PATTERN.test(normalized) || /\d{12,19}/.test(normalized)) {
    throw new PaymentMethodReferenceValidationError();
  }
  return normalized;
}

function normalizeProviderName(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(normalized)) throw new PaymentMethodReferenceValidationError();
  return normalized;
}

export function normalizePaymentMethodReference(input: PaymentMethodReferenceInput) {
  if (!ID_PATTERN.test(input.vendorId)) throw new PaymentMethodReferenceValidationError();
  if (input.scopeType !== "VENDOR" && input.scopeType !== "MEMBERSHIP") {
    throw new PaymentMethodReferenceValidationError();
  }
  const status = input.status ?? "pending";
  if (!["pending", "verified", "expired", "revoked"].includes(status)) {
    throw new PaymentMethodReferenceValidationError();
  }
  const membershipId = input.scopeType === "MEMBERSHIP" ? normalizeId(input.membershipId) : null;
  const teamId = input.scopeType === "MEMBERSHIP" ? normalizeId(input.teamId) : null;
  const providerCustomerRef = input.providerCustomerRef == null
    ? null
    : normalizeOpaqueReference(input.providerCustomerRef);
  const providerPaymentMethodRef = normalizeOpaqueReference(input.providerPaymentMethodRef);
  const verifiedAt = status === "verified" ? input.verifiedAt ?? null : null;
  if (status === "verified" && !verifiedAt) throw new PaymentMethodReferenceValidationError();

  return {
    vendorId: input.vendorId,
    scopeType: input.scopeType,
    teamId,
    membershipId,
    providerName: normalizeProviderName(input.providerName),
    providerCustomerRef,
    providerPaymentMethodRef,
    status,
    verifiedAt,
    expiresAt: input.expiresAt ?? null,
  };
}

function setupDate(value: string | null | undefined, required: boolean) {
  if (!value || !value.trim()) {
    if (required) throw new PaymentMethodReferenceValidationError();
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new PaymentMethodReferenceValidationError();
  return parsed;
}

type PaymentMethodReferenceWriteDb = {
  vendor: {
    findUnique: (args: Prisma.VendorFindUniqueArgs) => Promise<{ id: string } | null>;
  };
  teamMembership: {
    findFirst: (args: Prisma.TeamMembershipFindFirstArgs) => Promise<{ id: string } | null>;
  };
  paymentMethodReference: {
    findUnique: (args: Prisma.PaymentMethodReferenceFindUniqueArgs) => Promise<{
      vendorId: string;
      scopeType: string;
      teamId: string | null;
      membershipId: string | null;
    } | null>;
    upsert: (args: Prisma.PaymentMethodReferenceUpsertArgs) => Promise<unknown>;
  };
};

type PaymentMethodReferenceRevokeDb = {
  paymentMethodReference: {
    findUnique: (args: Prisma.PaymentMethodReferenceFindUniqueArgs) => Promise<{
      id: string;
      vendorId: string;
      scopeType: string;
      teamId: string | null;
      membershipId: string | null;
      providerName: string;
      providerCustomerRef: string | null;
      providerPaymentMethodRef: string;
      status: string;
      verifiedAt: Date | null;
      expiresAt: Date | null;
      lastValidatedAt: Date | null;
    } | null>;
    update: (args: Prisma.PaymentMethodReferenceUpdateArgs) => Promise<{
      id: string;
      vendorId: string;
      scopeType: string;
      teamId: string | null;
      membershipId: string | null;
      providerName: string;
      providerCustomerRef: string | null;
      providerPaymentMethodRef: string;
      status: string;
      verifiedAt: Date | null;
      expiresAt: Date | null;
      lastValidatedAt: Date | null;
    }>;
  };
};

export type PaymentMethodReferenceRevocationRecord = {
  id: string;
  vendorId: string;
  scopeType: string;
  teamId: string | null;
  membershipId: string | null;
  providerName: string;
  providerCustomerRef: string | null;
  providerPaymentMethodRef: string;
  status: string;
  verifiedAt: Date | null;
  expiresAt: Date | null;
  lastValidatedAt: Date | null;
};

const paymentMethodReferenceRevokeSelect = {
  id: true,
  vendorId: true,
  scopeType: true,
  teamId: true,
  membershipId: true,
  providerName: true,
  providerCustomerRef: true,
  providerPaymentMethodRef: true,
  status: true,
  verifiedAt: true,
  expiresAt: true,
  lastValidatedAt: true,
} satisfies Prisma.PaymentMethodReferenceSelect;

/**
 * Revokes the local reference first. That ordering makes every subsequent
 * application charge fail closed even if the provider-side token cancellation
 * is unavailable or fails and needs an explicit retry by an operator.
 */
export async function revokePaymentMethodReference(
  db: PaymentMethodReferenceRevokeDb,
  input: { vendorId: string; referenceId: string },
) {
  const reference = await db.paymentMethodReference.findUnique({
    where: { vendorId_id: { vendorId: input.vendorId, id: input.referenceId } },
    select: paymentMethodReferenceRevokeSelect,
  });
  if (!reference) throw new PaymentMethodReferenceNotFoundError();
  if (reference.status === "revoked") return { reference, changed: false };

  const updated = await db.paymentMethodReference.update({
    where: { vendorId_id: { vendorId: input.vendorId, id: input.referenceId } },
    data: { status: "revoked" },
    select: paymentMethodReferenceRevokeSelect,
  });
  return { reference: updated, changed: true };
}

/**
 * Applies only a provider-verified, already-normalized setup result. The
 * provider-specific adapter is responsible for signature verification and
 * raw-payload parsing before this function is called.
 */
export async function applyVerifiedPaymentMethodSetup(
  db: PaymentMethodReferenceWriteDb,
  input: PaymentMethodSetupVerificationInput,
) {
  const verifiedAt = setupDate(input.verifiedAt, true)!;
  const expiresAt = setupDate(input.expiresAt, false);
  if (expiresAt && expiresAt <= verifiedAt) throw new PaymentMethodReferenceValidationError();

  const normalized = normalizePaymentMethodReference({
    vendorId: input.vendorId,
    scopeType: input.scopeType,
    teamId: input.teamId,
    membershipId: input.membershipId,
    providerName: input.providerName,
    providerCustomerRef: input.providerCustomerRef,
    providerPaymentMethodRef: input.providerPaymentMethodRef,
    status: "verified",
    verifiedAt,
    expiresAt,
  });

  const vendor = await db.vendor.findUnique({ where: { id: normalized.vendorId }, select: { id: true } });
  if (!vendor) throw new PaymentMethodReferenceValidationError();

  if (normalized.scopeType === "MEMBERSHIP") {
    const membership = await db.teamMembership.findFirst({
      where: {
        vendorId: normalized.vendorId,
        teamId: normalized.teamId!,
        id: normalized.membershipId!,
        status: "ACTIVE",
        leftAt: null,
      },
      select: { id: true },
    });
    if (!membership) throw new PaymentMethodReferenceValidationError();
  }

  const uniqueReference = {
    vendorId_providerName_providerPaymentMethodRef: {
      vendorId: normalized.vendorId,
      providerName: normalized.providerName,
      providerPaymentMethodRef: normalized.providerPaymentMethodRef,
    },
  } satisfies Prisma.PaymentMethodReferenceWhereUniqueInput;
  const existing = await db.paymentMethodReference.findUnique({
    where: uniqueReference,
    select: { vendorId: true, scopeType: true, teamId: true, membershipId: true },
  });
  if (
    existing
    && (existing.vendorId !== normalized.vendorId
      || existing.scopeType !== normalized.scopeType
      || existing.teamId !== normalized.teamId
      || existing.membershipId !== normalized.membershipId)
  ) {
    throw new PaymentMethodSetupConflictError();
  }

  return db.paymentMethodReference.upsert({
    where: uniqueReference,
    create: { ...normalized, lastValidatedAt: verifiedAt },
    update: {
      scopeType: normalized.scopeType,
      teamId: normalized.teamId,
      membershipId: normalized.membershipId,
      providerCustomerRef: normalized.providerCustomerRef,
      status: "verified",
      verifiedAt,
      expiresAt,
      lastValidatedAt: verifiedAt,
    },
  });
}

function isActiveReference(value: { status: string; verifiedAt: Date | null; expiresAt: Date | null }, now: Date) {
  return value.status === "verified" && value.verifiedAt !== null && (value.expiresAt === null || value.expiresAt > now);
}

export async function assertPaymentMethodReferenceForQuota(
  db: Pick<PrismaClient, "paymentMethodReference">,
  input: { vendorId: string; payerScope: "VENDOR" | "MEMBER"; memberIds: string[]; now?: Date },
) {
  const now = input.now ?? new Date();
  const memberIds = [...new Set(input.memberIds)];
  if (input.payerScope === "MEMBER") {
    if (memberIds.length === 0) throw new PaymentMethodReferenceRequiredError();
    const references = await db.paymentMethodReference.findMany({
      where: {
        vendorId: input.vendorId,
        scopeType: "MEMBERSHIP",
        membershipId: { in: memberIds },
        status: "verified",
      },
      select: { membershipId: true, status: true, verifiedAt: true, expiresAt: true },
    });
    const activeMemberships = new Set(
      references.filter((reference) => isActiveReference(reference, now)).map((reference) => reference.membershipId),
    );
    if (memberIds.some((membershipId) => !activeMemberships.has(membershipId))) {
      throw new PaymentMethodReferenceRequiredError();
    }
    return;
  }

  const reference = await db.paymentMethodReference.findFirst({
    where: { vendorId: input.vendorId, scopeType: "VENDOR", status: "verified" },
    select: { status: true, verifiedAt: true, expiresAt: true },
  });
  if (!reference || !isActiveReference(reference, now)) throw new PaymentMethodReferenceRequiredError();
}
