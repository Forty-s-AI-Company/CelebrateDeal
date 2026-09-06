import { LineOfficialAccountForm } from "@/components/line-official-account-form";
import { PageHeader } from "@/components/ui";
import { requireVendorOwner } from "@/lib/auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

function maskIdentityId(identityId: string) {
  if (identityId.length <= 8) return `***${identityId.slice(-4)}`;
  return `${identityId.slice(0, 4)}…${identityId.slice(-4)}`;
}

const triggerLabels: Record<string, string> = {
  live_reminder: "開播提醒",
  live_started: "直播開始",
  order_paid: "訂單付款",
};

export default async function LineSettingsPage() {
  const auth = await requireVendorOwner();
  const [csrfToken, account] = await Promise.all([
    getCsrfToken(),
    getDb().lineOfficialAccount.findUnique({
      where: { vendorId: auth.vendor.id },
      select: { id: true, status: true, connectedAt: true, lastValidatedAt: true },
    }),
  ]);
  const deliveries = account
    ? await getDb().lineDelivery.findMany({
        where: { vendorId: auth.vendor.id, lineOfficialAccountId: account.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          trigger: true,
          status: true,
          attemptCount: true,
          createdAt: true,
          sentAt: true,
          identity: { select: { id: true } },
        },
      })
    : [];
  const webhookUrl = `${getCanonicalAppUrl()}/api/webhooks/line/${encodeURIComponent(auth.vendor.id)}`;
  return (
    <div className="space-y-6">
      <PageHeader title="LINE 整合" description="管理官方帳號推播與 LINE Login。憑證只會加密儲存，不會在頁面重新顯示。" />
      <LineOfficialAccountForm
        csrfToken={csrfToken}
        connected={account?.status === "active"}
        webhookUrl={webhookUrl}
        lastValidatedAt={account?.lastValidatedAt?.toLocaleString("zh-TW") ?? null}
      />
      <section className="rounded-lg border border-border bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">推播紀錄</h2>
          <p className="mt-1 text-sm text-muted-foreground">僅顯示此商家的最近 20 筆推播；收件者已遮罩，絕不解密或顯示 LINE userId。</p>
        </div>
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">目前尚無推播紀錄。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-border text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-medium">時間</th>
                  <th className="px-2 py-2 font-medium">觸發類型</th>
                  <th className="px-2 py-2 font-medium">接收對象</th>
                  <th className="px-2 py-2 font-medium">狀態</th>
                  <th className="px-2 py-2 font-medium">重試次數</th>
                  <th className="px-2 py-2 font-medium">送出時間</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((delivery) => (
                  <tr key={delivery.id} className="border-b border-border last:border-0">
                    <td className="whitespace-nowrap px-2 py-3">{delivery.createdAt.toLocaleString("zh-TW")}</td>
                    <td className="px-2 py-3">{triggerLabels[delivery.trigger] ?? delivery.trigger}</td>
                    <td className="px-2 py-3 font-mono text-xs">{maskIdentityId(delivery.identity.id)}</td>
                    <td className="px-2 py-3">{delivery.status}</td>
                    <td className="px-2 py-3">{delivery.attemptCount}</td>
                    <td className="whitespace-nowrap px-2 py-3">{delivery.sentAt?.toLocaleString("zh-TW") ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
