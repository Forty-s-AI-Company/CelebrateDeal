import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/lib/db";
import { automationCustomerKeyHash } from "../src/lib/automation-workflow";
import { protectCommerceOrderPii } from "../src/lib/commerce-order-pii";
import { getStudentPortalDashboard } from "../src/lib/student-portal";
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
const confirmed = { BACKFILL_CONFIRM: APPLY_CONFIRMATION };
const planOptions = { apply: false, target: null, batchSize: 2, allowUnreadable: false, vendorId: null } as const;
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
});

describe("order key backfill guards", () => {
  const loopback = "postgresql://postgres:postgres@localhost:54329/celebratedeal_test?schema=public";
  const remote = "postgresql://user:pass@db.example.test:5432/app";

  it("parses only known arguments", () => {
    expect(parseOrderKeyBackfillArguments([])).toEqual({ apply: false, target: null, batchSize: 100, allowUnreadable: false, vendorId: null });
    expect(parseOrderKeyBackfillArguments(["--apply", "--target=staging", "--batch-size", "50", "--vendor-id", "vendor-1", "--allow-unreadable"]))
      .toEqual({ apply: true, target: "staging", batchSize: 50, allowUnreadable: true, vendorId: "vendor-1" });
    for (const argv of [["--execute"], ["--target=prod"], ["--batch-size", "0"], ["--batch-size", "501"], ["--vendor-id"], ["--vendor-id", "a b"]]) {
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
