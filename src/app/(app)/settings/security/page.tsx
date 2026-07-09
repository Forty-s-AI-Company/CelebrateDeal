import { logoutAction, updatePasswordAction } from "@/app/actions";
import { Card, DangerButton, Field, PageHeader, SubmitButton } from "@/components/ui";

export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ updated?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <>
      <PageHeader title="安全設定" description="管理登入密碼與 session 操作。正式版可再加入 MFA、裝置清單與 audit log。" />
      {params.updated ? <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">密碼已更新。</p> : null}
      {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">密碼至少需要 8 個字元。</p> : null}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">更新密碼</h2>
          <form action={updatePasswordAction} className="grid gap-4">
            <Field label="新密碼" name="password" type="password" required />
            <SubmitButton>更新密碼</SubmitButton>
          </form>
        </Card>
        <Card>
          <h2 className="mb-2 text-lg font-semibold text-slate-950">登出此裝置</h2>
          <p className="mb-4 text-sm text-slate-500">MVP 使用單一 cookie session，這裡先提供清除目前 session 的操作。</p>
          <form action={logoutAction}>
            <DangerButton>登出</DangerButton>
          </form>
        </Card>
      </div>
    </>
  );
}
