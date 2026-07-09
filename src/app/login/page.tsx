import { loginAction } from "@/app/actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <section className="w-full max-w-md rounded-lg border border-border bg-white p-6 shadow-sm">
        <div className="mb-6">
          <p className="text-sm font-semibold text-primary">CelebrateDeal</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-950">登入直播商務後台</h1>
          <p className="mt-2 text-sm text-slate-500">Demo 帳號：demo@celebratedeal.local / demo1234</p>
        </div>
        {params.error ? <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">帳號或密碼不正確。</p> : null}
        <form action={loginAction} className="grid gap-4">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Email
            <input name="email" type="email" required defaultValue="demo@celebratedeal.local" className="h-10 rounded-md border border-border px-3" />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            密碼
            <input name="password" type="password" required defaultValue="demo1234" className="h-10 rounded-md border border-border px-3" />
          </label>
          <button className="h-10 rounded-md bg-primary text-sm font-semibold text-white hover:bg-primary-dark">登入</button>
        </form>
      </section>
    </main>
  );
}
