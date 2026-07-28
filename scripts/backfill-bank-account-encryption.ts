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

function isMasked(value: string) {
  return value.startsWith("****");
}

function rotationBatchSize() {
  const index = process.argv.indexOf("--batch-size");
  const raw = index === -1 ? undefined : process.argv[index + 1];
  const value = raw ? Number(raw) : DEFAULT_BATCH_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new Error("Rotation batch size is invalid.");
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    paymentAccountCursor = batch.accounts.at(-1)?.id ?? paymentAccountCursor;
    payoutItemCursor = batch.payoutItems.at(-1)?.id ?? payoutItemCursor;
    // Cursor-based scanning reaches old-key rows even when a preceding page is
    // already current-key, which makes a completed or interrupted rerun safe.
    if (batch.accounts.length < batchSize && batch.payoutItems.length < batchSize) break;
  }
  return { paymentAccountsRotated, payoutItemsRotated };
}

async function main() {
  const execute = process.argv.includes(EXECUTE_FLAG);
  const rotate = process.argv.includes(ROTATE_FLAG);
  const batchSize = rotationBatchSize();
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

    const [accounts, payoutItems] = await Promise.all([
      db.paymentAccount.findMany({
        where: {
          bankAccountEncrypted: null,
          bankAccountLegacyNumber: { not: null },
        },
        select: {
          id: true,
          vendorId: true,
          bankAccountLegacyName: true,
          bankCodeLegacy: true,
          bankAccountLegacyNumber: true,
        },
      }),
      db.payoutItem.findMany({
        where: { bankAccountEncrypted: null },
        select: {
          id: true,
          vendorId: true,
          bankAccountDisplayName: true,
          bankCodeDisplay: true,
          bankAccountDisplayNumber: true,
        },
      }),
    ]);

    const incompleteAccounts = accounts.filter(
      (account) => !account.bankAccountLegacyName
        || !account.bankCodeLegacy
        || !account.bankAccountLegacyNumber,
    );
    const unrecoverableMaskedPayouts = payoutItems.filter(
      (item) => isMasked(item.bankAccountDisplayNumber),
    );

    if (!execute) {
      console.log(JSON.stringify({
        mode: "plan",
        paymentAccountsToEncrypt: accounts.length,
        payoutItemsToEncrypt: payoutItems.length,
        incompleteAccounts: incompleteAccounts.length,
        unrecoverableMaskedPayouts: unrecoverableMaskedPayouts.length,
        secretDetailsEmitted: false,
      }));
      return;
    }

    if (process.env.BANK_ACCOUNT_BACKFILL_CONFIRM !== CONFIRMATION) {
      throw new Error("Backfill confirmation is missing.");
    }
    if (incompleteAccounts.length > 0 || unrecoverableMaskedPayouts.length > 0) {
      throw new Error("Legacy bank account rows require manual remediation before backfill.");
    }

    await db.$transaction(async (tx) => {
      for (const account of accounts) {
        const details = {
          accountName: account.bankAccountLegacyName!,
          bankCode: account.bankCodeLegacy!,
          accountNumber: account.bankAccountLegacyNumber!,
        };
        const display = maskBankAccount(details);
        const updated = await tx.paymentAccount.updateMany({
          where: { id: account.id, bankAccountEncrypted: null },
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

      for (const item of payoutItems) {
        const details = {
          accountName: item.bankAccountDisplayName,
          bankCode: item.bankCodeDisplay,
          accountNumber: item.bankAccountDisplayNumber,
        };
        const display = maskBankAccount(details);
        const updated = await tx.payoutItem.updateMany({
          where: { id: item.id, bankAccountEncrypted: null },
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const [remainingAccounts, remainingPayouts] = await Promise.all([
      db.paymentAccount.count({
        where: {
          bankAccountEncrypted: null,
          bankAccountLegacyNumber: { not: null },
        },
      }),
      db.payoutItem.count({ where: { bankAccountEncrypted: null } }),
    ]);
    if (remainingAccounts !== 0 || remainingPayouts !== 0) {
      throw new Error("Bank account backfill verification failed.");
    }

    console.log(JSON.stringify({
      mode: "execute",
      paymentAccountsEncrypted: accounts.length,
      payoutItemsEncrypted: payoutItems.length,
      remainingUnencrypted: 0,
      secretDetailsEmitted: false,
    }));
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  console.error(JSON.stringify({
    status: "failed",
    safeCategory: "bank-account-backfill",
    secretDetailsEmitted: false,
  }));
  process.exitCode = 1;
});
