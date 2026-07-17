import { Card, PageHeader } from "@/components/ui";
import { formatCurrency } from "@/lib/format";
import type { TeamFunnelPerformanceReport } from "@/lib/team-funnel-performance";

type TeamOption = { id: string; name: string };

export function TeamPerformanceDashboard({
  report,
  teams,
  selected,
}: {
  report: TeamFunnelPerformanceReport;
  teams: TeamOption[];
  selected: { teamId: string; startDate: string; endDate: string; templateId?: string; partnerMembershipId?: string };
}) {
  return (
    <>
      <PageHeader title="展業成效" description="依真實頁面歸因、點擊、報名與可明確對應頁面的瀏覽事件彙整；不會推估缺少的資料。" />
      <Card className="mb-6">
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" method="get">
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">團隊
            <select className="h-10 rounded-md border border-border bg-white px-3 text-sm" name="teamId" defaultValue={selected.teamId}>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">開始日期
            <input className="h-10 rounded-md border border-border bg-white px-3 text-sm" name="startDate" type="date" defaultValue={selected.startDate} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">結束日期
            <input className="h-10 rounded-md border border-border bg-white px-3 text-sm" name="endDate" type="date" defaultValue={selected.endDate} />
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">模板
            <select className="h-10 rounded-md border border-border bg-white px-3 text-sm" name="templateId" defaultValue={selected.templateId ?? ""}>
              <option value="">全部模板</option>
              {report.templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">夥伴
            <select className="h-10 rounded-md border border-border bg-white px-3 text-sm" name="partnerMembershipId" defaultValue={selected.partnerMembershipId ?? ""}>
              <option value="">全部可見夥伴</option>
              {report.partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}
            </select>
          </label>
          <div className="xl:col-span-5"><button className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark">套用篩選</button></div>
        </form>
      </Card>

      {report.delayedData ? <p role="status" className="mb-4 rounded-md bg-orange-50 p-3 text-sm text-orange-800">最近 15 分鐘的瀏覽事件可能仍在延遲處理；目前只顯示已收到的實際資料。</p> : null}
      {report.truncated ? <p role="status" className="mb-4 rounded-md bg-orange-50 p-3 text-sm text-orange-800">結果已達安全上限，請縮小日期或篩選範圍；未顯示的資料未納入合計。</p> : null}
      <Card className="overflow-x-auto">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-950">頁面與夥伴成效</h2>
          <p className="text-sm text-slate-500">{formatRange(report.range.start, report.range.endExclusive, report.range.timezone)} · {scopeLabel(report.scope)}</p>
        </div>
        {report.rows.length === 0 ? <p role="status" className="py-8 text-center text-sm text-slate-500">此篩選範圍內沒有你可查看的夥伴頁。</p> : (
          <table className="min-w-[1100px] w-full text-left text-sm">
            <thead className="border-y border-border bg-slate-50 text-slate-600"><tr><th className="px-3 py-3 font-semibold">模板／版本</th><th className="px-3 py-3 font-semibold">夥伴／頁面</th><th className="px-3 py-3 font-semibold">瀏覽</th><th className="px-3 py-3 font-semibold">點擊</th><th className="px-3 py-3 font-semibold">報名</th><th className="px-3 py-3 font-semibold">成交</th><th className="px-3 py-3 font-semibold">淨成交額</th><th className="px-3 py-3 font-semibold">點擊率</th><th className="px-3 py-3 font-semibold">報名轉換率</th></tr></thead>
            <tbody className="divide-y divide-border">
              {report.rows.map((row) => <tr key={row.pageId}>
                <td className="px-3 py-3 text-slate-700">{row.templateName}<span className="ml-1 text-slate-500">v{row.templateVersion}</span></td>
                <td className="px-3 py-3"><p className="font-medium text-slate-950">{row.partnerName}</p><p className="text-slate-500">/{row.pageSlug}</p></td>
                <td className="px-3 py-3">{metric(row.views, row.analyticsState)}</td>
                <td className="px-3 py-3">{row.clicks}</td>
                <td className="px-3 py-3">{row.submissions}</td>
                <td className="px-3 py-3">{row.conversions}</td>
                <td className="px-3 py-3">{formatCurrency(row.netConversionAmountCents)}</td>
                <td className="px-3 py-3">{rate(row.viewToClickRate)}</td>
                <td className="px-3 py-3">{rate(row.viewToSubmissionRate)}</td>
              </tr>)}
            </tbody>
          </table>
        )}
      </Card>
      <p className="mt-3 text-xs leading-5 text-slate-500">「未回傳」表示在此頁、此期間沒有可用 pageId 驗證的瀏覽事件；不以直播總流量或其他頁面資料補值。轉換率在瀏覽為 0 或未回傳時不計算。</p>
    </>
  );
}

function metric(value: number | null, state: "available" | "missing" | "delayed") {
  if (value === null) return <span className="text-slate-500">未回傳</span>;
  return <span>{value}{state === "delayed" ? <span className="ml-1 text-xs text-orange-700">延遲中</span> : null}</span>;
}

function rate(value: number | null) {
  return value === null ? <span className="text-slate-500">—</span> : `${value}%`;
}

function formatRange(start: Date, endExclusive: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat("zh-TW", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  return `${formatter.format(start)} 至 ${formatter.format(new Date(endExclusive.getTime() - 1))}`;
}

function scopeLabel(scope: TeamFunnelPerformanceReport["scope"]) {
  return scope === "leader_template" ? "模板擁有者範圍" : scope === "mixed" ? "我的模板與我的頁面" : "僅我的頁面";
}
