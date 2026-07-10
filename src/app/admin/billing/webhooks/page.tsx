import Link from "next/link";
import { RotateCcw, Webhook } from "lucide-react";
import { retryWebhookEventAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireFinanceAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

function statusTone(status: string) {
  if (status === "processed") return "green" as const;
  if (status === "failed") return "orange" as const;
  if (status === "received") return "blue" as const;
  return "gray" as const;
}

export default async function AdminBillingWebhooksPage() {
  await requireFinanceAdmin();
  const [events, failedCount, queuedCount] = await Promise.all([
    getDb().webhookEvent.findMany({ include: { vendor: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    getDb().webhookEvent.count({ where: { status: "failed" } }),
    getDb().webhookEvent.count({ where: { nextRetryAt: { not: null } } }),
  ]);

  return (
    <>
      <PageHeader
        title="Webhook 對帳中心"
        description="檢視金流 webhook raw payload、normalized payload、處理狀態與重送佇列。"
        action={<Link href="/admin/billing/dashboard" className="text-sm font-semibold text-primary hover:underline">回財務總覽</Link>}
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">最近事件</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{events.length}</p>
        </Card>
        <Card className="bg-gradient-to-br from-white to-orange-50">
          <p className="text-sm text-slate-500">Failed</p>
          <p className="mt-2 text-3xl font-bold text-orange-700">{failedCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Retry Queue</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{queuedCount}</p>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border px-5 py-4">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950"><Webhook size={18} />事件列表</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">事件</th>
                <th className="px-5 py-3">商家</th>
                <th className="px-5 py-3">狀態</th>
                <th className="px-5 py-3">Retry</th>
                <th className="px-5 py-3">錯誤</th>
                <th className="px-5 py-3">時間</th>
                <th className="px-5 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.map((event) => (
                <tr key={event.id} className="hover:bg-slate-50/70">
                  <td className="px-5 py-4">
                    <Link href={`/admin/billing/webhooks/${event.id}`} className="font-semibold text-primary hover:underline">{event.provider}</Link>
                    <p className="mt-1 font-mono text-xs text-slate-500">{event.eventId}</p>
                    <p className="mt-1 text-xs text-slate-500">{event.eventType}</p>
                  </td>
                  <td className="px-5 py-4">{event.vendor?.name ?? "-"}</td>
                  <td className="px-5 py-4"><Badge tone={statusTone(event.status)}>{event.status}</Badge></td>
                  <td className="px-5 py-4 text-slate-500">
                    {event.retryCount} / {event.maxRetries}
                    {event.nextRetryAt ? <p className="mt-1 text-xs">next {formatDateTime(event.nextRetryAt)}</p> : null}
                  </td>
                  <td className="max-w-[260px] truncate px-5 py-4 text-slate-500">{event.errorMessage ?? "-"}</td>
                  <td className="px-5 py-4 text-slate-500">{formatDateTime(event.createdAt)}</td>
                  <td className="px-5 py-4">
                    {event.status === "failed" ? (
                      <form action={retryWebhookEventAction}>
                        <CsrfField />
                        <input type="hidden" name="id" value={event.id} />
                        <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          <RotateCcw size={13} />
                          Retry
                        </button>
                      </form>
                    ) : (
                      <Link href={`/admin/billing/webhooks/${event.id}`} className="text-xs font-semibold text-primary hover:underline">查看</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
