import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { canManageMessageDelivery } from "@/lib/vendor-capabilities";

export default async function MessageTemplatesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const auth = await requireAuth();
  const vendor = auth.vendor;
  if (!vendor) return null;
  const canManage = canManageMessageDelivery(auth.member?.role);
  const templates = await getDb().messageTemplate.findMany({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" } });

  return (
    <>
      <PageHeader title="訊息模板" description="管理報名成功、開播提醒與後續導購訊息。" action={canManage ? <ButtonLink href="/messages/templates/new"><Plus size={16} />新增模板</ButtonLink> : undefined} />
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">只有 owner 或 admin 可以修改寄件模板。</p> : null}
      {templates.length === 0 ? (
        <EmptyState title="還沒有訊息模板" description="先建立報名成功通知，後續再接 Email/SMS provider。" action={<ButtonLink href="/messages/templates/new">新增模板</ButtonLink>} />
      ) : (
        <Card>
          <div className="grid gap-3">
            {templates.map((template) => (
              <a key={template.id} href={canManage ? `/messages/templates/${template.id}/edit` : "/messages/templates"} aria-disabled={!canManage} className="flex flex-col gap-3 rounded-lg border border-border p-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">
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
