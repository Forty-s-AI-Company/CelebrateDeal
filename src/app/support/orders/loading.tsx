import { PublicPolicyShell } from "@/components/public-policy";

export default function BuyerOrdersLoading() {
  return (
    <PublicPolicyShell>
      <main className="mx-auto max-w-5xl" aria-busy="true" aria-live="polite">
        <p className="text-sm font-semibold text-primary">安全訂單查詢</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">正在載入我的訂單</h1>
        <p role="status" className="mt-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">正在驗證目前瀏覽器的訂單存取權限，請稍候。</p>
      </main>
    </PublicPolicyShell>
  );
}
