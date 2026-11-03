import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import { main, readNonTwdCurrencyInventory } from "./non-twd-currency-preflight";

const db = getDb();

describe("non-TWD currency preflight (F-041)", () => {
  it("lists non-TWD products and groups without changing any record", async () => {
    const suffix = randomUUID();
    const vendor = await db.vendor.create({ data: { name: "Synthetic currency shop", slug: `currency-${suffix}`, email: `currency-${suffix}@example.test`, passwordHash: "synthetic-only" } });
    // A price that cannot appear inside a cuid (lower-case base 36 with a leading letter).
    const marker = 123456789;
    const usd = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic USD", slug: `usd-${suffix}`, priceCents: marker, compareAtCents: marker, currency: "USD", isActive: false } });
    const twd = await db.product.create({ data: { vendorId: vendor.id, name: "Synthetic TWD", slug: `twd-${suffix}`, priceCents: marker, currency: "TWD" } });
    const before = await db.product.findMany({ where: { vendorId: vendor.id }, orderBy: { id: "asc" } });

    const inventory = await readNonTwdCurrencyInventory(db);

    expect(inventory.products.listed).toContainEqual({ vendorId: vendor.id, productId: usd.id, currency: "USD", isActive: false });
    expect(inventory.products.listed.some((row) => row.productId === twd.id)).toBe(false);
    expect(inventory.products.total).toBeGreaterThanOrEqual(1);
    expect(inventory.total).toBeGreaterThanOrEqual(inventory.products.total);
    // Only identifiers, tenant ids, currency codes and counts leave the snapshot:
    // assert the parsed structure, not a substring of the serialized output.
    const printed = JSON.parse(JSON.stringify(inventory)) as {
      products: { total: unknown; listed: Array<Record<string, unknown>> };
      groups: Record<string, Array<Record<string, unknown>>>;
      refundsOfNonTwdPayments: unknown;
      total: unknown;
    };
    expect(Object.keys(printed).sort()).toEqual(["groups", "products", "refundsOfNonTwdPayments", "total"]);
    expect(Object.keys(printed.products).sort()).toEqual(["listed", "total"]);
    for (const row of printed.products.listed) {
      expect(Object.keys(row).sort()).toEqual(["currency", "isActive", "productId", "vendorId"]);
    }
    for (const rows of Object.values(printed.groups)) {
      for (const row of rows) expect(Object.keys(row).sort()).toEqual(["count", "currency", "vendorId"]);
    }
    // Second layer: neither the product name nor its price is anywhere in the output.
    expect(JSON.stringify(inventory)).not.toContain("Synthetic USD");
    expect(JSON.stringify(inventory)).not.toContain(String(marker));
    expect(await db.product.findMany({ where: { vendorId: vendor.id }, orderBy: { id: "asc" } })).toEqual(before);
  });

  it("runs every read inside a database-enforced read-only transaction", async () => {
    const statements: string[] = [];
    const executeRaw = vi.fn(async () => 0);
    const record = (label: string) => vi.fn(async () => { statements.push(label); return label.endsWith("count") ? 0 : []; });
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $executeRaw: (...args: unknown[]) => { statements.push(String((args[0] as TemplateStringsArray).join("?"))); return executeRaw(); },
      product: { count: record("product.count"), findMany: record("product.findMany") },
      paymentTransaction: { groupBy: vi.fn(async () => []) },
      commerceOrder: { groupBy: vi.fn(async () => []) },
      electronicInvoice: { groupBy: vi.fn(async () => []) },
      postPurchaseCredit: { groupBy: vi.fn(async () => []) },
      courseCommissionAllocation: { groupBy: vi.fn(async () => []) },
      automationVoucherGrant: { groupBy: vi.fn(async () => []) },
      merchantAffiliateCheckoutSnapshot: { groupBy: vi.fn(async () => []) },
      platformReferralCommission: { groupBy: vi.fn(async () => []) },
      refundRecord: { count: vi.fn(async () => 0) },
    }));
    await expect(readNonTwdCurrencyInventory({ $transaction: transaction } as never)).resolves.toMatchObject({ total: 0 });
    // The read-only statement is the first one in the snapshot.
    expect(statements[0]).toBe("SET TRANSACTION READ ONLY");
    expect(statements.slice(1, 3)).toEqual(["product.count", "product.findMany"]);
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 30_000 });

    // PostgreSQL itself rejects a write after SET TRANSACTION READ ONLY.
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`UPDATE "Vendor" SET "name" = "name" WHERE false`;
    })).rejects.toThrow();
  });

  it("refuses to run without an injected DATABASE_URL", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(main({})).resolves.toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL must be injected"));
    error.mockRestore();
  });
});
