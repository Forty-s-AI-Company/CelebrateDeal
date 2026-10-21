import path from "node:path";
import { pathToFileURL } from "node:url";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  encryptBankAccount,
  maskBankAccount,
  rotateBankAccountEnvelope,
} from "../src/lib/bank-account";

const EXECUTE_FLAG = "--execute";
const ROTATE_FLAG = "--rotate";
const CONFIRMATION = "ENCRYPT_LEGACY_BANK_ACCOUNTS";
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCHES = 100_000;
// Prisma's interactive-transaction default (5s) is too short for a batch of
// row-by-row AES-GCM + CAS writes on a busy database. Keep each batch small
// and bounded, but give it a generous timeout and a short pool wait.
const BATCH_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 60_000,
} as const;

function isMasked(value: string) {
  return value.startsWith("****");
}

function batchSizeArgument() {
  const index = process.argv.indexOf("--batch-size");
  const raw = index === -1 ? undefined : process.argv[index + 1];
  const value = raw ? Number(raw) : DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new Error("Batch size is invalid.");
  }
  return value;
}

async function rotateEncryptedRows(db: PrismaClient, batchSize: number) {
  let paymentAccountsRotated = 0;
  let payoutItemsRotated = 0;
  let paymentAccountCursor: string | undefined;
  let payoutItemCursor: string | undefined;

  // Each small Serializable transaction is independently retryable. If a
  // process stops mid-run, already-current envelopes are returned unchanged and
  // the next run resumes from the remaining decrypt-only-key rows.
  while (true) {
    const batch = await db.$transaction(async (tx) => {
      const accounts = await tx.paymentAccount.findMany({
        where: {
          bankAccountEncrypted: { not: null },
          ...(paymentAccountCursor ? { id: { gt: paymentAccountCursor } } : {}),
        },
        select: { id: true, vendorId: true, bankAccountEncrypted: true },
        orderBy: { id: "asc" },
        take: batchSize,
      });
      for (const account of accounts) {
        const current = account.bankAccountEncrypted!;
        const rotated = rotateBankAccountEnvelope(current, account.vendorId);
        if (rotated === current) continue;
        const updated = await tx.paymentAccount.updateMany({
          where: { id: account.id, bankAccountEncrypted: current },
          data: { bankAccountEncrypted: rotated },
        });
        if (updated.count !== 1) throw new Error("Concurrent payment-account rotation conflict.");
        paymentAccountsRotated += 1;
      }

      const payoutItems = await tx.payoutItem.findMany({
        where: {
          bankAccountEncrypted: { not: null },
          ...(payoutItemCursor ? { id: { gt: payoutItemCursor } } : {}),
        },
        select: { id: true, vendorId: true, bankAccountEncrypted: true },
        orderBy: { id: "asc" },
        take: batchSize,
      });
      for (const item of payoutItems) {
        const current = item.bankAccountEncrypted!;
        const rotated = rotateBankAccountEnvelope(current, item.vendorId);
        if (rotated === current) continue;
        const updated = await tx.payoutItem.updateMany({
          where: { id: item.id, bankAccountEncrypted: current },
          data: { bankAccountEncrypted: rotated },
        });
        if (updated.count !== 1) throw new Error("Concurrent payout-item rotation conflict.");
        payoutItemsRotated += 1;
      }
      return {
        accounts,
        payoutItems,
      };
    }, BATCH_TRANSACTION_OPTIONS);

    paymentAccountCursor = batch.accounts.at(-1)?.id ?? paymentAccountCursor;
    payoutItemCursor = batch.payoutItems.at(-1)?.id ?? payoutItemCursor;
    // Cursor-based scanning reaches old-key rows even when a preceding page is
    // already current-key, which makes a completed or interrupted rerun safe.
    if (batch.accounts.length < batchSize && batch.payoutItems.length < batchSize) break;
  }
  return { paymentAccountsRotated, payoutItemsRotated };
}

const legacyAccountWhere = {
  bankAccountEncrypted: null,
  bankAccountLegacyNumber: { not: null },
} satisfies Prisma.PaymentAccountWhereInput;

const legacyAccountSelect = {
  id: true,
  vendorId: true,
  bankAccountLegacyName: true,
  bankCodeLegacy: true,
  bankAccountLegacyNumber: true,
} satisfies Prisma.PaymentAccountSelect;

