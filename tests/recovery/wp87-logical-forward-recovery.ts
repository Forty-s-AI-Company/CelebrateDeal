import { PrismaClient } from "@prisma/client";

const mode = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;

if (mode !== "baseline" && mode !== "journal") {
  throw new Error("WP-87 requires a baseline or journal mode.");
}
if (!databaseUrl) {
  throw new Error("WP-87 requires an explicit synthetic database URL.");
}

const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

const ids = {
  vendor: "wp87_vendor",
  user: "wp87_user",
  member: "wp87_member",
  product: "wp87_product",
  payment: "wp87_payment",
  reservation: "wp87_reservation",
  baselineAudit: "wp87_baseline_audit",
  journalAudit: "wp87_journal_audit",
} as const;

async function baseline() {
  await db.vendor.upsert({
    where: { id: ids.vendor },
    update: { name: "WP87 Synthetic Vendor", slug: "wp87-synthetic-vendor", email: "wp87-vendor@celebratedeal.test" },
    create: {
      id: ids.vendor,
      name: "WP87 Synthetic Vendor",
      slug: "wp87-synthetic-vendor",
      email: "wp87-vendor@celebratedeal.test",
      passwordHash: "wp87-synthetic-password-hash",
    },
  });
  await db.user.upsert({
    where: { id: ids.user },
    update: { name: "WP87 Synthetic Owner" },
    create: {
      id: ids.user,
      email: "wp87-owner@celebratedeal.test",
      name: "WP87 Synthetic Owner",
      passwordHash: "wp87-synthetic-password-hash",
    },
  });
  await db.vendorMember.upsert({
    where: { vendorId_userId: { vendorId: ids.vendor, userId: ids.user } },
    update: { id: ids.member, role: "owner", status: "active", deactivatedAt: null },
    create: { id: ids.member, vendorId: ids.vendor, userId: ids.user, role: "owner", status: "active" },
  });
  await db.product.upsert({
    where: { id: ids.product },
    update: { name: "WP87 Synthetic Product", priceCents: 1200, inventory: 10, isActive: true },
    create: {
      id: ids.product,
      vendorId: ids.vendor,
      name: "WP87 Synthetic Product",
      slug: "wp87-synthetic-product",
      priceCents: 1200,
      inventory: 10,
    },
  });
  await db.paymentTransaction.upsert({
    where: { id: ids.payment },
    update: { status: "paid", grossAmountCents: 1200, netAmountCents: 1200 },
    create: {
      id: ids.payment,
      vendorId: ids.vendor,
      providerName: "wp87_synthetic",
      orderNumber: "wp87-order",
      grossAmountCents: 1200,
      netAmountCents: 1200,
      status: "paid",
      metadata: { fixture: "wp87", phase: "baseline" },
    },
  });
  await db.inventoryReservation.upsert({
    where: { paymentTransactionId: ids.payment },
    update: { id: ids.reservation, productId: ids.product, quantity: 1, status: "committed", committedAt: new Date("2026-01-01T00:00:00.000Z") },
    create: {
      id: ids.reservation,
      vendorId: ids.vendor,
      productId: ids.product,
      paymentTransactionId: ids.payment,
      quantity: 1,
      status: "committed",
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      committedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  await db.auditLog.upsert({
    where: { id: ids.baselineAudit },
    update: { action: "wp87.baseline", after: { phase: "baseline" } },
    create: {
      id: ids.baselineAudit,
      vendorId: ids.vendor,
      actorId: ids.user,
      actorLabel: "WP87 Synthetic Owner",
      action: "wp87.baseline",
      targetType: "recovery_fixture",
      targetId: ids.product,
      after: { phase: "baseline" },
    },
  });
}

async function journal() {
  // Explicit set + primary-key upsert make replay deterministic and idempotent.
  const journalAt = new Date("2026-01-02T00:00:00.000Z");
  await db.product.update({ where: { id: ids.product }, data: { inventory: 7, updatedAt: journalAt } });
  await db.auditLog.upsert({
    where: { id: ids.journalAudit },
    update: { action: "wp87.logical_forward_replay", after: { inventory: 7, replay: "idempotent" } },
    create: {
      id: ids.journalAudit,
      vendorId: ids.vendor,
      actorId: ids.user,
      actorLabel: "WP87 Synthetic Owner",
      action: "wp87.logical_forward_replay",
      targetType: "product_inventory",
      targetId: ids.product,
      before: { inventory: 10 },
      after: { inventory: 7, replay: "idempotent" },
      createdAt: journalAt,
    },
  });
}

async function main() {
  try {
  if (mode === "baseline") await baseline();
  if (mode === "journal") await journal();
  console.log(JSON.stringify({ work_package: "WP-87", mode, status: "PASS" }));
  } finally {
    await db.$disconnect();
  }
}

void main();
