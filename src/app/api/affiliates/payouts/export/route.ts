import { NextResponse } from "next/server";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorFinance } from "@/lib/auth";
import { decryptBankAccount } from "@/lib/bank-account";
import { assertServerActionSecurity } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { readFormDataBody } from "@/lib/api-security";
import { decryptTaxIdentity } from "@/lib/tax-identity";

type ExportType = "bank" | "tax";

export function csvCell(value: string | number | null | undefined) {
  const raw = String(value ?? "");
  // Spreadsheet programs evaluate leading formula characters. Prefixing an
  // apostrophe preserves the value while keeping CSV downloads inert.
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function csvResponse(filename: string, header: string[], rows: Array<Array<string | number | null | undefined>>) {
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function unavailableExport() {
  return NextResponse.json(
    { error: "Payout export data is unavailable" },
    {
      status: 409,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function exportType(value: FormDataEntryValue | null): ExportType | null {
  return value === "bank" || value === "tax" ? value : null;
}

/**
 * Exports only signed, requested, payable affiliate payouts for the current
 * merchant. The browser posts a CSRF token because these files contain bank
 * and tax PII and must never be triggered by a cross-site GET.
 */
export async function POST(request: Request) {
  const { user, member, vendor } = await requireVendorFinance("/affiliates/commissions");
  const formData = await readFormDataBody(request);
  if (!formData) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  await assertServerActionSecurity(formData);

  const queryType = exportType(new URL(request.url).searchParams.get("type"));
  const formType = exportType(formData.get("type"));
  // The query form keeps the download URL explicit, while the hidden field
  // survives clients that strip an action query string. Reject disagreement.
  const type = queryType ?? formType;
  if (!type || (queryType && formType && queryType !== formType)) {
    return NextResponse.json({ error: "Invalid export type" }, { status: 400 });
  }

  const payouts = await getDb().affiliatePayout.findMany({
    where: {
      vendorId: vendor.id,
      requestedAt: { not: null },
      signedAt: { not: null },
      status: "pending",
    },
    orderBy: [{ monthKey: "asc" }, { createdAt: "asc" }],
    include: { affiliate: { select: { name: true } } },
  });

  try {
    const response = type === "bank"
      ? csvResponse(
        "affiliate-payouts-bank.csv",
        ["戶名", "銀行代碼", "分行", "帳號", "實付金額"],
        payouts.map((payout) => {
          if (!payout.requestedBankAccountEncrypted || payout.netPayoutAmountCents == null) {
            throw new Error("Payout export data is unavailable");
          }
          const bankAccount = decryptBankAccount(payout.requestedBankAccountEncrypted, vendor.id);
          return [bankAccount.accountName, bankAccount.bankCode, bankAccount.bankBranch ?? "", bankAccount.accountNumber, payout.netPayoutAmountCents / 100];
        }),
      )
      : csvResponse(
        "affiliate-payouts-tax.csv",
        ["所得人身分證字號", "姓名", "所得格式代號", "給付總額", "扣繳稅額", "健保費", "所得所屬年月"],
        payouts.map((payout) => {
          if (!payout.requestedTaxIdentityEncrypted || payout.grossAmountCents == null || payout.withholdingTaxCents == null || payout.nhiSupplementaryTaxCents == null) {
            throw new Error("Payout export data is unavailable");
          }
          const taxIdentity = decryptTaxIdentity(payout.requestedTaxIdentityEncrypted, vendor.id);
          return [
            taxIdentity,
            payout.affiliate.name,
            payout.taxCategory,
            payout.grossAmountCents / 100,
            payout.withholdingTaxCents / 100,
            payout.nhiSupplementaryTaxCents / 100,
            payout.monthKey,
          ];
        }),
      );

    await writeAuditLog({
      vendorId: vendor.id,
      actorId: user.id,
      actorLabel: member.role,
      action: `download_affiliate_payout_${type}_csv`,
      targetType: "AffiliatePayoutExport",
      after: auditSnapshot({ exportType: type, payoutCount: payouts.length }),
    });
    return response;
  } catch {
    // Do not return a partial CSV or disclose whether a particular encrypted
    // bank/tax value was malformed, missing, or bound to another tenant.
    return unavailableExport();
  }
}
