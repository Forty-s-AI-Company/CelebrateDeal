import { auditSnapshot, writeAuditLog } from "@/lib/audit";
import { requireVendorContext } from "@/lib/auth";
import { getDb } from "@/lib/db";

function csvCell(value: string | number | null | undefined) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET() {
  const { auth, vendor } = await requireVendorContext();
  const invoices = await getDb().invoice.findMany({
    where: { vendorId: vendor.id },
    orderBy: [{ monthKey: "desc" }, { createdAt: "desc" }],
  });

  const header = [
    "帳單編號",
    "月份",
    "月費",
    "超額用量費",
    "金流服務費",
    "交易服務費",
    "聯盟結算管理費",
    "小計",
    "稅額",
    "總額",
    "狀態",
  ];
  const rows = invoices.map((invoice) => [
    invoice.invoiceNumber,
    invoice.monthKey,
    invoice.monthlyFeeCents / 100,
    invoice.overflowFeeCents / 100,
    invoice.paymentServiceFeeCents / 100,
    invoice.transactionServiceFeeCents / 100,
    invoice.affiliateManagementFeeCents / 100,
    invoice.subtotalCents / 100,
    invoice.taxCents / 100,
    invoice.totalCents / 100,
    invoice.status,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  await writeAuditLog({
    vendorId: vendor.id,
    actorId: auth.user.id,
    actorLabel: auth.member?.role ?? auth.user.platformRole,
    action: "download_vendor_invoice_csv",
    targetType: "InvoiceExport",
    after: auditSnapshot({ invoiceCount: invoices.length }),
  });

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="invoices.csv"',
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
