import { Prisma, type PrismaClient } from "@prisma/client";
import {
  encryptBankAccount,
  maskBankAccount,
  type BankAccountDetails,
  type BankAccountKeyring,
} from "@/lib/bank-account";

/**
 * F-073 / B04-20: the only application path that writes a merchant payout
 * bank account. The full account is stored exclusively as an encrypted
 * envelope bound to the vendor (AAD); the legacy plaintext columns receive the
 * masked display values only, which the PaymentAccount_bankAccountNumber_masked_check
 * CHECK constraint enforces at the database layer.
 */

export const VENDOR_PAYOUT_ACCOUNT_MODE = "platform";
const NEW_ACCOUNT_PROVIDER = "platform";
const NEW_ACCOUNT_LABEL = "商家撥款帳號";
// A merchant may refresh bank details, but must never lift a platform-imposed
// suspension: only these statuses are (re)activated by a merchant save.
const MERCHANT_ACTIVATABLE_STATUSES = new Set(["pending", "verified", "active"]);
const ACCOUNT_NAME_MAX = 100;

export type VendorPayoutAccountFormError =
  | "invalid_account_name"
  | "invalid_bank_code"
  | "invalid_account_number";

export type ParsedVendorPayoutAccount =
  | { ok: true; details: BankAccountDetails }
  | { ok: false; error: VendorPayoutAccountFormError };

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function parseVendorPayoutAccountForm(formData: FormData): ParsedVendorPayoutAccount {
  const accountName = text(formData, "accountName").replace(/\s+/g, " ");
  const bankCode = text(formData, "bankCode");
  // Bank statements and passbooks commonly print hyphens or spaces.
  const accountNumber = text(formData, "accountNumber").replace(/[\s-]/g, "");

  if (!accountName || Array.from(accountName).length > ACCOUNT_NAME_MAX || /[\u0000-\u001f\u007f]/.test(accountName)) {
    return { ok: false, error: "invalid_account_name" };
  }
  // Taiwan bank code (3 digits), optionally followed by the 4-digit branch code.
  if (!/^\d{3}(?:\d{4})?$/.test(bankCode)) {
    return { ok: false, error: "invalid_bank_code" };
  }
  if (!/^\d{6,20}$/.test(accountNumber)) {
    return { ok: false, error: "invalid_account_number" };
  }
  return { ok: true, details: { accountName, bankCode, accountNumber } };
}

export class VendorPayoutAccountAmbiguousError extends Error {
  constructor() {
    super("Multiple platform payout accounts exist for this vendor.");
    this.name = "VendorPayoutAccountAmbiguousError";
  }
}

type SaveInput = {
  /** Always the authenticated session's vendor, never a form value. */
  vendorId: string;
  actorUserId: string;
  actorLabel: string | null;
  details: BankAccountDetails;
  keyring: BankAccountKeyring;
  auditMeta: { ipAddress: string | null; userAgent: string | null };
};

export type SaveVendorPayoutAccountResult = { kind: "created" | "updated"; accountId: string; status: string };

function maskedSnapshot(account: {
  bankAccountLegacyName: string | null;
  bankCodeLegacy: string | null;
  bankAccountLegacyNumber: string | null;
  bankAccountEncrypted: string | null;
  status: string;
}) {
  const legacyNumber = account.bankAccountLegacyNumber;
  return {
    status: account.status,
    hasEncryptedAccount: Boolean(account.bankAccountEncrypted),
    bankCode: account.bankCodeLegacy,
    // Never copy a pre-backfill plaintext number into the audit trail.
    accountNumberLast4: legacyNumber ? legacyNumber.slice(-4) : null,
    hasAccountName: Boolean(account.bankAccountLegacyName),
  };
}

export async function saveVendorPayoutAccount(
  db: PrismaClient,
  input: SaveInput,
): Promise<SaveVendorPayoutAccountResult> {
  const envelope = encryptBankAccount(input.details, input.vendorId, input.keyring);
  const display = maskBankAccount(input.details);
  const displayData = {
    bankAccountEncrypted: envelope,
    bankAccountLegacyName: display.accountName,
    bankCodeLegacy: display.bankCode,
    bankAccountLegacyNumber: display.accountNumber,
  };

  return db.$transaction(async (tx) => {
    const existing = await tx.paymentAccount.findMany({
      where: { vendorId: input.vendorId, mode: VENDOR_PAYOUT_ACCOUNT_MODE },
      select: {
        id: true,
        status: true,
        bankAccountEncrypted: true,
        bankAccountLegacyName: true,
        bankCodeLegacy: true,
        bankAccountLegacyNumber: true,
      },
      orderBy: { createdAt: "asc" },
    });
    if (existing.length > 1) throw new VendorPayoutAccountAmbiguousError();

    let result: SaveVendorPayoutAccountResult;
    let before: ReturnType<typeof maskedSnapshot> | null = null;
    if (existing.length === 0) {
      const created = await tx.paymentAccount.create({
        data: {
          vendorId: input.vendorId,
          mode: VENDOR_PAYOUT_ACCOUNT_MODE,
          providerName: NEW_ACCOUNT_PROVIDER,
          accountLabel: NEW_ACCOUNT_LABEL,
          status: "active",
          ...displayData,
        },
        select: { id: true, status: true },
      });
      result = { kind: "created", accountId: created.id, status: created.status };
    } else {
      const current = existing[0]!;
      before = maskedSnapshot(current);
      const status = MERCHANT_ACTIVATABLE_STATUSES.has(current.status) ? "active" : current.status;
      // Compound predicate: the row must still belong to this vendor and be
      // the platform payout account that was read above.
      const updated = await tx.paymentAccount.updateMany({
        where: { id: current.id, vendorId: input.vendorId, mode: VENDOR_PAYOUT_ACCOUNT_MODE },
        data: { ...displayData, status },
      });
      if (updated.count !== 1) throw new Error("Concurrent payout account update conflict.");
      result = { kind: "updated", accountId: current.id, status };
    }

    await tx.auditLog.create({
      data: {
        vendorId: input.vendorId,
        actorId: input.actorUserId,
        actorLabel: input.actorLabel,
        action: "vendor_payout_account_saved",
        targetType: "PaymentAccount",
        targetId: result.accountId,
        before: before ?? undefined,
        after: maskedSnapshot({ ...displayData, status: result.status }),
        ipAddress: input.auditMeta.ipAddress,
        userAgent: input.auditMeta.userAgent,
      },
    });
    return result;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
