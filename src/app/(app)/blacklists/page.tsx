import { Search } from "lucide-react";
import { unblockBlacklistAction, upsertBlacklistAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Badge, Card, Field, PageHeader, SubmitButton, TextArea } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

export default async function BlacklistsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const vendor = await requireVendorManager();
  const { q = "" } = await searchParams;
  const entries = await getDb().blacklist.findMany({
    where: {
      vendorId: vendor.id,
      OR: q
        ? [
            { identifier: { contains: q } },
            { reason: { contains: q } },
            { notes: { contains: q } },
          ]
        : undefined,
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <PageHeader title="黑名單管理" description="管理互動風險與無效名單來源，可搜尋、記錄原因並解除封鎖。" />
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.4fr]">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">新增封鎖項目</h2>
          <form action={upsertBlacklistAction} className="grid gap-4">
            <CsrfField />
            <Field label="識別值" name="identifier" required placeholder="Email、手機、IP 或 visitorId" />
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              類型
              <select name="identifierType" className="h-10 rounded-md border border-border px-3 text-sm">
                <option value="email">Email</option>
                <option value="phone">手機</option>
                <option value="ip">IP</option>
                <option value="visitor_id">Visitor ID</option>
              </select>
            </label>
            <Field label="原因" name="reason" required />
            <TextArea label="備註" name="notes" />
            <SubmitButton>加入黑名單</SubmitButton>
          </form>
        </Card>

        <Card>
          <form className="mb-4 flex gap-2">
            <input name="q" defaultValue={q} placeholder="搜尋識別值、原因、備註" className="h-10 flex-1 rounded-md border border-border px-3 text-sm" />
            <button className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-4 text-sm font-semibold text-slate-600">
              <Search size={16} />
              搜尋
            </button>
          </form>
          <div className="grid gap-3">
            {entries.map((entry) => (
              <div key={entry.id} className="grid gap-3 rounded-lg border border-border p-4 lg:grid-cols-[1fr_auto] lg:items-center">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-semibold text-slate-950">{entry.identifier}</h2>
                    <Badge tone={entry.isActive ? "orange" : "gray"}>{entry.isActive ? "封鎖中" : "已解除"}</Badge>
                    <Badge tone="blue">{entry.identifierType}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{entry.reason}</p>
                  <p className="mt-1 text-xs text-slate-400">建立：{formatDateTime(entry.createdAt)}</p>
                </div>
                {entry.isActive ? (
                  <form action={unblockBlacklistAction}>
                    <CsrfField />
                    <input type="hidden" name="id" value={entry.id} />
                    <button className="h-10 rounded-md border border-border px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">解除封鎖</button>
                  </form>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