const legacyPayoutSelect = {
  id: true,
  vendorId: true,
  bankAccountDisplayName: true,
  bankCodeDisplay: true,
  bankAccountDisplayNumber: true,
} satisfies Prisma.PayoutItemSelect;

/** Tests (and a targeted manual run) may restrict the scan to given vendors. */
export type BackfillScope = { vendorIds?: readonly string[] };

function scopeFilter(scope: BackfillScope) {
  return scope.vendorIds ? { vendorId: { in: [...scope.vendorIds] } } : {};
}

type LegacyAccount = Prisma.PaymentAccountGetPayload<{ select: typeof legacyAccountSelect }>;

function isIncompleteAccount(account: LegacyAccount) {
  return !account.bankAccountLegacyName?.trim()
    || !account.bankCodeLegacy?.trim()
    || !account.bankAccountLegacyNumber?.trim();
}

/** Read-only, cursor-paged scan so a large table never loads at once. */
export async function scanLegacyRows(db: PrismaClient, batchSize: number, scope: BackfillScope = {}) {
  const vendorFilter = scopeFilter(scope);
  const plan = {
    paymentAccountsToEncrypt: 0,
    payoutItemsToEncrypt: 0,
    incompleteAccounts: 0,
    unrecoverableMaskedAccounts: 0,
    unrecoverableMaskedPayouts: 0,
  };
  let cursor: string | undefined;
  while (true) {
    const accounts = await db.paymentAccount.findMany({
      where: { ...legacyAccountWhere, ...vendorFilter, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: legacyAccountSelect,
      orderBy: { id: "asc" },
      take: batchSize,
    });
    for (const account of accounts) {
      plan.paymentAccountsToEncrypt += 1;
      if (isIncompleteAccount(account)) plan.incompleteAccounts += 1;
      // A masked legacy number without an envelope has lost the real account.
      else if (isMasked(account.bankAccountLegacyNumber!)) plan.unrecoverableMaskedAccounts += 1;
    }
    cursor = accounts.at(-1)?.id;
    if (accounts.length < batchSize) break;
  }
  let payoutCursor: string | undefined;
  while (true) {
    const items: Prisma.PayoutItemGetPayload<{ select: typeof legacyPayoutSelect }>[] = await db.payoutItem.findMany({
      where: { bankAccountEncrypted: null, ...vendorFilter, ...(payoutCursor ? { id: { gt: payoutCursor } } : {}) },
      select: legacyPayoutSelect,
      orderBy: { id: "asc" },
      take: batchSize,
    });
    for (const item of items) {
      plan.payoutItemsToEncrypt += 1;
      if (isMasked(item.bankAccountDisplayNumber)) plan.unrecoverableMaskedPayouts += 1;
    }
    payoutCursor = items.at(-1)?.id;
    if (items.length < batchSize) break;
  }
  return plan;
}

/**
 * Encrypts legacy rows in small, independently committed Serializable
 * batches. Every write is a CAS on `bankAccountEncrypted IS NULL`, so an
 * interrupted run resumes by running the script again; already-encrypted rows
 * no longer match the batch query.
 */
export async function encryptLegacyRows(db: PrismaClient, batchSize: number, scope: BackfillScope = {}) {
  const vendorFilter = scopeFilter(scope);
  let paymentAccountsEncrypted = 0;
  let payoutItemsEncrypted = 0;
  let batches = 0;
  while (true) {
    const batch = await db.$transaction(async (tx) => {
      const accounts = await tx.paymentAccount.findMany({
        where: { ...legacyAccountWhere, ...vendorFilter },
        select: legacyAccountSelect,
        orderBy: { id: "asc" },
        take: batchSize,
      });
      for (const account of accounts) {
        if (isIncompleteAccount(account) || isMasked(account.bankAccountLegacyNumber!)) {
          throw new Error("Legacy payment account changed during backfill.");
        }
        const details = {
          accountName: account.bankAccountLegacyName!,
          bankCode: account.bankCodeLegacy!,
          accountNumber: account.bankAccountLegacyNumber!,
        };
        const display = maskBankAccount(details);
        const updated = await tx.paymentAccount.updateMany({
          where: { id: account.id, vendorId: account.vendorId, bankAccountEncrypted: null },
          data: {
            bankAccountEncrypted: encryptBankAccount(details, account.vendorId),
            bankAccountLegacyName: display.accountName,
            bankCodeLegacy: display.bankCode,
            bankAccountLegacyNumber: display.accountNumber,
          },
        });
        if (updated.count !== 1) {
          throw new Error("Concurrent payment-account backfill conflict.");
        }
      }

      const payoutItems = await tx.payoutItem.findMany({
        where: { bankAccountEncrypted: null, ...vendorFilter },
        select: legacyPayoutSelect,
        orderBy: { id: "asc" },
        take: batchSize,
      });
      for (const item of payoutItems) {
        if (isMasked(item.bankAccountDisplayNumber)) {
          throw new Error("Legacy payout item changed during backfill.");
        }
        const details = {
          accountName: item.bankAccountDisplayName,
          bankCode: item.bankCodeDisplay,
          accountNumber: item.bankAccountDisplayNumber,
        };
        const display = maskBankAccount(details);
        const updated = await tx.payoutItem.updateMany({
          where: { id: item.id, vendorId: item.vendorId, bankAccountEncrypted: null },
          data: {
            bankAccountEncrypted: encryptBankAccount(details, item.vendorId),
            bankAccountDisplayName: display.accountName,
            bankCodeDisplay: display.bankCode,
            bankAccountDisplayNumber: display.accountNumber,
          },
        });
        if (updated.count !== 1) {
          throw new Error("Concurrent payout-item backfill conflict.");
        }
      }
      return { accounts: accounts.length, payoutItems: payoutItems.length };
    }, BATCH_TRANSACTION_OPTIONS);

    batches += 1;
    paymentAccountsEncrypted += batch.accounts;
    payoutItemsEncrypted += batch.payoutItems;
    if (batch.accounts < batchSize && batch.payoutItems < batchSize) break;
    if (batches >= MAX_BATCHES) throw new Error("Bank account backfill did not converge.");
  }
  return { paymentAccountsEncrypted, payoutItemsEncrypted, batches };
}

async function main() {
  const execute = process.argv.includes(EXECUTE_FLAG);
  const rotate = process.argv.includes(ROTATE_FLAG);
  const batchSize = batchSizeArgument();
  const db = new PrismaClient({ log: [] });

  try {
    if (rotate) {
      if (!execute) {
        console.log(JSON.stringify({
          mode: "rotation-plan",
          batchSize,
          secretDetailsEmitted: false,
        }));
        return;
      }
      if (process.env.BANK_ACCOUNT_BACKFILL_CONFIRM !== CONFIRMATION) {
        throw new Error("Backfill confirmation is missing.");
      }
      const result = await rotateEncryptedRows(db, batchSize);
      console.log(JSON.stringify({
        mode: "rotation-execute",
        batchSize,
        ...result,
        secretDetailsEmitted: false,
      }));
      return;
    }

    const plan = await scanLegacyRows(db, batchSize);
    if (!execute) {
      console.log(JSON.stringify({
        mode: "plan",
        batchSize,
        ...plan,
        secretDetailsEmitted: false,
      }));
      return;
    }

    if (process.env.BANK_ACCOUNT_BACKFILL_CONFIRM !== CONFIRMATION) {
      throw new Error("Backfill confirmation is missing.");
    }
    if (plan.incompleteAccounts > 0 || plan.unrecoverableMaskedAccounts > 0 || plan.unrecoverableMaskedPayouts > 0) {
      throw new Error("Legacy bank account rows require manual remediation before backfill.");
    }

    const result = await encryptLegacyRows(db, batchSize);

    const [remainingAccounts, remainingPayouts] = await Promise.all([
      db.paymentAccount.count({ where: legacyAccountWhere }),
      db.payoutItem.count({ where: { bankAccountEncrypted: null } }),
    ]);
    if (remainingAccounts !== 0 || remainingPayouts !== 0) {
      throw new Error("Bank account backfill verification failed.");
    }

    console.log(JSON.stringify({
      mode: "execute",
      batchSize,
      ...result,
      remainingUnencrypted: 0,
      secretDetailsEmitted: false,
    }));
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(JSON.stringify({
      status: "failed",
      safeCategory: "bank-account-backfill",
      secretDetailsEmitted: false,
    }));
    process.exitCode = 1;
  });
}
