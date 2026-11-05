import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import { automationCustomerKeyHash } from "../src/lib/automation-workflow";
import { protectCommerceOrderPii } from "../src/lib/commerce-order-pii";
import { encryptSensitiveValue } from "../src/lib/sensitive-data";
import { getStudentPortalDashboard } from "../src/lib/student-portal";
import { ANONYMIZED_EMAIL_PATTERN, anonymizeCustomer, anonymizedEmail } from "./anonymize-customer";
import {
  APPLY_CONFIRMATION,
  OrderKeyBackfillRefusedError,
  PRODUCTION_APPROVAL,
  parseOrderKeyBackfillArguments,
  resolveOrderKeyBackfillTarget,
  runOrderKeyBackfill,
} from "./backfill-order-customer-key-hash";

const db = getDb();
const vendorIds: string[] = [];
const tempDirs: string[] = [];
const confirmed = { BACKFILL_CONFIRM: APPLY_CONFIRMATION };
const planOptions = { apply: false, target: null, batchSize: 2, allowUnreadable: false, vendorId: null, writeIds: null } as const;
const applyOptions = { ...planOptions, apply: true } as const;

async function vendor() {
  const suffix = randomUUID();
  const row = await db.vendor.create({ data: { name: "Synthetic backfill vendor", slug: `backfill-${suffix}`, email: `${suffix}@example.test`, passwordHash: "synthetic-only" } });
  vendorIds.push(row.id);
  return row.id;
}

/**
 * A pre-fix checkout order: encrypted buyer, no key. `envelopeOrderId` lets a
 * test bind the envelope to another order so it cannot be decrypted.
 */
async function order(vendorId: string, email: string, options: { key?: string; envelopeOrderId?: string } = {}) {
  const id = randomUUID();
  const pii = protectCommerceOrderPii({ buyer: { name: "Synthetic buyer", email }, shipping: null }, { vendorId, orderId: options.envelopeOrderId ?? id });
  await db.commerceOrder.create({ data: {
    id, vendorId, automationCustomerKeyHash: options.key ?? null,
    orderNumber: id, checkoutIdempotencyKey: randomUUID(), checkoutIdentityHash: pii.checkoutIdentityHash,
    status: "paid", subtotalAmountCents: 1_000, totalAmountCents: 1_000, paidAmountCents: 1_000, paidAt: new Date(),
    buyerEncryptedEnvelope: pii.buyerEncrypted, buyerMaskedName: pii.buyerNameMasked, buyerMaskedEmail: pii.buyerEmailMasked,
  } });
  return id;
}

async function keys(ids: readonly string[]) {
  const rows = await db.commerceOrder.findMany({ where: { id: { in: [...ids] } }, select: { id: true, automationCustomerKeyHash: true } });
  return Object.fromEntries(rows.map((row) => [row.id, row.automationCustomerKeyHash]));
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-order-key-backfill-root-secret-0123456789");
  vi.stubEnv("JOB_SECRET", "");
});

