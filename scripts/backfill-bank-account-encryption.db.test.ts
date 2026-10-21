import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptBankAccount } from "../src/lib/bank-account";
import { getDb } from "../src/lib/db";
import { encryptLegacyRows, scanLegacyRows } from "./backfill-bank-account-encryption";

const vendorIds: string[] = [];
const batchIds: string[] = [];

async function createVendor() {
  const suffix = randomUUID();
  const vendor = await getDb().vendor.create({
    data: { name: "Synthetic backfill", slug: `backfill-${suffix}`, email: `backfill-${suffix}@example.test`, passwordHash: "synthetic-only" },
  });
  vendorIds.push(vendor.id);
  return vendor.id;
}

async function createPlaintextPayoutItems(vendorId: string, count: number) {
  const batch = await getDb().payoutBatch.create({
    data: { batchNumber: `PB-BACKFILL-${randomUUID()}`, batchDate: new Date() },
  });
  batchIds.push(batch.id);
  for (let index = 0; index < count; index += 1) {
    await getDb().payoutItem.create({
      data: {
        payoutBatchId: batch.id,
        vendorId,
        bankAccountDisplayName: "Synthetic Payee",
        bankCodeDisplay: "812",
        bankAccountDisplayNumber: `00000000${index}`,
        payoutAmountCents: 100,
      },
    });
  }
}

afterEach(async () => {
  const db = getDb();
  await db.payoutItem.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.payoutBatch.deleteMany({ where: { id: { in: batchIds.splice(0) } } });
  await db.paymentAccount.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await db.vendor.deleteMany({ where: { id: { in: vendorIds.splice(0) } } });
});

describe("bank account backfill batching", () => {
  it("encrypts legacy rows in several committed batches and is safe to rerun", async () => {
    const vendorId = await createVendor();
    await createPlaintextPayoutItems(vendorId, 5);
    const scope = { vendorIds: [vendorId] };

    expect(await scanLegacyRows(getDb(), 2, scope)).toMatchObject({ payoutItemsToEncrypt: 5, unrecoverableMaskedPayouts: 0 });
    expect(await encryptLegacyRows(getDb(), 2, scope)).toEqual({ paymentAccountsEncrypted: 0, payoutItemsEncrypted: 5, batches: 3 });

    const items = await getDb().payoutItem.findMany({ where: { vendorId }, orderBy: { bankAccountDisplayNumber: "asc" } });
    expect(items.every((item) => item.bankAccountDisplayNumber.startsWith("****"))).toBe(true);
    expect(decryptBankAccount(items[0]!.bankAccountEncrypted!, vendorId).accountNumber).toMatch(/^00000000\d$/);

    // Rerun after completion: nothing left to do, nothing rewritten.
    expect(await encryptLegacyRows(getDb(), 2, scope)).toEqual({ paymentAccountsEncrypted: 0, payoutItemsEncrypted: 0, batches: 1 });
    expect(await getDb().payoutItem.findMany({ where: { vendorId }, orderBy: { bankAccountDisplayNumber: "asc" } })).toEqual(items);
  });

  it("reports a masked legacy account without an envelope as unrecoverable instead of encrypting the mask", async () => {
    const vendorId = await createVendor();
    await getDb().paymentAccount.create({
      data: {
        vendorId,
        mode: "platform",
        providerName: "manual",
        accountLabel: "synthetic",
        bankAccountLegacyName: "S＊＊",
        bankCodeLegacy: "812",
        bankAccountLegacyNumber: "****1234",
      },
    });

    expect(await scanLegacyRows(getDb(), 10, { vendorIds: [vendorId] })).toMatchObject({
      paymentAccountsToEncrypt: 1,
      unrecoverableMaskedAccounts: 1,
      incompleteAccounts: 0,
    });
    await expect(encryptLegacyRows(getDb(), 10, { vendorIds: [vendorId] })).rejects.toThrow("Legacy payment account changed during backfill.");
    expect(await getDb().paymentAccount.count({ where: { vendorId, bankAccountEncrypted: { not: null } } })).toBe(0);
  });
});
