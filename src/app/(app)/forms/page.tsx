import { Plus } from "lucide-react";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

type FormsSearchParams = {
  q?: string | string[];
  status?: string | string[];
};

type FormListStatus = "all" | "active" | "inactive";

function singleSearchParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function normalizeQuery(value: string | string[] | undefined) {
  return (singleSearchParam(value)?.trim() ?? "").slice(0, 120);
}

function normalizeStatus(value: string | string[] | undefined): FormListStatus {
  const candidate = singleSearchParam(value);
  return candidate === "active" || candidate === "inactive" ? candidate : "all";
}

export default async function FormsPage({
  searchParams,
}: {
  searchParams: Promise<FormsSearchParams>;
}) {
  const vendor = await requireVendorManager();
  const database = getDb();
  const query = await searchParams;
  const search = normalizeQuery(query.q);
  const status = normalizeStatus(query.status);
  const forms = await database.registrationForm.findMany({
    where: {
      vendorId: vendor.id,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(status === "active"
        ? { isActive: true }
        : status === "inactive"
          ? { isActive: false }
          : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
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
  const hasFilters = Boolean(search || status !== "all");

  return (
    <>
      <PageHeader title="報名表管理" description="建立可嵌在直播頁或單獨分享的 lead 表單。" action={<ButtonLink href="/forms/new"><Plus size={16} />新增表單</ButtonLink>} />
      <Card className="mb-5">
        <form method="get" className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto_auto] md:items-end">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            搜尋表單
            <input
              name="q"
              defaultValue={search}
              maxLength={120}
              placeholder="搜尋表單名稱或網址"
              className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            表單狀態
            <select
              name="status"
              defaultValue={status}
              className="h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">全部狀態</option>
              <option value="active">啟用</option>
              <option value="inactive">停用</option>
            </select>
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white transition hover:bg-primary-dark">搜尋</button>
          {hasFilters ? <a href="/forms" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">清除篩選</a> : null}
        </form>
      </Card>
      {forms.length === 0 ? (
        <EmptyState
          title={hasFilters ? "找不到符合條件的報名表" : "還沒有報名表"}
          description={hasFilters ? "請調整搜尋文字或狀態條件後再試。" : "先建立一張表單，直播頁就能收集觀看者名單。"}
          action={hasFilters ? <a href="/forms" className="inline-flex min-h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-semibold text-slate-700">清除篩選</a> : <ButtonLink href="/forms/new">新增表單</ButtonLink>}
        />
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
                  {form.isActive ? (
                    <a href={`/form/${encodeURIComponent(form.slug)}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">預覽報名頁</a>
                  ) : (
                    <span className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-slate-50 px-3 text-sm font-semibold text-slate-400">公開預覽不可用</span>
                  )}
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
