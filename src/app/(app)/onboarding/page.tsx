import { completeOnboardingAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, PageHeader, SubmitButton } from "@/components/ui";
import { requireAuth } from "@/lib/auth";

const errorMessages: Record<string, string> = {
  invalid: "請確認名稱、Slug、Email 與時區格式。",
  unavailable: "這組 Slug 或 Email 無法使用，請更換後再試。",
};

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const [params, auth] = await Promise.all([searchParams, requireAuth()]);
  const vendor = auth.vendor;
  const canComplete = auth.member?.role === "owner";

  return (
    <>
      <PageHeader title="完成工作區設定" description="確認商家基本資料後即可開始建立直播與商品。" />
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[params.error] ?? "操作失敗，請稍後再試。"}</p> : null}
      <Card className="max-w-3xl">
        {vendor && canComplete ? (
          <form action={completeOnboardingAction} className="grid gap-4">
            <CsrfField />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="工作區名稱" name="name" defaultValue={vendor.name} required />
              <Field label="公開 Slug" name="slug" defaultValue={vendor.slug} required />
              <Field label="商家 Email" name="email" type="email" defaultValue={vendor.email} required />
              <Field label="客服 Email" name="supportEmail" type="email" defaultValue={vendor.supportEmail} />
              <Field label="時區" name="timezone" defaultValue={vendor.timezone} required />
            </div>
            <div>
              <SubmitButton>完成設定</SubmitButton>
            </div>
          </form>
        ) : (
          <p className="rounded-md border border-border bg-slate-50 p-4 text-sm text-slate-600">只有工作區 owner 可以完成基本設定。</p>
        )}
      </Card>
    </>
  );
}
