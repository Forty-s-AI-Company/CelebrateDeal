import { LineOfficialAccountForm } from "@/components/line-official-account-form";
import { LineRichMenuStudio } from "@/components/line-rich-menu-studio";
import { PageHeader } from "@/components/ui";
import { requireVendorOwner } from "@/lib/auth";
import { getCanonicalAppUrl } from "@/lib/app-url";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";
import { parseRichMenuDraftContent,richMenuPublicationView } from "@/lib/line-rich-menu-draft-content";
import Link from "next/link";
import { notFound } from "next/navigation";

function maskIdentityId(identityId: string) {
  if (identityId.length <= 8) return `***${identityId.slice(-4)}`;
  return `${identityId.slice(0, 4)}…${identityId.slice(-4)}`;
}

const triggerLabels: Record<string, string> = {
  live_reminder: "開播提醒",
  live_started: "直播開始",
  order_paid: "訂單付款",
};

async function loadLineSettings(vendorId:string,requestedAccountId:string|undefined) {
  const accounts = await getDb().lineOfficialAccount.findMany({
      where: { vendorId: vendorId },
      orderBy: [{isDefault:"desc"},{createdAt:"asc"}],
      select: { id: true, displayName:true, isDefault:true, status: true, connectedAt: true, lastValidatedAt: true },
    });
  const account = requestedAccountId === "new" ? null : requestedAccountId ? accounts.find(item=>item.id===requestedAccountId) ?? null : accounts[0] ?? null;
  if(requestedAccountId && requestedAccountId !== "new" && !account) notFound();
  const draft = account ? await getDb().lineRichMenuDraft.findFirst({where:{vendorId:vendorId,lineOfficialAccountId:account.id},select:{id:true,revision:true,menu:true}}) : null;
  return {accounts,account,draft};
}

export default async function LineSettingsPage({searchParams}: {searchParams?:Promise<{accountId?:string}>}) {
  const auth = await requireVendorOwner();
  const query = await searchParams;
  const [csrfToken,{accounts,account,draft}] = await Promise.all([getCsrfToken(),loadLineSettings(auth.vendor.id,query?.accountId)]);
  const parsedMenu = draft ? parseRichMenuDraftContent(draft.menu) : null;
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
  const webhookUrl = account ? `${getCanonicalAppUrl()}/api/webhooks/line/${encodeURIComponent(auth.vendor.id)}/${encodeURIComponent(account.id)}` : "";
  return (
    <div className="space-y-6">
      <PageHeader title="LINE 整合" description="管理官方帳號推播與 LINE Login。憑證只會加密儲存，不會在頁面重新顯示。" />
      <section className="space-y-3 rounded-lg border p-5">
        <h2 className="font-semibold">官方帳號清單</h2>
        <p className="text-sm text-slate-600">帳號只需新增一次，各課程 Project 可選擇同一個帳號。學員的 LINE Login 用於綁定通知身份；官方帳號串接仍需在 LINE 後台設定通道。Messaging API 與 LINE Login 通道請建立在同一個 Provider，並將 Login 通道連結此官方帳號。</p>
        <a href="https://manager.line.biz/" target="_blank" rel="noreferrer" className="inline-block underline">登入 LINE 官方帳號後台</a>
        <form method="get" className="flex flex-wrap gap-2"><label>管理帳號 <select name="accountId" defaultValue={account?.id ?? "new"} className="min-h-11 rounded border px-3">{accounts.map(item=><option key={item.id} value={item.id}>{item.displayName}{item.isDefault?"（預設）":""}</option>)}<option value="new">新增官方帳號</option></select></label><button className="rounded border px-4" type="submit">開啟</button></form>
        <Link href="/settings/line?accountId=new" className="inline-block underline">新增官方帳號</Link>
      </section>
      <LineOfficialAccountForm
        key={account?.id ?? "new"}
        accountId={account?.id}
        displayName={account?.displayName}
        csrfToken={csrfToken}
        connected={account?.status === "active"}
        webhookUrl={webhookUrl}
        lastValidatedAt={account?.lastValidatedAt?.toLocaleString("zh-TW") ?? null}
      />
      {draft && !parsedMenu ? <p role="alert">選單草稿格式無法載入，請聯絡管理員協助處理；原始草稿已保留。</p> : account ? <LineRichMenuStudio
        accountId={account.id}
        key={`${account.id}:${draft?.id??"new"}:${draft?.revision??0}`}
        csrfToken={csrfToken}
        connected={account?.status==="active"}
        existing={draft && parsedMenu ? { id: draft.id, revision: draft.revision, menu: parsedMenu.menu,publication:richMenuPublicationView(parsedMenu.publication) } : null}
      /> : null}
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
