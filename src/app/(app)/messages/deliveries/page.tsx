import { RotateCcw } from "lucide-react";
import { retryNotificationAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { writeAuditLog } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { canManageMessageDelivery } from "@/lib/vendor-capabilities";
import { redirect } from "next/navigation";

function statusTone(status: string) {
  if (status === "sent") return "green" as const;
  if (["failed", "exhausted"].includes(status)) return "orange" as const;
  if (status === "pending") return "blue" as const;
  return "gray" as const;
}

export default async function NotificationDeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const params = await searchParams;
  const auth = await requireAuth();
  const vendorId = auth.vendor?.id;
  if (!vendorId) return null;
  if (!canManageMessageDelivery(auth.member?.role)) redirect("/dashboard?error=notification_access_denied");
  const messages = await getDb().notificationOutbox.findMany({
    where: { vendorId },
    include: { template: true, attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  await writeAuditLog({
    vendorId,
    actorId: auth.user.id,
    actorLabel: auth.member?.role,
    action: "notification_delivery_pii_viewed",
    targetType: "NotificationOutbox",
    after: { visibleRecordCount: messages.length },
  });
  const canRetry = auth.member?.role === "owner";

  return (
    <>
      <PageHeader title="通知投遞紀錄" description="查看報名通知的排程、Resend／fixture 投遞結果與重試狀態。" />
      {params.updated ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">通知已重新排入佇列。</p> : null}
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">通知無法重試，可能已送達或不屬於目前工作區。</p> : null}
      {messages.length === 0 ? (
        <EmptyState title="尚無通知紀錄" description="報名成功且有啟用中的 email 模板時，系統會在同一筆交易中建立通知。" />
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-5 py-3">收件者</th><th className="px-5 py-3">主旨</th><th className="px-5 py-3">來源</th><th className="px-5 py-3">狀態</th><th className="px-5 py-3">嘗試</th><th className="px-5 py-3">時間</th><th className="px-5 py-3 text-right">操作</th></tr></thead>
              <tbody className="divide-y divide-border">
                {messages.map((message) => (
                  <tr key={message.id}>
                    <td className="px-5 py-4"><p className="font-medium text-slate-900">{message.recipient}</p><p className="text-xs text-slate-500">{message.channel}</p></td>
                    <td className="max-w-[280px] px-5 py-4"><p className="truncate font-medium text-slate-800" title={message.subject}>{message.subject}</p><p className="text-xs text-slate-500">{message.template?.name ?? "已刪除模板快照"}</p></td>
                    <td className="px-5 py-4 text-slate-600">{message.sourceType}</td>
                    <td className="px-5 py-4"><Badge tone={statusTone(message.status)}>{message.status}</Badge>{message.lastError ? <p className="mt-1 max-w-[240px] truncate text-xs text-red-600" title={message.lastError}>{message.lastError}</p> : null}</td>
                    <td className="px-5 py-4 text-slate-600">{message.attemptCount} / {message.maxAttempts}<p className="text-xs text-slate-500">{message.attempts[0]?.provider ?? "-"}</p></td>
                    <td className="px-5 py-4 text-slate-500">{formatDateTime(message.sentAt ?? message.nextAttemptAt)}</td>
                    <td className="px-5 py-4 text-right">
                      {canRetry && ["failed", "exhausted"].includes(message.status) ? (
                        <form action={retryNotificationAction}>
                          <CsrfField />
                          <input type="hidden" name="outboxId" value={message.id} />
                          <button className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"><RotateCcw size={14} />重試</button>
                        </form>
                      ) : <span className="text-xs text-slate-400">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
