import type { Prisma, PrismaClient } from "@prisma/client";

export const WP4_SANDBOX_FIXTURE = Object.freeze({
  vendorId: "wp4_synthetic_vendor_v1",
  vendorSlug: "wp4-synthetic-vendor-v1",
  vendorEmail: "wp4-synthetic-vendor-v1@invalid.example",
  userId: "wp4_synthetic_owner_v1",
  userEmail: "wp4-synthetic-owner-v1@invalid.example",
  productId: "wp4_synthetic_product_v1",
  productSlug: "wp4-synthetic-product-v1",
  planId: "wp4_synthetic_plan_v1",
  planCode: "wp4-synthetic-plan-v1",
  invoiceId: "wp4_synthetic_invoice_v1",
  invoiceNumber: "WP4-SYNTHETIC-INVOICE-V1",
});

export class Wp4SandboxFixtureConflictError extends Error {
  constructor() {
    super("WP4 synthetic fixture identity conflicts with an existing row.");
    this.name = "Wp4SandboxFixtureConflictError";
  }
}

type FixtureDb = Prisma.TransactionClient | PrismaClient;

function assertIdentity(condition: boolean) {
  if (!condition) throw new Wp4SandboxFixtureConflictError();
}

async function ensureVendor(db: FixtureDb) {
  const existing = await db.vendor.findFirst({
    where: {
      OR: [
        { id: WP4_SANDBOX_FIXTURE.vendorId },
        { slug: WP4_SANDBOX_FIXTURE.vendorSlug },
        { email: WP4_SANDBOX_FIXTURE.vendorEmail },
      ],
    },
    select: { id: true, slug: true, email: true },
  });
  if (existing) {
    assertIdentity(
      existing.id === WP4_SANDBOX_FIXTURE.vendorId
      && existing.slug === WP4_SANDBOX_FIXTURE.vendorSlug
      && existing.email === WP4_SANDBOX_FIXTURE.vendorEmail,
    );
    return false;
  }
  await db.vendor.create({
    data: {
      id: WP4_SANDBOX_FIXTURE.vendorId,
      name: "WP4 Synthetic Sandbox Vendor",
      slug: WP4_SANDBOX_FIXTURE.vendorSlug,
      email: WP4_SANDBOX_FIXTURE.vendorEmail,
      passwordHash: "wp4-synthetic-login-disabled",
    },
  });
  return true;
}

async function ensureOwner(db: FixtureDb) {
  const existing = await db.user.findFirst({
    where: {
      OR: [
        { id: WP4_SANDBOX_FIXTURE.userId },
        { email: WP4_SANDBOX_FIXTURE.userEmail },
      ],
    },
    select: { id: true, email: true, name: true },
  });
  if (existing) {
    assertIdentity(
      existing.id === WP4_SANDBOX_FIXTURE.userId
      && existing.email === WP4_SANDBOX_FIXTURE.userEmail
      && existing.name === "WP4 Synthetic Sandbox Owner",
    );
    await db.user.update({
      where: { id: WP4_SANDBOX_FIXTURE.userId },
      data: { status: "active" },
    });
    return false;
  }
  await db.user.create({
    data: {
      id: WP4_SANDBOX_FIXTURE.userId,
      email: WP4_SANDBOX_FIXTURE.userEmail,
      name: "WP4 Synthetic Sandbox Owner",
      passwordHash: "wp4-synthetic-login-disabled",
      status: "active",
    },
  });
  return true;
}

async function ensureMembership(db: FixtureDb) {
  const existing = await db.vendorMember.findUnique({
    where: {
      vendorId_userId: {
        vendorId: WP4_SANDBOX_FIXTURE.vendorId,
        userId: WP4_SANDBOX_FIXTURE.userId,
      },
    },
    select: { id: true },
  });
  if (existing) {
    await db.vendorMember.update({
      where: { id: existing.id },
      data: { role: "owner", status: "active", deactivatedAt: null },
    });
    return false;
  }
  await db.vendorMember.create({
    data: {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      userId: WP4_SANDBOX_FIXTURE.userId,
      role: "owner",
      status: "active",
    },
  });
  return true;
}