afterEach(async () => {
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

async function fixture() {
  const a = await vendor();
  const b = await vendor();
  const ids = {
    legacy: await order(a, " Legacy.Buyer@Example.TEST "),
    second: await order(a, "second@example.test"),
    existing: await order(a, "kept@example.test", { key: "pre-existing-key-must-not-change" }),
    anonymized: await order(a, `anonymized+${randomUUID().replaceAll("-", "")}@redacted.invalid`),
    otherTenant: await order(b, "legacy.buyer@example.test"),
  };
  return { a, b, ids, scope: { vendorIds: [a, b] } };
}

describe("scripts/backfill-order-customer-key-hash (PostgreSQL)", () => {
  it("plans per vendor without writing anything", async () => {
    const { a, b, ids, scope } = await fixture();
    const before = await keys(Object.values(ids));

    const plan = await runOrderKeyBackfill(db, planOptions, {}, scope);

    expect(plan).toMatchObject({ mode: "plan", missing: 4, computable: 3, anonymized: 1, unreadable: 0, invalid: 0 });
    if (plan.mode !== "plan") throw new Error("expected a dry run");
    expect(plan.vendors).toEqual(expect.arrayContaining([
      { vendorId: a, missing: 3, computable: 2, anonymized: 1, unreadable: 0, invalid: 0 },
      { vendorId: b, missing: 1, computable: 1, anonymized: 0, unreadable: 0, invalid: 0 },
    ]));
    expect(await keys(Object.values(ids))).toEqual(before);
    // Counts and vendor IDs only: no address or key leaves the run.
    expect(JSON.stringify(plan)).not.toMatch(/@|example\.test/u);
  });

  it("applies once with the portal's key, never overwrites an existing key and is idempotent", async () => {
    const { a, b, ids, scope } = await fixture();

    const first = await runOrderKeyBackfill(db, applyOptions, confirmed, scope);
    expect(first).toEqual({ mode: "apply", updated: 3, changed: 0, anonymized: 1, unreadable: 0, invalid: 0, remainingComputable: 0, remainingMissing: 1 });
    expect(JSON.stringify(first)).not.toMatch(/@|example\.test/u);

    const stored = await keys(Object.values(ids));
    expect(stored[ids.legacy]).toBe(automationCustomerKeyHash(a, "legacy.buyer@example.test"));
    expect(stored[ids.second]).toBe(automationCustomerKeyHash(a, "second@example.test"));
    expect(stored[ids.otherTenant]).toBe(automationCustomerKeyHash(b, "legacy.buyer@example.test"));
    expect(stored[ids.otherTenant]).not.toBe(stored[ids.legacy]);
    expect(stored[ids.existing]).toBe("pre-existing-key-must-not-change");
    expect(stored[ids.anonymized]).toBeNull();

    // The learner portal now finds the backfilled order, and only in its own tenant.
    const dashboard = await getStudentPortalDashboard(db, { vendorId: a, customerKeyHash: automationCustomerKeyHash(a, " LEGACY.buyer@example.test") });
    expect(dashboard.orders.map((row) => row.id)).toEqual([ids.legacy]);

    const second = await runOrderKeyBackfill(db, applyOptions, confirmed, scope);
    expect(second).toEqual({ mode: "apply", updated: 0, changed: 0, anonymized: 1, unreadable: 0, invalid: 0, remainingComputable: 0, remainingMissing: 1 });
    expect(await keys(Object.values(ids))).toEqual(stored);
  });

  it("requires the confirmation value and refuses undecryptable rows unless allowed", async () => {
    const a = await vendor();
    const readable = await order(a, "readable@example.test");
    const unreadable = await order(a, "unreadable@example.test", { envelopeOrderId: randomUUID() });
    const scope = { vendorIds: [a] };

    await expect(runOrderKeyBackfill(db, applyOptions, {}, scope)).rejects.toMatchObject({ category: "confirmation-missing" });
    await expect(runOrderKeyBackfill(db, applyOptions, { BACKFILL_CONFIRM: "yes" }, scope)).rejects.toMatchObject({ category: "confirmation-missing" });
    await expect(runOrderKeyBackfill(db, applyOptions, confirmed, scope)).rejects.toMatchObject({ category: "unreadable-rows" });
    expect(await keys([readable, unreadable])).toEqual({ [readable]: null, [unreadable]: null });

    const result = await runOrderKeyBackfill(db, { ...applyOptions, allowUnreadable: true }, confirmed, scope);
    expect(result).toMatchObject({ updated: 1, unreadable: 1, remainingComputable: 0, remainingMissing: 1 });
    expect(await keys([readable, unreadable])).toEqual({ [readable]: automationCustomerKeyHash(a, "readable@example.test"), [unreadable]: null });
  });

  it("limits a --vendor-id run to that tenant", async () => {
    const { a, ids, scope } = await fixture();
    const result = await runOrderKeyBackfill(db, { ...applyOptions, vendorId: a }, confirmed, scope);
    expect(result).toMatchObject({ updated: 2, anonymized: 1 });
    expect((await keys([ids.otherTenant]))[ids.otherTenant]).toBeNull();
  });

  it("counts a decryptable envelope without a valid buyer as invalid and still applies the rest", async () => {
    const a = await vendor();
    const readable = await order(a, "fine@example.test");
    const broken = await order(a, "placeholder@example.test");
    // Same purpose binding as commerce-order-pii, so it decrypts but fails validation.
    await db.commerceOrder.update({ where: { id: broken }, data: {
      buyerEncryptedEnvelope: encryptSensitiveValue(JSON.stringify({ name: "Synthetic buyer", email: "not-an-address" }), `commerce-order-buyer:${a}:${broken}`),
    } });
    const scope = { vendorIds: [a] };

    expect(await runOrderKeyBackfill(db, planOptions, {}, scope)).toMatchObject({ missing: 2, computable: 1, invalid: 1, unreadable: 0 });
    // Not a key problem, so it does not need --allow-unreadable.
    const result = await runOrderKeyBackfill(db, applyOptions, confirmed, scope);
    expect(result).toEqual({ mode: "apply", updated: 1, changed: 0, anonymized: 0, unreadable: 0, invalid: 1, remainingComputable: 0, remainingMissing: 1 });
    expect(await keys([readable, broken])).toEqual({ [readable]: automationCustomerKeyHash(a, "fine@example.test"), [broken]: null });
  });

  it("leaves an order alone when it is de-identified between the read and the write", async () => {
    const a = await vendor();
    const email = "racing.buyer@example.test";
    const target = await order(a, email);
    const scope = { vendorIds: [a] };
    let raced = false;
    // The real anonymize-customer run lands after the backfill read the old
    // envelope and before its compare-and-swap.
    const racingDb = {
      commerceOrder: {
        findMany: (args: Parameters<typeof db.commerceOrder.findMany>[0]) => db.commerceOrder.findMany(args),
        updateMany: async (args: Parameters<typeof db.commerceOrder.updateMany>[0]) => {
          if (!raced) {
            raced = true;
            const counts = await anonymizeCustomer(db, { vendorId: a, customerKeyHash: automationCustomerKeyHash(a, email), execute: true });
            expect(counts.commerceOrders).toBe(1);
          }
          return db.commerceOrder.updateMany(args);
        },
      },
    } as unknown as Parameters<typeof runOrderKeyBackfill>[0];

    const result = await runOrderKeyBackfill(racingDb, applyOptions, confirmed, scope);
    expect(result).toEqual({ mode: "apply", updated: 0, changed: 1, anonymized: 0, unreadable: 0, invalid: 0, remainingComputable: 0, remainingMissing: 1 });
    expect((await keys([target]))[target]).toBeNull();
    // The anonymize placeholder is recognised by the shared pattern from now on.
    expect(await runOrderKeyBackfill(db, applyOptions, confirmed, scope)).toMatchObject({ updated: 0, anonymized: 1 });
  });

  it("keeps the anonymized placeholder pattern in sync with anonymize-customer", () => {
    for (const rowId of [randomUUID(), "cmw0gj0t60000vdrolrlkq0gm", "Order_ID-01"]) {
      expect(anonymizedEmail(rowId)).toMatch(ANONYMIZED_EMAIL_PATTERN);
    }
    expect(ANONYMIZED_EMAIL_PATTERN.test("anonymized+abc@redacted.invalid.example")).toBe(false);
    expect(ANONYMIZED_EMAIL_PATTERN.test("buyer@redacted.invalid")).toBe(false);
  });

  it("appends exactly the written order IDs to --write-ids", async () => {
    const { ids, scope } = await fixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "order-key-ids-"));
    tempDirs.push(dir);
    const idsFile = path.join(dir, "written-order-ids.txt");

    const first = await runOrderKeyBackfill(db, { ...applyOptions, writeIds: idsFile }, confirmed, scope);
    expect(first).toMatchObject({ updated: 3 });
    const written = fs.readFileSync(idsFile, "utf8").trim().split("\n");
    expect(written.sort()).toEqual([ids.legacy, ids.second, ids.otherTenant].sort());
    expect(fs.readFileSync(idsFile, "utf8")).not.toMatch(/@|example\.test/u);

    await runOrderKeyBackfill(db, { ...applyOptions, writeIds: idsFile }, confirmed, scope);
    expect(fs.readFileSync(idsFile, "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("refuses an unwritable --write-ids path before writing any order", async () => {
    const { ids, scope } = await fixture();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "order-key-ids-"));
    tempDirs.push(dir);
    await expect(runOrderKeyBackfill(db, { ...applyOptions, writeIds: dir }, confirmed, scope)).rejects.toMatchObject({ category: "write-ids-unwritable" });
    expect(Object.values(await keys([ids.legacy, ids.second, ids.otherTenant])).every((key) => key === null)).toBe(true);
  });
});

