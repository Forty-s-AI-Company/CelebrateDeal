import { requireVendorFinance } from "@/lib/auth";
import { getDb } from "@/lib/db";

function csvCell(value: string | number) {
  const raw = String(value);
  const safe = /^[=+\-@]/u.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function GET() {
  const { vendor } = await requireVendorFinance("/billing/electronic-invoices/export");
  const invoices = await getDb().electronicInvoice.findMany({
    where: { vendorId: vendor.id },
    include: { order: { select: { orderNumber: true } } },
    orderBy: { createdAt: "desc" },
  });
  const rows = [
    ["發票號碼", "訂單編號", "類型", "買受人／載具", "含稅金額", "未稅金額", "營業稅", "狀態", "開立時間"],
    ...invoices.map((invoice) => [invoice.invoiceNumber ?? "", invoice.order.orderNumber, invoice.invoiceType, invoice.buyerDisplay, invoice.amountCents / 100, invoice.pretaxAmountCents / 100, invoice.taxAmountCents / 100, invoice.status, invoice.issuedAt?.toISOString() ?? ""]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="electronic-invoices.csv"', "cache-control": "private, no-store" } });
}
