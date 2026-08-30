import { Card, PageHeader } from "@/components/ui";

export default function BillingUsageLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <PageHeader title="用量與扣點" description="正在載入本月 Stream 用量、分配與對帳狀態。" />
      <span role="status" className="sr-only">正在載入用量資料，請稍候。</span>
      <div className="grid gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="animate-pulse">
            <div className="h-4 w-24 rounded bg-slate-200" />
            <div className="mt-3 h-8 w-32 rounded bg-slate-100" />
          </Card>
        ))}
      </div>
      <Card className="mt-6 animate-pulse">
        <div className="h-5 w-40 rounded bg-slate-200" />
        <div className="mt-4 h-24 rounded bg-slate-100" />
      </Card>
    </div>
  );
}
