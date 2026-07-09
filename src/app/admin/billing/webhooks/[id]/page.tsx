import Link from "next/link";
import { notFound } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { retryWebhookEventAction } from "@/app/actions";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { reconcileWebhookEvent } from "@/lib/reconciliation";

function statusTone(status: string) {
  if (status === "processed") return "green" as const;
  if (status === "failed") return "orange" as const;
  if (status === "received") return "blue" as const;
  return "gray" as const;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[520px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-6 text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export default async function AdminBillingWebhookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireFinanceAdmin();
  const { id } = await params;
  const event = await getDb().webhookEvent.findUnique({
    where: { id },
    include: { vendor: true },
  });
  if (!event) notFound();

  const audits = await getDb().auditLog.findMany({
    where: { targetType: "WebhookEvent", targetId: event.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const reconciliation = await reconcileWebhookEvent(event);

  const payload = event.payload as { raw?: unknown; normalized?: unknown };

  return (
    <>
      <PageHeader
        title="Webhook 詳情"
        description={`${event.provider} · ${event.eventId}`}
        action={<Link href="/admin/billing/webhooks" className="text-sm font-semibold text-primary hover:underline">返回列表</Link>}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <p className="text-sm text-slate-500">狀態</p>
          <p className="mt-2"><Badge tone={statusTone(event.status)}>{event.status}</Badge></p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">商家</p>
          <p className="mt-2 font-semibold text-slate-950">{event.vendor?.name ?? "-"}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Retry</p>
          <p className="mt-2 font-semibold text-slate-950">{event.retryCount} / {event.maxRetries}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">處理時間</p>
          <p className="mt-2 text-sm font-semibold text-slate-950">{event.processedAt ? formatDateTime(event.processedAt) : "尚未完成"}</p>
        </Card>
      </div>

      {event.status === "failed" ? (
        <Card className="mb-6 border-orange-200 bg-orange-50">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="font-semibold text-orange-900">處理失敗</h2>
              <p className="mt-1 text-sm text-orange-700">{event.errorMessage ?? "未記錄錯誤訊息"}</p>
            </div>
            <form action={retryWebhookEventAction}>
              <input type="hidden" name="id" value={event.id} />
              <button className="inline-flex h-10 items-center gap-2 rounded-md bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700">
                <RotateCcw size={16} />
                手動重送
              </button>
            </form>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">Raw Payload</h2>
          <JsonBlock value={payload.raw ?? event.payload} />
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">Normalized Payload</h2>
          <JsonBlock value={payload.normalized ?? event.payload} />
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-950">Reconciliation Checks</h2>
        <div className="grid gap-3">
          {reconciliation.map((check) => (
            <div key={check.key} className="grid gap-3 rounded-lg border border-border p-4 md:grid-cols-[1fr_auto] md:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-950">{check.label}</p>
                  <Badge tone={check.status === "pass" ? "green" : check.status === "warning" ? "orange" : "gray"}>{check.status}</Badge>
                </div>
                {check.detail ? <p className="mt-2 text-sm text-slate-500">{check.detail}</p> : null}
              </div>
              <div className="text-sm text-slate-500 md:text-right">
                <p>Expected: <span className="font-mono text-slate-800">{check.expected}</span></p>
                <p>Actual: <span className="font-mono text-slate-800">{check.actual}</span></p>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-950">相關 Audit Logs</h2>
        <div className="grid gap-3">
          {audits.map((audit) => (
            <div key={audit.id} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="font-semibold text-slate-950">{audit.action}</p>
                <p className="mt-1 text-sm text-slate-500">{audit.actorLabel ?? "system"} · {audit.ipAddress ?? "no-ip"}</p>
              </div>
              <p className="text-sm text-slate-500">{formatDateTime(audit.createdAt)}</p>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
