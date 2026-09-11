import Link from "next/link";
import type { SalesProjectScope } from "@/lib/sales-project-scope";
import { salesScopeDescription } from "@/lib/sales-project-scope";

export function SalesScopeNotice({ workspaceName, scope }: { workspaceName: string; scope: SalesProjectScope }) {
  return <div className="mb-5 flex flex-col gap-2 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-blue-950 sm:flex-row sm:items-center sm:justify-between" role="status">
    <span className="font-semibold">{salesScopeDescription(workspaceName, scope)}</span>
    {scope.isAggregate ? <Link href="/projects" className="font-semibold text-blue-700 underline underline-offset-4">選擇要編輯的專案</Link> : null}
  </div>;
}
