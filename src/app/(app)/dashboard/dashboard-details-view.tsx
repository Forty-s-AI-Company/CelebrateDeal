import { CheckCircle2, Radio } from "lucide-react";
import Link from "next/link";
import { Badge, ButtonLink, Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { formatLiveCountdown } from "@/lib/live-countdown";
import type { DashboardDetailsData } from "./dashboard-details";

export default function DashboardDetailsContent({ data }: { data: DashboardDetailsData }) {
  const {
    now,
    recentLives,
    recentLiveSubmissionCounts,
    upcomingLives,
    affiliates,
    usageLimit,
    checklist,
    isManager,
  } = data;

  return (
    <>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">近期直播</h2>
            {isManager ? <ButtonLink href="/lives" tone="secondary">查看全部</ButtonLink> : null}
          </div>
          {recentLives.length > 0 ? (
            <div className="grid gap-3">
              {recentLives.map((live) => {
                const submissionCounts = recentLiveSubmissionCounts[live.id] ?? { verified: 0, pending: 0 };
                const content = (
                  <>
                    <span className="flex items-center gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-md bg-blue-50 text-primary"><Radio size={18} aria-hidden="true" /></span>
                      <span>
                        <span className="block font-semibold text-slate-900">{live.title}</span>
                        <span className="block text-sm text-slate-500">{formatDateTime(live.scheduledAt)}</span>
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <Badge tone="blue">{live.status}</Badge>
                      <Badge tone="green">{submissionCounts.verified} 已驗證</Badge>
                      {submissionCounts.pending > 0 ? <Badge tone="gray">{submissionCounts.pending} 待驗證</Badge> : null}
                    </span>
                  </>
                );
                return isManager
                  ? <Link key={live.id} href={`/lives/${live.id}/analytics`} className="flex flex-col gap-3 rounded-lg border border-border p-4 hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between">{content}</Link>
                  : <div key={live.id} className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between">{content}</div>;
              })}
            </div>
          ) : (
            <div className="rounded-md bg-slate-50 px-4 py-5 text-sm text-slate-600">
              <p>目前還沒有直播資料。</p>
              {isManager ? <Link href="/lives/new" className="mt-2 inline-flex font-semibold text-primary hover:underline">建立第一場直播</Link> : null}
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">Onboarding checklist</h2>
          <div className="grid gap-2">
            {checklist.map((item) => (
              <Link key={item.label} href={item.href} className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm hover:bg-slate-50">
                <CheckCircle2 size={18} aria-hidden="true" className={item.done ? "text-emerald-600" : "text-slate-300"} />
                <span className={item.done ? "text-slate-700" : "font-medium text-primary"}>{item.label}</span>
                <span className="sr-only">{item.done ? "已完成" : "尚未完成，前往設定"}</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">即將開播</h2>
          {upcomingLives.length > 0 ? (
            <div className="grid gap-3">
              {upcomingLives.map((live) => (
                <div key={live.id} className="rounded-md border border-border p-3">
                  <p className="font-semibold text-slate-950">{live.title}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatDateTime(live.scheduledAt)}</p>
                  <p className="mt-2 text-sm font-medium text-primary">即將開播倒數：{formatLiveCountdown(live.scheduledAt, now) ?? "排程時間無效"}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-slate-600">目前沒有排定中的直播。</p>}
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">聯盟來源摘要</h2>
          {affiliates.length > 0 ? (
            <div className="grid gap-3">
              {affiliates.map((affiliate) => (
                <div key={affiliate.code} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
                  <span>
                    <b className="block text-slate-950">{affiliate.code}</b>
                    <span className="text-slate-500">{affiliate.name}</span>
                  </span>
                  <span className="text-right">
                    <b className="block">{affiliate._count.clicks}</b>
                    <span className="text-slate-500">點擊</span>
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-slate-600">尚未建立聯盟來源。</p>}
        </Card>
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">用量 / 配額</h2>
          {usageLimit ? (
            <div>
              <p className="text-sm text-slate-500">{usageLimit.billingPlan?.name ?? "未指定方案"}</p>
              <p className="mt-2 text-3xl font-semibold text-slate-950">{usageLimit.creditsLimit > 0 ? Math.round((usageLimit.creditsUsed / usageLimit.creditsLimit) * 100) : 0}%</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-primary" style={{ width: `${usageLimit.creditsLimit > 0 ? Math.round((usageLimit.creditsUsed / usageLimit.creditsLimit) * 100) : 0}%` }} /></div>
              <p className="mt-3 text-sm text-slate-500">剩餘 {(usageLimit.creditsLimit - usageLimit.creditsUsed).toLocaleString()} 點</p>
            </div>
          ) : <p className="text-sm text-slate-500">尚未設定方案。</p>}
        </Card>
      </div>
    </>
  );
}
