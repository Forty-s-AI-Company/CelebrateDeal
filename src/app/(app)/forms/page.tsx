import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function FormsPage() {
  const vendor = await requireVendorManager();
  const database = getDb();
  const forms = await database.registrationForm.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      _count: { select: { submissions: true } },
    },
  });
  const verifiedGroups = forms.length > 0
    ? await database.formSubmission.groupBy({
      by: ["formId"],
      where: {
        formId: { in: forms.map((form) => form.id) },
        form: { vendorId: vendor.id },
        verificationStatus: "VERIFIED",
      },
      _count: { _all: true },
    })
    : [];
  const verifiedByFormId = new Map(verifiedGroups.map((group) => [group.formId, group._count._all]));

  return (
    <>
      <PageHeader title="報名表管理" description="建立可嵌在直播頁或單獨分享的 lead 表單。" action={<ButtonLink href="/forms/new"><Plus size={16} />新增表單</ButtonLink>} />
      {forms.length === 0 ? (
        <EmptyState title="還沒有報名表" description="先建立一張表單，直播頁就能收集觀看者名單。" action={<ButtonLink href="/forms/new">新增表單</ButtonLink>} />
      ) : (
        <Card>
          <div className="grid gap-3">
            {forms.map((form) => {
              const verified = verifiedByFormId.get(form.id) ?? 0;
              const pending = form._count.submissions - verified;
              return (
              <div key={form.id} className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <h2 className="font-semibold text-slate-950">{form.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">/form/{form.slug}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={form.isActive ? "green" : "gray"}>{form.isActive ? "啟用" : "停用"}</Badge>
                  <ButtonLink href={`/forms/${form.id}/submissions`} tone="secondary">{verified} 已驗證{pending > 0 ? ` / ${pending} 待驗證` : ""}</ButtonLink>
                  <ButtonLink href={`/forms/${form.id}/edit`} tone="secondary">編輯</ButtonLink>
                </div>
              </div>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}
