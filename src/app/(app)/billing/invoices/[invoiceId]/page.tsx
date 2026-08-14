import Link from "next/link";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { notFound } from "next/navigation";
import { Badge, Card, PageHeader } from "@/components/ui";
import { FormSubmitButton } from "@/components/form-submit-button";
import { ExternalPaymentForm } from "@/components/external-payment-form";
import { payInvoiceAction } from "@/app/actions/invoice-actions";
import { requireVendorFinance } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { invoiceStatusLabel, invoiceStatusTone } from "@/lib/invoice-presentation";
import { allowedPaymentUrl, checkoutSessionFromMetadata, metadataObject } from "@/lib/payment-checkout-presentation";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";
import { PrintInvoiceButton } from "./print-invoice-button";

type InvoiceDetailPageProps = {
  params: Promise<{ invoiceId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function queryText(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

type InvoicePaymentView = {
  id: string;
  status: string;
  totalCents: number;
};

type CheckoutView = ReturnType<typeof checkoutSessionFromMetadata> | null;

async function findPendingInvoiceCheckout(
  db: ReturnType<typeof getDb>,
  vendorId: string,
  invoiceId: string,
  transactionId: string,
): Promise<CheckoutView> {
  if (!transactionId || transactionId.length > 64) return null;

  const transaction = await db.paymentTransaction.findFirst({
    where: {
      id: transactionId,
      vendorId,
      paymentMode: "platform",
      status: "pending",
    },
    select: { id: true, metadata: true },
  });
  if (!transaction) return null;

  const metadata = metadataObject(transaction.metadata);
  if (metadata.billingPurpose !== "invoice_payment" || metadata.invoiceId !== invoiceId) return null;
  return checkoutSessionFromMetadata(metadata);
}

const paymentMessages: Record<string, string> = {
  checkout: "付款交易已建立，請依下方付款方式完成付款；系統只會在收到可信 webhook 後標記已付款。",
  paid: "已收到付款通知，這筆帳單已更新為已付款。",
  not_payable: "這筆帳單目前不是可付款狀態。",
  conflict: "付款交易狀態與帳單不一致，系統已停止建立新交易，請交由客服處理。",
};

const paymentErrors: Record<string, string> = {
  checkout: "目前無法建立付款頁，這筆付款交易已停止，請稍後再試。",
  not_payable: "這筆帳單目前不是可付款狀態。",
  conflict: "付款交易狀態與帳單不一致，系統已停止建立新交易，請交由客服處理。",
  checkout_in_progress: "付款交易正在建立中，系統已避免重複建立交易；請稍候重新整理帳單頁。",
};

export default async function InvoiceDetailPage({ params, searchParams }: InvoiceDetailPageProps) {
  const { vendor } = await requireVendorFinance("/billing/invoices");
  const { invoiceId } = await params;
  if (!invoiceId || invoiceId.length > 64) notFound();

  const db = getDb();
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, vendorId: vendor.id },
  });
  if (!invoice) notFound();

  const query = await searchParams;
  const transactionId = queryText(query?.transactionId);
  const isPayable = ["issued", "overdue"].includes(invoice.status) && invoice.totalCents > 0;
  const checkout = isPayable
    ? await findPendingInvoiceCheckout(db, vendor.id, invoice.id, transactionId)
    : null;
  const csrfToken = isPayable ? await getCsrfToken() : null;
  const requestedStatus = queryText(query?.status);
  const statusMessage = requestedStatus === "paid"
    ? (invoice.status === "paid" ? paymentMessages.paid : null)
    : requestedStatus === "checkout"
      ? (checkout ? paymentMessages.checkout : null)
      : paymentMessages[requestedStatus] ?? null;
  const paymentErrorCode = queryText(query?.error);
  const errorMessage = paymentErrors[paymentErrorCode] ?? null;

  const isReceipt = invoice.status === "paid";
  const title = isReceipt ? "付款收據" : "帳單明細";
  const lineItems = [
    ["平台月費", invoice.monthlyFeeCents],
    ["超額用量費", invoice.overflowFeeCents],
    ["金流服務費", invoice.paymentServiceFeeCents],
    ["交易服務費", invoice.transactionServiceFeeCents],
    ["聯盟結算管理費", invoice.affiliateManagementFeeCents],
  ] as const;

  return (
    <div className="print:bg-white print:text-black">
      <div className="print:hidden">
        <PageHeader
          title={title}
          description="查看單筆帳單費用、付款狀態與可列印收據。"
          action={(
            <div className="flex flex-wrap gap-2">
              <Link
                href="/billing/invoices"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ArrowLeft size={16} aria-hidden="true" />
                返回帳單
              </Link>
              <PrintInvoiceButton />
            </div>
          )}
        />
      </div>

      <Card className="mx-auto max-w-4xl print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <ReceiptText size={22} aria-hidden="true" />
              <p className="text-sm font-semibold tracking-wide">CELEBRATEDEAL</p>
            </div>
            <h1 className="mt-3 text-2xl font-bold text-slate-950">{title}</h1>
            <p className="mt-1 font-mono text-sm text-slate-500">{invoice.invoiceNumber}</p>
          </div>
          <Badge tone={invoiceStatusTone(invoice.status)}>{invoiceStatusLabel(invoice.status)}</Badge>
        </header>

        <section className="grid gap-4 border-b border-border py-5 text-sm sm:grid-cols-2">
          <Detail label="帳單對象" value={vendor.name} />
          <Detail label="計費月份" value={invoice.monthKey} mono />
          <Detail label="建立時間" value={formatDateTime(invoice.createdAt)} />
          <Detail label="到期時間" value={invoice.dueAt ? formatDateTime(invoice.dueAt) : "未設定"} />
          <Detail label="付款時間" value={invoice.paidAt ? formatDateTime(invoice.paidAt) : "尚未付款"} />
          <Detail label="文件類型" value={isReceipt ? "付款收據" : "帳單明細"} />
        </section>

        <section className="py-5">
          <h2 className="mb-3 text-base font-semibold text-slate-950">費用項目</h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">項目</th>
                  <th className="px-4 py-3 text-right font-medium">金額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lineItems.map(([label, amount]) => (
                  <tr key={label}>
                    <td className="px-4 py-3 text-slate-700">{label}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-950">{formatCurrency(amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ml-auto grid max-w-sm gap-2 border-t border-border pt-5 text-sm">
          <TotalRow label="小計" value={formatCurrency(invoice.subtotalCents)} />
          <TotalRow label="稅額" value={formatCurrency(invoice.taxCents)} />
          <TotalRow label="總額" value={formatCurrency(invoice.totalCents)} total />
        </section>

        <InvoicePaymentSection
          invoice={invoice}
          checkout={checkout}
          csrfToken={csrfToken}
          statusMessage={statusMessage}
          errorMessage={errorMessage}
          suppressCheckoutStart={paymentErrorCode === "checkout_in_progress"}
        />

        <footer className="mt-6 border-t border-border pt-4 text-xs leading-5 text-slate-500">
          本頁是 CelebrateDeal 平台帳單與付款紀錄，不是財政部電子發票。若未來啟用電子發票服務，將另行提供法定憑證資訊。
        </footer>
      </Card>
    </div>
  );
}

function InvoicePaymentSection({
  invoice,
  checkout,
  csrfToken,
  statusMessage,
  errorMessage,
  suppressCheckoutStart,
}: {
  invoice: InvoicePaymentView;
  checkout: CheckoutView;
  csrfToken: string | null;
  statusMessage: string | null;
  errorMessage: string | null;
  suppressCheckoutStart: boolean;
}) {
  const isPayable = ["issued", "overdue"].includes(invoice.status) && invoice.totalCents > 0;
  const formAction = checkout?.mode === "form_post" ? allowedPaymentUrl(checkout.formAction) : null;
  const checkoutUrl = checkout?.mode === "redirect" ? allowedPaymentUrl(checkout.checkoutUrl) : null;
  const canSubmitProviderForm = Boolean(formAction && checkout?.formPayload && Object.keys(checkout.formPayload).length > 0);
  if (!statusMessage && !errorMessage && !isPayable && !checkout) return null;

  return (
    <section className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-slate-700">
      {statusMessage && <p className="font-medium text-blue-900">{statusMessage}</p>}
      {errorMessage && <p className="font-medium text-red-700">{errorMessage}</p>}

      {isPayable && !checkout && csrfToken && !suppressCheckoutStart && (
        <form action={payInvoiceAction} className="mt-4">
          <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
          <input type="hidden" name="invoiceId" value={invoice.id} />
          <FormSubmitButton
            pendingChildren="建立中…"
            pendingMessage="正在建立付款交易，請勿重複送出。"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90"
          >
            建立付款交易
          </FormSubmitButton>
        </form>
      )}

      {checkout?.mode === "form_post" && canSubmitProviderForm && formAction && (
        <ExternalPaymentForm
          action={formAction}
          payload={checkout.formPayload}
          target="_blank"
          buttonClassName="bg-primary hover:bg-primary/90"
        />
      )}

      {checkout?.mode === "redirect" && checkoutUrl && (
        <a
          href={checkoutUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90"
        >
          前往安全付款頁
        </a>
      )}

      {checkout?.mode === "manual" && (
        <p className="mt-3 text-slate-600">
          目前付款 adapter 尚未提供外部付款頁；交易保持待處理，不會誤標記已付款。
        </p>
      )}
    </section>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 font-semibold text-slate-950 ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function TotalRow({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-8 ${total ? "mt-1 border-t border-border pt-3 text-lg font-bold text-slate-950" : "text-slate-600"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
