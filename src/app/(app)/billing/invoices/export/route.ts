import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

function csvCell(value: string | number | null | undefined) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET() {
  const vendor = await requireVendor();
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

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="invoices.csv"',
    },
  });
}
