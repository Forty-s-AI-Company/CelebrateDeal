import { Card } from "@/components/ui";

export default function MessageDeliveriesLoading() {
  return (
    <div aria-busy="true" aria-label="正在載入 Email 寄送營運資料" className="grid gap-4">
      <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Card key={index}><div className="h-14 animate-pulse rounded bg-slate-100" /></Card>)}
      </div>
      <Card><div className="h-32 animate-pulse rounded bg-slate-100" /></Card>
      <Card><div className="h-64 animate-pulse rounded bg-slate-100" /></Card>
      <p role="status" aria-live="polite" className="sr-only">正在載入 Email 寄送營運資料。</p>
    </div>
  );
}
