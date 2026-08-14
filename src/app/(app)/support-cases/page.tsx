import Link from "next/link";
import type { SupportCasePriority, SupportCaseStatus } from "@prisma/client";

import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireVendorSupportMfa } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  SUPPORT_CASE_PRIORITIES,
  SUPPORT_CASE_STATUSES,
} from "@/lib/support-case-domain";

const statusLabels: Record<string, string> = {
  open: "待受理",
  in_progress: "處理中",
  waiting_customer: "等待買家",
  waiting_finance: "等待平台財務",
  resolved: "已解決",
  closed: "已結案",
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SupportCasesPage({ searchParams }: {
  searchParams?: Promise<{ status?: string | string[]; priority?: string | string[]; q?: string | string[] }>;
}) {
  const { vendor } = await requireVendorSupportMfa("/support-cases");
  const query = await searchParams;
  const statusCandidate = one(query?.status);
  const priorityCandidate = one(query?.priority);
  const status = SUPPORT_CASE_STATUSES.includes(statusCandidate as typeof SUPPORT_CASE_STATUSES[number])
    ? statusCandidate as SupportCaseStatus
    : null;
  const priority = SUPPORT_CASE_PRIORITIES.includes(priorityCandidate as typeof SUPPORT_CASE_PRIORITIES[number])
    ? priorityCandidate as SupportCasePriority
    : null;
  const search = one(query?.q)?.trim().slice(0, 160) ?? "";
  const cases = await getDb().supportCase.findMany({
    where: {
      vendorId: vendor.id,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
      ...(search ? {
        OR: [
          { caseNumber: { contains: search, mode: "insensitive" } },
          { order: { orderNumber: { contains: search, mode: "insensitive" } } },
        ],
      } : {}),
    },
    include: {
      order: { select: { id: true, orderNumber: true, buyerMaskedName: true, buyerMaskedEmail: true } },
      assignedMember: { include: { user: { select: { name: true } } } },
      refundHandoff: { select: { status: true, requestedAmountCents: true } },
    },
    orderBy: [{ priority: "asc" }, { updatedAt: "desc" }],
    take: 200,
  });

  return (
    <>
      <PageHeader title="客服案件" description="集中處理訂單問題、指派 owner、保存加密紀錄，並把退款需求安全交接到平台財務。" />
      <Card className="mb-5">
        <form method="get" className="grid gap-3 lg:grid-cols-[1fr_200px_200px_auto] lg:items-end">
          <label className="grid gap-1 text-sm font-medium text-slate-700">案件／訂單編號
            <input name="q" defaultValue={search} maxLength={160} className="min-h-11 rounded-md border border-slate-300 px-3" placeholder="SC-… 或訂單編號" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">案件狀態
            <select name="status" defaultValue={status ?? ""} className="min-h-11 rounded-md border border-slate-300 bg-white px-3">
              <option value="">全部狀態</option>
              {SUPPORT_CASE_STATUSES.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">優先等級
            <select name="priority" defaultValue={priority ?? ""} className="min-h-11 rounded-md border border-slate-300 bg-white px-3">
              <option value="">全部等級</option>
              {SUPPORT_CASE_PRIORITIES.map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}
            </select>
          </label>
          <button className="min-h-11 rounded-md bg-primary px-4 text-sm font-semibold text-white">篩選</button>
        </form>
      </Card>
      {cases.length === 0 ? (
        <EmptyState title="沒有符合條件的客服案件" description="請從訂單詳情建立第一張案件，避免脫離 canonical 訂單手動猜測買家資料。" />
      ) : (
        <div className="grid gap-3">
          {cases.map((supportCase) => (
            <Link key={supportCase.id} href={`/support-cases/${encodeURIComponent(supportCase.id)}`} className="rounded-lg border border-border bg-white p-4 shadow-sm transition hover:bg-slate-50">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-slate-950">{supportCase.caseNumber}</h2>
                  <p className="mt-1 text-sm text-slate-600">訂單 {supportCase.order.orderNumber} · {supportCase.order.buyerMaskedName} · {supportCase.order.buyerMaskedEmail}</p>
                  <p className="mt-2 text-xs text-slate-500">{supportCase.category} · owner：{supportCase.assignedMember?.user.name ?? "未指派"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={supportCase.priority === "p0" ? "red" : supportCase.priority === "p1" ? "orange" : "gray"}>{supportCase.priority.toUpperCase()}</Badge>
                  <Badge tone={supportCase.status === "resolved" || supportCase.status === "closed" ? "green" : "blue"}>{statusLabels[supportCase.status]}</Badge>
                  {!supportCase.firstRespondedAt && supportCase.responseDueAt < new Date() && !["resolved", "closed"].includes(supportCase.status) ? <Badge tone="red">首次回應逾時</Badge> : null}
                  {supportCase.refundHandoff ? <Badge tone="orange">退款：{supportCase.refundHandoff.status}</Badge> : null}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