describe("order key backfill guards", () => {
  const loopback = "postgresql://postgres:postgres@localhost:54329/celebratedeal_test?schema=public";
  const remote = "postgresql://user:pass@db.example.test:5432/celebratedeal?schema=public"; // secret-scan: allow-test-fixture (reserved .test host, fake credentials)

  it("parses only known arguments", () => {
    expect(parseOrderKeyBackfillArguments([])).toEqual({ apply: false, target: null, batchSize: 100, allowUnreadable: false, vendorId: null, writeIds: null });
    expect(parseOrderKeyBackfillArguments(["--apply", "--target=staging", "--batch-size", "50", "--vendor-id", "vendor-1", "--allow-unreadable", "--write-ids", "ids.txt"]))
      .toEqual({ apply: true, target: "staging", batchSize: 50, allowUnreadable: true, vendorId: "vendor-1", writeIds: "ids.txt" });
    for (const argv of [["--execute"], ["--target=prod"], ["--batch-size", "0"], ["--batch-size", "501"], ["--vendor-id"], ["--vendor-id", "a b"],
      ["--write-ids", "ids.txt"], ["--apply", "--write-ids"], ["--apply", "--write-ids", "--vendor-id"]]) {
      expect(() => parseOrderKeyBackfillArguments(argv)).toThrow(OrderKeyBackfillRefusedError);
    }
  });

  it("allows loopback, and requires an explicit target plus owner approval for production", () => {
    expect(resolveOrderKeyBackfillTarget({ DATABASE_URL: loopback }, null)).toEqual({ url: loopback, target: "loopback" });
    expect(() => resolveOrderKeyBackfillTarget({}, null)).toThrow(expect.objectContaining({ category: "missing" }));
    expect(() => resolveOrderKeyBackfillTarget({ DATABASE_URL: loopback }, "production")).toThrow(expect.objectContaining({ category: "target-mismatch" }));
    expect(() => resolveOrderKeyBackfillTarget({ DATABASE_URL: remote }, null)).toThrow(expect.objectContaining({ category: "remote-without-target" }));
    expect(() => resolveOrderKeyBackfillTarget({ DATABASE_URL: remote }, "staging")).toThrow(expect.objectContaining({ category: "not-staging" }));
    expect(() => resolveOrderKeyBackfillTarget({ DATABASE_URL: remote }, "production")).toThrow(expect.objectContaining({ category: "production-not-approved" }));
    expect(() => resolveOrderKeyBackfillTarget({ DATABASE_URL: remote, BACKFILL_PRODUCTION_APPROVAL: "yes" }, "production")).toThrow(expect.objectContaining({ category: "production-not-approved" }));
    expect(resolveOrderKeyBackfillTarget({ DATABASE_URL: remote, BACKFILL_PRODUCTION_APPROVAL: PRODUCTION_APPROVAL }, "production")).toEqual({ url: remote, target: "production" });
  });
});
