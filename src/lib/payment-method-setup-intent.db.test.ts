import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { getDb } from "@/lib/db";
import { applyVerifiedPaymentMethodSetup } from "@/lib/payment-method-reference";
import { createPaymentMethodSetupIntent, consumePaymentMethodSetupIntent } from "@/lib/payment-method-setup-intent";

let fixture: { vendorId: string; userId: string } | null = null;

afterEach(async () => {
  if (!fixture) return;
  const db = getDb();
  await db.paymentMethodSetupIntent.deleteMany({ where: { vendorId: fixture.vendorId } });
  await db.paymentMethodReference.deleteMany({ where: { vendorId: fixture.vendorId } });
  await db.vendorMember.deleteMany({ where: { vendorId: fixture.vendorId } });
  await db.user.delete({ where: { id: fixture.userId } });
  await db.vendor.delete({ where: { id: fixture.vendorId } });
  fixture = null;
});

async function createFixture() {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({
    data: { name: "Synthetic setup tenant", slug: `setup-${suffix}`,
      email: `setup-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  const user = await db.user.create({
    data: { name: "Synthetic setup actor", email: `actor-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  const member = await db.vendorMember.create({ data: { vendorId: vendor.id, userId: user.id, role: "owner" } });
  fixture = { vendorId: vendor.id, userId: user.id };
  const intent = await createPaymentMethodSetupIntent(db, {
    vendorId: vendor.id, providerName: "payuni", scopeType: "VENDOR",
    teamId: null, membershipId: null, consentActorId: member.id, consentAccepted: true,
  });
  return { db, vendor, member, intent };
}

function event(fixture: Awaited<ReturnType<typeof createFixture>>, eventId: string) {
  return {
    setupIntentId: fixture.intent.intentId,
    setupNonce: fixture.intent.setupNonce,
    providerName: "payuni",
    eventId,
    vendorId: fixture.vendor.id,
    scopeType: "VENDOR" as const,
    providerPaymentMethodRef: `opaque-${eventId}`,
    verifiedAt: new Date().toISOString(),
  };
}

describe("payment method setup intent PostgreSQL boundary", () => {
  it("rolls back intent consumption when reference persistence fails", async () => {
    const fixture = await createFixture();
    const signed = event(fixture, "rollback");
    await expect(fixture.db.$transaction(async (tx) => {
      await consumePaymentMethodSetupIntent(tx, signed);
      throw new Error("synthetic-reference-write-failure");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toThrow("synthetic-reference-write-failure");

    expect(await fixture.db.paymentMethodSetupIntent.findUniqueOrThrow({ where: { id: fixture.intent.intentId } }))
      .toMatchObject({ status: "pending", consumedAt: null });
    expect(await fixture.db.paymentMethodReference.count({ where: { vendorId: fixture.vendor.id } })).toBe(0);
  });

  it("lets only one concurrent signed event consume a consent intent", async () => {
    const fixture = await createFixture();
    const callbacks = [event(fixture, "race-a"), event(fixture, "race-b")];
    const outcomes = await Promise.allSettled(callbacks.map((signed) => fixture.db.$transaction(async (tx) => {
      await consumePaymentMethodSetupIntent(tx, signed);
      await applyVerifiedPaymentMethodSetup(tx, signed);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })));

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    expect(await fixture.db.paymentMethodSetupIntent.findUniqueOrThrow({ where: { id: fixture.intent.intentId } }))
      .toMatchObject({ status: "verified" });
    expect(await fixture.db.paymentMethodReference.count({ where: { vendorId: fixture.vendor.id, status: "verified" } })).toBe(1);
  });
});
