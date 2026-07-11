import Link from "next/link";
import { acceptVendorInvitationAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Field, SubmitButton } from "@/components/ui";
import { getInvitationDetails } from "@/lib/invitation";

const errorMessages: Record<string, string> = {
  invalid: "這份邀請無效、已到期或已被使用。",
  profile_invalid: "請確認姓名至少 2 個字元，且兩次密碼一致並至少 12 個字元。",
  rate_limited: "嘗試次數過多，請稍後再試。",
};

export default async function InvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const invitation = await getInvitationDetails(token);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-4 py-10">
      <section className="w-full max-w-lg rounded-lg border border-border bg-white p-6 shadow-sm">
        <Link href="/" className="text-sm font-semibold text-primary">CelebrateDeal</Link>
        <h1 className="mt-5 text-2xl font-semibold text-slate-950">接受工作區邀請</h1>
        {query.error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessages[query.error] ?? errorMessages.invalid}</p> : null}

        {invitation ? (
          <>
            <dl className="mt-5 grid gap-3 rounded-md border border-border bg-slate-50 p-4 text-sm">
              <div><dt className="text-xs text-slate-500">工作區</dt><dd className="mt-1 font-semibold text-slate-900">{invitation.vendor.name}</dd></div>
              <div><dt className="text-xs text-slate-500">受邀 Email</dt><dd className="mt-1 text-slate-700">{invitation.email}</dd></div>
              <div><dt className="text-xs text-slate-500">角色</dt><dd className="mt-1 text-slate-700">{invitation.role}</dd></div>
            </dl>
            <form action={acceptVendorInvitationAction} className="mt-5 grid gap-4">
              <CsrfField />
              <input type="hidden" name="token" value={token} />
              {invitation.requiresRegistration ? (
                <>
                  <Field label="姓名" name="name" required />
                  <Field label="設定密碼" name="password" type="password" required />
                  <Field label="再次輸入密碼" name="confirmPassword" type="password" required />
                </>
              ) : (
                <Field label="確認目前帳號密碼" name="password" type="password" required />
              )}
              <SubmitButton>接受並進入工作區</SubmitButton>
            </form>
          </>
        ) : (
          <div className="mt-5">
            <p className="rounded-md border border-border bg-slate-50 p-4 text-sm text-slate-600">這份邀請無效、已到期或已被使用。</p>
            <Link href="/login" className="mt-4 inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">返回登入</Link>
          </div>
        )}
      </section>
    </main>
  );
}
