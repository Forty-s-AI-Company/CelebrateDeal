import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { createInteractionBearer, hashInteractionBearer } from "@/lib/live-interaction";
import { consumeFlashSaleQuote, FlashSaleUnavailableError, resolveFlashSaleQuote } from "./live-flash-sale";

const vendors: string[] = [];
afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

async function fixture(configuration: Record<string, unknown> = {}) {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic flash sale", slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  const live = await db.live.create({ data: { vendorId: vendor.id, title: "Synthetic live", slug: suffix, scheduledAt: new Date(), status: "live" } });
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic product", slug: suffix, priceCents: 2000, inventory: 5, fulfillmentTypeConfirmed: true } });
  await db.liveProduct.create({ data: { vendorId: vendor.id, liveId: live.id, productId: product.id } });
  const run = await db.liveInteractionRun.create({ data: {
    vendorId: vendor.id, liveId: live.id, source: "manual", eventType: "flash_sale", title: "Sale",
    startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60000),
    configuration: { kind: "flash_sale", durationSec: 60, productId: product.id, salePriceCents: 1000, originalPriceCents: 2000, stockLimit: 1, ...configuration },
  } });
  const bearers = [createInteractionBearer(), createInteractionBearer()];
  await db.liveInteractionResponse.createMany({ data: bearers.map((bearer) => ({
    vendorId: vendor.id, liveId: live.id, runId: run.id, productId: product.id,
    eventType: "flash_sale", participantHash: randomUUID(), value: "buy",
    claimTokenHash: hashInteractionBearer(bearer), expiresAt: run.endsAt,
  })) });
  return { db, vendor, live, product, run, bearers, scope: { vendorId: vendor.id, productId: product.id } };
}

describe("flash sale authoritative price and reservation", () => {
  it("quotes only server prices and rejects unrelated tenant/product, expired and closed offers", async () => {
    const f = await fixture();
    const quote = await resolveFlashSaleQuote(f.db, f.bearers[0], f.scope);
    expect(quote).toMatchObject({ priceCents: 2000, salePriceCents: 1000, currency: "TWD", stockLimit: 1 });
    expect(await resolveFlashSaleQuote(f.db, f.bearers[0], { ...f.scope, vendorId: "other" })).toBeNull();
    expect(await resolveFlashSaleQuote(f.db, f.bearers[0], { ...f.scope, productId: "other" })).toBeNull();
    await expect(resolveFlashSaleQuote(f.db, f.bearers[0], { ...f.scope, now: f.run.endsAt })).rejects.toBeInstanceOf(FlashSaleUnavailableError);
    await f.db.liveInteractionRun.update({ where: { id: f.run.id }, data: { status: "closed" } });
    await expect(resolveFlashSaleQuote(f.db, f.bearers[0], f.scope)).rejects.toBeInstanceOf(FlashSaleUnavailableError);
  });

  it.each([{ salePriceCents: 0 }, { salePriceCents: 2500 }, { salePriceCents: 999 }, { salePriceCents: "1000" }, { originalPriceCents: 3000 }, { stockLimit: -1 }])("rejects invalid displayed terms %j", async (configuration) => {
    const f = await fixture(configuration);
    await expect(resolveFlashSaleQuote(f.db, f.bearers[0], f.scope)).rejects.toBeInstanceOf(FlashSaleUnavailableError);
  });

  it("rejects a product unbound after quoting and rolls back claim consumption", async () => {
    const f = await fixture();
    const quote = (await resolveFlashSaleQuote(f.db, f.bearers[0], f.scope))!;
    await expect(f.db.$transaction(async (tx) => {
      await consumeFlashSaleQuote(tx, f.bearers[0]!, quote, "synthetic-order");
      throw new Error("simulated later order failure");
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toThrow("simulated later order failure");
    expect((await f.db.liveInteractionResponse.findUniqueOrThrow({ where: { id: quote.claimId } })).usedOrderId).toBeNull();
    await f.db.liveProduct.deleteMany({ where: { liveId: f.live.id } });
    await expect(f.db.$transaction((tx) => consumeFlashSaleQuote(tx, f.bearers[0]!, quote, "synthetic-order"), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toBeInstanceOf(FlashSaleUnavailableError);
  });

  it("allows only one concurrent last-slot reservation and preserves the consumed claim", async () => {
    const f = await fixture();
    const quotes = await Promise.all(f.bearers.map((bearer) => resolveFlashSaleQuote(f.db, bearer, f.scope)));
    const results = await Promise.allSettled(quotes.map((quote, index) => f.db.$transaction(
      (tx) => consumeFlashSaleQuote(tx, f.bearers[index]!, quote!, `synthetic-order-${index}`),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    )));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await f.db.liveInteractionResponse.count({ where: { runId: f.run.id, usedOrderId: { not: null } } })).toBe(1);
    const loser = results.findIndex((result) => result.status === "rejected");
    await expect(f.db.$transaction((tx) => consumeFlashSaleQuote(tx, f.bearers[loser]!, quotes[loser]!, "retry"), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toBeInstanceOf(FlashSaleUnavailableError);
  });

  it("rejects product or run revision changes between quote and reservation", async () => {
    const f = await fixture();
    const quote = (await resolveFlashSaleQuote(f.db, f.bearers[0], f.scope))!;
    await f.db.product.update({ where: { id: f.product.id }, data: { revision: { increment: 1 } } });
    await expect(f.db.$transaction((tx) => consumeFlashSaleQuote(tx, f.bearers[0]!, quote, "changed"), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toBeInstanceOf(FlashSaleUnavailableError);
    const revisedQuote = (await resolveFlashSaleQuote(f.db, f.bearers[0], f.scope))!;
    await f.db.liveInteractionRun.update({ where: { id: f.run.id }, data: { updatedAt: new Date(f.run.updatedAt.getTime() + 1000) } });
    await expect(f.db.$transaction((tx) => consumeFlashSaleQuote(tx, f.bearers[0]!, revisedQuote, "changed-again"), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })).rejects.toBeInstanceOf(FlashSaleUnavailableError);
  });
});
