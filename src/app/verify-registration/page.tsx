import { NativePostForm } from "@/components/native-post-form";

export const dynamic = "force-dynamic";

function validTokenShape(value: string | undefined) {
  return Boolean(value && value.length <= 320 && /^fsv1\.[A-Za-z0-9_-]{1,128}\.\d{1,12}\.\d{1,9}\.[A-Za-z0-9_-]{43}$/u.test(value));
}

export default async function VerifyRegistrationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const query = await searchParams;
  const hasToken = validTokenShape(query.token);
  const verified = query.status === "verified";
  const invalid = query.status === "invalid" || (!verified && !hasToken);

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-blue-700">CelebrateDeal 報名確認</p>
        {verified ? (
          <div role="status" aria-live="polite" className="mt-4 rounded-xl bg-emerald-50 p-4 text-emerald-800">
            <h1 className="text-xl font-black">Email 已確認</h1>
            <p className="mt-2 text-sm leading-6">你的報名已列入正式名單，可以關閉這個頁面。</p>
          </div>
        ) : invalid ? (
          <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <h1 className="text-xl font-black">確認連結無效或已過期</h1>
            <p className="mt-2 text-sm leading-6">請回到原活動頁重新送出報名，以取得新的確認信。</p>
          </div>
        ) : (
          <>
            <h1 className="mt-4 text-2xl font-black text-slate-950">確認這是你的 Email</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">為避免他人代填或灌入假名單，請按下確認。只有完成這一步，報名才會進入商家的正式名單。</p>
            <NativePostForm
              action="/api/form-submissions/verify"
              idleLabel="確認 Email 並完成報名"
              pendingLabel="確認中…"
              pendingMessage="正在確認 Email 並完成報名，請勿重複送出。"
              className="mt-5"
              buttonClassName="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
            >
              <input type="hidden" name="token" value={query.token} />
            </NativePostForm>
          </>
        )}
      </section>
    </main>
  );
}
