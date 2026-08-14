import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function MessageTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const vendor = await requireVendorManager();
  const { notice } = await searchParams;
  const templates = await getDb().messageTemplate.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader
        title="訊息模板"
        description="管理報名成功與開播提醒 Email；購買追蹤、SMS、LINE 在事件來源或 provider 接通前保持停用。"
        action={(
          <div className="flex flex-wrap gap-2">
            <ButtonLink href="/messages/deliveries" tone="secondary">查看寄送紀錄</ButtonLink>
            <ButtonLink href="/messages/templates/new"><Plus size={16} />新增模板</ButtonLink>
          </div>
        )}
      />
      {notice === "reminders_reconciling" ? (
        <p role="status" aria-live="polite" className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-950">
          模板已儲存。使用這份模板的直播提醒正在分批更新，舊的未寄送版本會保留為已被取代。
        </p>
      ) : null}
      {templates.length === 0 ? (
        <EmptyState title="還沒有訊息模板" description="先建立報名成功與開播提醒 Email；其餘渠道會在事件來源或 provider 完成後才開放。" action={<ButtonLink href="/messages/templates/new">新增模板</ButtonLink>} />
      ) : (
        <Card>
          <div className="grid gap-3">
            {templates.map((template) => (
              <a key={template.id} href={`/messages/templates/${template.id}/edit`} className="flex flex-col gap-3 rounded-lg border border-border p-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="block font-semibold text-slate-950">{template.name}</span>
                  <span className="mt-1 block text-sm text-slate-500">{template.trigger}</span>
                </span>
                <span className="flex gap-2">
                  <Badge tone="blue">{template.channel}</Badge>
                  <Badge tone={template.isActive ? "green" : "gray"}>{template.isActive ? "啟用" : "停用"}</Badge>
                </span>
              </a>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
