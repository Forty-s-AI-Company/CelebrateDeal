import { NextResponse } from "next/server";
import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";

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

  const updated = await getDb().payoutBatch.update({
    where: { id },
    data: { status: "exported", exportedAt: new Date() },
  });

  await writeAuditLog({
    actorId: member.id,
    actorLabel: member.role,
    action: "download_payout_csv",
    targetType: "PayoutBatch",
    targetId: batch.id,
    before: auditSnapshot(batch),
    after: auditSnapshot(updated),
  });

  const header = ["批次編號", "商家", "月結月份", "銀行代碼", "銀行帳號", "戶名", "出款金額", "狀態"];
  const rows = batch.items.map((item) => [
    batch.batchNumber,
    item.vendor.name,
    item.settlement?.monthKey ?? "",
    item.bankCode,
    item.bankAccountNumber,
    item.bankAccountName,
    item.payoutAmountCents / 100,
    item.status,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  return new NextResponse(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${batch.batchNumber}.csv"`,
    },
  });
}
