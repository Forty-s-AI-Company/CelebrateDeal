import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import { classifyVendor, main, maskSlug, readStagingSyntheticInventory, renderMarkdownSummary } from "./staging-synthetic-inventory";

const db = getDb();

describe("staging synthetic inventory", () => {
  it("lists vendors with allowed keys only and never prints e-mail, name or amounts", async () => {
    const suffix = randomUUID();
    const personalEmail = `owner+demo-${suffix}@example.test`;
    const synthetic = await db.vendor.create({ data: { name: `Synthetic Inventory ${suffix}`, slug: `inv-a-${suffix}`, email: personalEmail, passwordHash: "synthetic-only" } });
    const real = await db.vendor.create({ data: { name: `Beta Shop ${suffix}`, slug: `shop-${suffix}`, email: `beta-${suffix}@customer-mail.io`, passwordHash: "synthetic-only" } });
    const marker = 987654321;
    await db.product.create({ data: { vendorId: synthetic.id, name: "Inventory product", slug: `p-${suffix}`, priceCents: marker } });
    await db.video.create({ data: { vendorId: synthetic.id, title: "Inventory video", videoUrl: "https://example.test/v", cloudflareStreamUid: `uid-${suffix}` } });
    const before = await db.vendor.count();

    const inventory = await readStagingSyntheticInventory(db);

    const a = inventory.vendors.find((v) => v.vendorId === synthetic.id)!;
    const b = inventory.vendors.find((v) => v.vendorId === real.id)!;
    expect(Object.keys(a).sort()).toEqual(["counts", "createdAt", "emailDomain", "signals", "slugMasked", "synthetic", "vendorId"]);
    expect(Object.keys(a.counts).sort()).toEqual(["customers", "lives", "orders", "paymentTransactions", "products", "registrations", "testOrders", "videos"]);
    expect(a.synthetic).toBe(true);
    expect(a.signals).toEqual(expect.arrayContaining(["email-domain", "email-plus-demo", "name-marker"]));
    expect(a.emailDomain).toBe("example.test");
    expect(a.slugMasked.length).toBeLessThanOrEqual(9);
    expect(a.counts.products).toBe(1);
    expect(a.counts.videos).toBe(1);
    expect(b.synthetic).toBe(false);
    expect(inventory.cloudflareStreamVideos).toContainEqual({ vendorId: synthetic.id, uid: `uid-${suffix}` });

    const printed = JSON.stringify(inventory) + renderMarkdownSummary(inventory);
    expect(printed).not.toContain(personalEmail);
    expect(printed).not.toContain(`beta-${suffix}`);
    expect(printed).not.toContain("Synthetic Inventory");
    expect(printed).not.toContain("Beta Shop");
    expect(printed).not.toContain(synthetic.slug);
    expect(printed).not.toContain(String(marker));
    expect(await db.vendor.count()).toBe(before);
  });

  it("reads inside a database-enforced read-only repeatable-read transaction", async () => {
    const statements: string[] = [];
    const empty = { groupBy: vi.fn(async () => []), findMany: vi.fn(async () => []) };
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $executeRaw: (...args: unknown[]) => { statements.push(String((args[0] as TemplateStringsArray).join("?"))); return Promise.resolve(0); },
      vendor: empty, product: empty, commerceOrder: empty, paymentTransaction: empty, live: empty, video: empty,
      customerCrmRecord: empty, registrationForm: empty, formSubmission: empty,
    }));
    await expect(readStagingSyntheticInventory({ $transaction: transaction } as never)).resolves.toMatchObject({ vendorTotal: 0, databaseWrites: false });
    expect(statements).toEqual(["SET TRANSACTION READ ONLY"]);
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 60_000 });
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`UPDATE "Vendor" SET "name" = "name" WHERE false`;
    })).rejects.toThrow();
  });

  it("classifies signals and masks slugs", () => {
    expect(classifyVendor({ slug: "wuhe-select", email: "demo@celebratedeal.local", name: "x" }, 0)).toEqual(["email-domain", "slug-prefix"]);
    expect(classifyVendor({ slug: "real", email: "a@gmail.com", name: "Real" }, 0)).toEqual([]);
    expect(classifyVendor({ slug: "real", email: "a@gmail.com", name: "Real" }, 2)).toEqual(["test-orders"]);
    expect(maskSlug("abcdefghijkl")).toBe("abcdefgh…");
    expect(maskSlug("abc")).toBe("abc");
  });

  it("refuses to run without an injected DATABASE_URL", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(main({})).resolves.toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining("DATABASE_URL must be injected"));
    error.mockRestore();
  });
});
