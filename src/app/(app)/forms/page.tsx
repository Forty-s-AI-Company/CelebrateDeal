import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendor } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function FormsPage() {
  const vendor = await requireVendor();
  const forms = await getDb().registrationForm.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    include: { submissions: true },
  });

  return (
    <>
      <PageHeader title="報名表管理" description="建立可嵌在直播頁或單獨分享的 lead 表單。" action={<ButtonLink href="/forms/new"><Plus size={16} />新增表單</ButtonLink>} />
      {forms.length === 0 ? (
        <EmptyState title="還沒有報名表" description="先建立一張表單，直播頁就能收集觀看者名單。" action={<ButtonLink href="/forms/new">新增表單</ButtonLink>} />
      ) : (
        <Card>
          <div className="grid gap-3">
            {forms.map((form) => (
              <div key={form.id} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <h2 className="font-semibold text-slate-950">{form.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">/form/{form.slug}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={form.isActive ? "green" : "gray"}>{form.isActive ? "啟用" : "停用"}</Badge>
                  <ButtonLink href={`/forms/${form.id}/submissions`} tone="secondary">{form.submissions.length} 名單</ButtonLink>
                  <ButtonLink href={`/forms/${form.id}/edit`} tone="secondary">編輯</ButtonLink>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