async function ensureProduct(db: FixtureDb) {
  const existing = await db.product.findFirst({
    where: {
      OR: [
        { id: WP4_SANDBOX_FIXTURE.productId },
        {
          vendorId: WP4_SANDBOX_FIXTURE.vendorId,
          slug: WP4_SANDBOX_FIXTURE.productSlug,
        },
      ],
    },
    select: { id: true, vendorId: true, slug: true, name: true },
  });
  if (existing) {
    assertIdentity(
      existing.id === WP4_SANDBOX_FIXTURE.productId
      && existing.vendorId === WP4_SANDBOX_FIXTURE.vendorId
      && existing.slug === WP4_SANDBOX_FIXTURE.productSlug
      && existing.name === "WP4 Synthetic Sandbox Product",
    );
    await db.product.update({
      where: { id: WP4_SANDBOX_FIXTURE.productId },
      data: {
        priceCents: 100,
        currency: "TWD",
        inventory: 20,
        isActive: true,
        commerceDomain: "merchant",
        fulfillmentType: "physical",
        fulfillmentTypeConfirmed: true,
        checkoutUrl: null,
      },
    });
    return false;
  }
  await db.product.create({
    data: {
      id: WP4_SANDBOX_FIXTURE.productId,
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      name: "WP4 Synthetic Sandbox Product",
      slug: WP4_SANDBOX_FIXTURE.productSlug,
      description: "Synthetic staging-only PayUni reconciliation fixture.",
      priceCents: 100,
      currency: "TWD",
      inventory: 20,
      isActive: true,
      commerceDomain: "merchant",
      fulfillmentType: "physical",
      fulfillmentTypeConfirmed: true,
    },
  });
  return true;
}

async function ensurePlan(db: FixtureDb) {
  const existing = await db.billingPlan.findFirst({
    where: {
      OR: [
        { id: WP4_SANDBOX_FIXTURE.planId },
        { code: WP4_SANDBOX_FIXTURE.planCode },
      ],
    },
    select: { id: true, code: true, name: true },
  });
  if (existing) {
    assertIdentity(
      existing.id === WP4_SANDBOX_FIXTURE.planId
      && existing.code === WP4_SANDBOX_FIXTURE.planCode
      && existing.name === "WP4 Synthetic Sandbox Plan",
    );
    await db.billingPlan.update({
      where: { id: WP4_SANDBOX_FIXTURE.planId },
      data: { monthlyPriceCents: 100, isActive: true },
    });
    return false;
  }
  await db.billingPlan.create({
    data: {
      id: WP4_SANDBOX_FIXTURE.planId,
      name: "WP4 Synthetic Sandbox Plan",
      code: WP4_SANDBOX_FIXTURE.planCode,
      monthlyPriceCents: 100,
      includedStreamMinutes: 10,
      isActive: true,
      description: "Synthetic staging-only PayUni reconciliation fixture.",
    },
  });
  return true;
}

async function ensureInvoice(db: FixtureDb) {
  const existing = await db.invoice.findFirst({
    where: {
      OR: [
        { id: WP4_SANDBOX_FIXTURE.invoiceId },
        { invoiceNumber: WP4_SANDBOX_FIXTURE.invoiceNumber },
      ],
    },
    select: { id: true, vendorId: true, invoiceNumber: true, monthKey: true },
  });
  if (existing) {
    assertIdentity(
      existing.id === WP4_SANDBOX_FIXTURE.invoiceId
      && existing.vendorId === WP4_SANDBOX_FIXTURE.vendorId
      && existing.invoiceNumber === WP4_SANDBOX_FIXTURE.invoiceNumber
      && existing.monthKey === "2099-12",
    );
    await db.invoice.update({
      where: { id: WP4_SANDBOX_FIXTURE.invoiceId },
      data: {
        monthlyFeeCents: 100,
        subtotalCents: 100,
        totalCents: 100,
        status: "issued",
        paidAt: null,
      },
    });
    return false;
  }
  await db.invoice.create({
    data: {
      id: WP4_SANDBOX_FIXTURE.invoiceId,
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      monthKey: "2099-12",
      invoiceNumber: WP4_SANDBOX_FIXTURE.invoiceNumber,
      invoiceType: "monthly",
      monthlyFeeCents: 100,
      subtotalCents: 100,
      totalCents: 100,
      status: "issued",
    },
  });
  return true;
}

/**
 * Creates or repairs only the deterministic, non-customer WP4 staging fixture.
 * Any identity collision fails closed before an existing row can be repurposed.
 */
export async function ensureWp4SandboxFixture(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    const outcomes = [
      await ensureVendor(tx),
      await ensureOwner(tx),
      await ensureMembership(tx),
      await ensureProduct(tx),
      await ensurePlan(tx),
      await ensureInvoice(tx),
    ];
    const createdCount = outcomes.filter(Boolean).length;
    return { createdCount, reusedCount: outcomes.length - createdCount };
  });
}
