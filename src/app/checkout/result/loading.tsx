import { PublicPolicyShell } from "@/components/public-policy";
import { Card } from "@/components/ui";

export default function PaymentResultLoading() {
  return (
    <PublicPolicyShell>
      <main className="mx-auto max-w-4xl" aria-busy="true" aria-live="polite">
        <span role="status" className="sr-only">正在安全確認付款與訂單狀態，請稍候。</span>
        <div className="h-5 w-28 animate-pulse rounded bg-slate-200" />
        <div className="mt-3 h-10 w-64 max-w-full animate-pulse rounded bg-slate-200" />
        <div className="mt-5 h-20 animate-pulse rounded-xl bg-slate-100" />
        <Card className="mt-6 animate-pulse">
          <div className="h-5 w-48 rounded bg-slate-200" />
          <div className="mt-4 h-16 rounded bg-slate-100" />
        </Card>
      </main>
    </PublicPolicyShell>
  );
}
