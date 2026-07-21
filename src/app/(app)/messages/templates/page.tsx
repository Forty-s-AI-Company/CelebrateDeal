import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function MessageTemplatesPage() {
  const vendor = await requireVendorManager();
  const templates = await getDb().messageTemplate.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader title="訊息模板" description="管理報名成功、開播提醒與後續導購訊息。" action={<ButtonLink href="/messages/templates/new"><Plus size={16} />新增模板</ButtonLink>} />
      {templates.length === 0 ? (
        <EmptyState title="還沒有訊息模板" description="先建立報名成功通知，後續再接 Email/SMS provider。" action={<ButtonLink href="/messages/templates/new">新增模板</ButtonLink>} />
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
