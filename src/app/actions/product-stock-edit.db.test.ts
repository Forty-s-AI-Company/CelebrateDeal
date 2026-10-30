import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

import { getDb } from "@/lib/db";
import {
  createReservedPaymentTransaction,
  InventoryUnavailableError,
  ProductChangedError,
} from "@/lib/inventory-reservations";
import { initialProductActionState } from "@/lib/product-action-state";
import { mutateProduct } from "./product-actions";

/**
 * B-2: sales no longer move Product.revision, so the merchant edit form guards
 * stock with its own compare-and-set on `inventoryBaseline`. Real PostgreSQL;
 * the transport-neutral mutation skips only the request/session boundary.
 */

const vendors: string[] = [];
afterEach(async () => {
  await getDb().vendor.deleteMany({ where: { id: { in: vendors.splice(0) } } });
});

async function fixture(inventory: number) {
  const db = getDb();
  const suffix = randomUUID();
  const vendor = await db.vendor.create({ data: { name: "Synthetic stock edit", slug: suffix, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendors.push(vendor.id);
  const product = await db.product.create({ data: {
    vendorId: vendor.id, name: "Synthetic product", slug: `stock-${suffix}`, priceCents: 1200, inventory,
    fulfillmentType: "physical", fulfillmentTypeConfirmed: true,
  } });
  return { db, vendor, product };
}

/** The edit form exactly as the browser posts it: loaded revision and stock. */
function editForm(product: { id: string; slug: string; revision: number }, fields: { inventory: number; inventoryBaseline: number; name?: string }) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    id: product.id, revision: String(product.revision), inventoryBaseline: String(fields.inventoryBaseline),
    name: fields.name ?? "Synthetic product", slug: product.slug, price: "12", inventory: String(fields.inventory),
    currency: "TWD", fulfillmentType: "physical", isActive: "on",
  })) data.set(key, value);
  return data;
}

function buy(vendorId: string, product: { id: string; revision: number; priceCents: number }) {
  const key = randomUUID();
  return createReservedPaymentTransaction({
    vendorId, productId: product.id, expectedProductRevision: product.revision, checkoutIdempotencyKey: key,
    transactionData: {
      vendorId, checkoutIdempotencyKey: key, providerName: "demo", orderNumber: `STOCK-${key}`,
      paymentMode: "platform", grossAmountCents: product.priceCents, netAmountCents: product.priceCents, currency: "TWD", status: "pending",
    },
  });
}

describe("merchant stock edit versus concurrent sales (B-2)", () => {
  it("rejects a stock edit loaded before sales and keeps every sale counted", async () => {
    const { db, vendor, product } = await fixture(5);
    // The merchant opened the edit page at stock 5; three buyers then buy at once.
    const sales = await Promise.allSettled([1, 2, 3].map(() => buy(vendor.id, product)));
    expect(sales.every((sale) => sale.status === "fulfilled")).toBe(true);

    const stale = await mutateProduct(vendor.id, initialProductActionState, editForm(product, { inventory: 8, inventoryBaseline: 5 }));
    expect(stale).toMatchObject({ ok: false, state: { error: "conflict" } });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2, revision: product.revision });

    // A content-only edit from the same stale page still saves, without touching stock.
    const renamed = await mutateProduct(vendor.id, initialProductActionState, editForm(product, { inventory: 5, inventoryBaseline: 5, name: "Renamed" }));
    expect(renamed).toEqual({ ok: true, destination: "/products?updated=saved" });
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 2, revision: product.revision + 1, name: "Renamed" });

    // An edit loaded at the current stock applies.
    const current = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    const restock = await mutateProduct(vendor.id, initialProductActionState, editForm(current, { inventory: 10, inventoryBaseline: 2, name: "Renamed" }));
    expect(restock.ok).toBe(true);
    expect(await db.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ inventory: 10, revision: product.revision + 2 });
    expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id } })).toBe(3);
  });

  it("never oversells when a stock edit races concurrent buyers", async () => {
    for (let round = 0; round < 5; round += 1) {
      const { db, vendor, product } = await fixture(2);
      // The merchant stops the sale (stock 2 -> 0) while five buyers press pay.
      const [edit, ...sales] = await Promise.allSettled([
        mutateProduct(vendor.id, initialProductActionState, editForm(product, { inventory: 0, inventoryBaseline: 2 })),
        ...[1, 2, 3, 4, 5].map(() => buy(vendor.id, product)),
      ]);
      expect(edit.status).toBe("fulfilled");
      const editApplied = edit.status === "fulfilled" && edit.value.ok;
      if (edit.status === "fulfilled" && !edit.value.ok) expect(edit.value.state.error).toBe("conflict");
      for (const sale of sales) {
        if (sale.status === "rejected") {
          expect(sale.reason instanceof InventoryUnavailableError || sale.reason instanceof ProductChangedError, String(sale.reason)).toBe(true);
        }
      }
      const winners = sales.filter((sale) => sale.status === "fulfilled").length;
      const after = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(after.inventory).toBeGreaterThanOrEqual(0);
      // The edit only applies while stock is still 2, i.e. before any sale; then no sale follows it.
      expect(after.inventory + winners).toBe(editApplied ? 0 : 2);
      expect(after.revision).toBe(product.revision + (editApplied ? 1 : 0));
      expect(await db.paymentTransaction.count({ where: { vendorId: vendor.id } })).toBe(winners);
      expect(await db.inventoryReservation.count({ where: { vendorId: vendor.id, status: "reserved" } })).toBe(winners);
    }
  });
});
