import { NextResponse } from "next/server";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { resolveStoredBankAccount } from "@/lib/bank-account";

function csvCell(value: string | number | null | undefined) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { member } = await requireFinanceAdmin();
  const { id } = await params;
  const batch = await getDb().payoutBatch.findUnique({
    where: { id },
    include: { items: { include: { vendor: true, settlement: true }, orderBy: { createdAt: "asc" } } },
  });

  if (!batch) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const header = ["批次編號", "商家", "月結月份", "銀行代碼", "銀行帳號", "戶名", "出款金額", "狀態", "出款 reference"];
  const rows = batch.items.map((item) => {
    const bankAccount = resolveStoredBankAccount({
      vendorId: item.vendorId,
      bankAccountEncrypted: item.bankAccountEncrypted,
      legacyAccountName: item.bankAccountDisplayName,
      legacyBankCode: item.bankCodeDisplay,
      legacyAccountNumber: item.bankAccountDisplayNumber,
    });
    return [
      batch.batchNumber,
      item.vendor.name,
      item.settlement?.monthKey ?? "",
      bankAccount.bankCode,
      bankAccount.accountNumber,
      bankAccount.accountName,
      item.payoutAmountCents / 100,
      item.status,
      item.outcomeReference,
    ];
  });
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const safeFilename = batch.batchNumber.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "payout";

  await writeAuditLog({
    actorId: member.id,
    actorLabel: member.role,
    action: "download_payout_csv",
    targetType: "PayoutBatch",
    targetId: batch.id,
    after: auditSnapshot({ batchNumber: batch.batchNumber, itemCount: batch.items.length }),
  });

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename}.csv"`,
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
