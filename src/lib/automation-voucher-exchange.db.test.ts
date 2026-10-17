import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db";
import { hashInteractionBearer, resolveEligibleAutomationVoucherClaim } from "@/lib/live-interaction";
import { exchangeAutomationVoucher, previewAutomationVoucher } from "./automation-voucher-exchange";
const db = getDb(), vendors: string[] = [];
const challenge = () => ({ nonce: randomBytes(32).toString("base64url"), issued: String(Date.now()) });
beforeEach(() => vi.stubEnv("CSRF_SECRET", "synthetic-voucher-retry-key-only-20261012"));
async function fixture() {
  const id = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic voucher confirmation", slug: id, email: `${id}@example.test`, passwordHash: "synthetic-only" } }); vendors.push(vendor.id);
  const product = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic product", slug: id, priceCents: 1000, inventory: 10 } });
  const bearer = randomBytes(32).toString("base64url");
  const grant = await db.automationVoucherGrant.create({ data: { vendorId: vendor.id, productId: product.id, customerKeyHash: "synthetic-only", claimTokenHash: hashInteractionBearer(bearer), discountType: "percentage", discountValue: 10, expiresAt: new Date(Date.now() + 60_000) } });
  return { vendor, product, bearer, grant };
}
afterEach(async () => {
  vi.unstubAllEnvs(); const ids = vendors.splice(0); await db.automationVoucherGrant.deleteMany({ where: { vendorId: { in: ids } } }); await db.product.deleteMany({ where: { vendorId: { in: ids } } }); await db.vendor.deleteMany({ where: { id: { in: ids } } });
});
describe("voucher exchange PostgreSQL boundaries", () => {
  it("keeps preview read-only and permits exactly one of twelve exchanges", async () => {
    const f = await fixture();
    expect((await previewAutomationVoucher(db, f.bearer))?.id).toBe(f.grant.id);
    expect((await db.automationVoucherGrant.findUniqueOrThrow({ where: { id: f.grant.id } })).claimTokenHash).toBe(f.grant.claimTokenHash);
    const results = await Promise.all(Array.from({ length: 12 }, () => exchangeAutomationVoucher(db, f.bearer, challenge())));
    const winners = results.filter((r) => r !== null); expect(winners).toHaveLength(1);
    const winner = winners[0]!;
    expect(await exchangeAutomationVoucher(db, f.bearer, challenge())).toBeNull(); expect(await previewAutomationVoucher(db, f.bearer)).toBeNull();
    const checkout = { vendorId: f.vendor.id, productId: f.product.id, priceCents: 1000, currency: "TWD" };
    expect(await resolveEligibleAutomationVoucherClaim(db, winner.bearer, checkout)).toEqual({ id: f.grant.id, source: "automation", discountAmountCents: 100 });
    expect(await resolveEligibleAutomationVoucherClaim(db, winner.bearer, { ...checkout, vendorId: "other" })).toBeNull();
    expect(await resolveEligibleAutomationVoucherClaim(db, winner.bearer, { ...checkout, productId: "other" })).toBeNull();
    const row = await db.automationVoucherGrant.findUniqueOrThrow({ where: { id: f.grant.id } }); expect(row.usedOrderId).toBeNull(); expect(row.redeemedAt).toBeNull(); expect(row.discountValue).toBe(10);
  });
  it("recovers a lost response for the same challenge without a second CAS or another browser's replay", async () => {
    const f = await fixture(), same = challenge();
    const first = await exchangeAutomationVoucher(db, f.bearer, same); expect(first?.exchanged).toBe(true);
    const retry = await exchangeAutomationVoucher(db, f.bearer, same); expect(retry?.exchanged).toBe(false); expect(retry?.bearer).toBe(first?.bearer);
    expect(await exchangeAutomationVoucher(db, f.bearer, challenge())).toBeNull();
    expect(await resolveEligibleAutomationVoucherClaim(db, retry!.bearer, { vendorId: f.vendor.id, productId: f.product.id, priceCents: 1000, currency: "TWD" })).toMatchObject({ discountAmountCents: 100 });
    expect(await exchangeAutomationVoucher(db, f.bearer, same, new Date(Number(same.issued) + 300_000))).toBeNull();
  });
  it("refuses exact expiry, malformed and used grants without rotating", async () => {
    const f = await fixture(); expect(await exchangeAutomationVoucher(db, f.bearer, challenge(), f.grant.expiresAt)).toBeNull(); expect(await exchangeAutomationVoucher(db, "bad", challenge())).toBeNull();
    await db.automationVoucherGrant.update({ where: { id: f.grant.id }, data: { usedOrderId: "synthetic-used" } });
    expect(await exchangeAutomationVoucher(db, f.bearer, challenge())).toBeNull();
    expect((await db.automationVoucherGrant.findUniqueOrThrow({ where: { id: f.grant.id } })).claimTokenHash).toBe(f.grant.claimTokenHash);
  });
});
