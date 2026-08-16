import { upsertBlacklistAction } from "@/app/actions";
import { BlacklistSearchList } from "@/components/blacklist-search-list";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, PageHeader, SubmitButton, TextArea } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getCsrfToken } from "@/lib/csrf";
import { getDb } from "@/lib/db";

export default async function BlacklistsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const vendor = await requireVendorManager();
  const { error } = await searchParams;
  const [entries, csrfToken] = await Promise.all([
    getDb().blacklist.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        identifier: true,
        identifierType: true,
        reason: true,
        notes: true,
        isActive: true,
        createdAt: true,
      },
    }),
    getCsrfToken(),
  ]);

  return (
    <>
      <PageHeader title="黑名單管理" description="管理互動風險與無效名單來源，可搜尋、記錄原因並解除封鎖。" />
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.4fr]">
        <Card>
          <h2 className="mb-4 text-lg font-semibold text-slate-950">新增封鎖項目</h2>
          {error === "invalid_identifier" ? (
            <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              識別類型或格式不正確，請確認 Email、手機、IP、Visitor ID 或禁止關鍵字。
            </p>
          ) : null}
          <form action={upsertBlacklistAction} className="grid gap-4">
            <CsrfField />
            <Field label="識別值或關鍵字" name="identifier" required placeholder="Email、手機、IP、visitorId 或禁止關鍵字" />
            <label className="grid gap-1.5 text-sm font-medium text-slate-700">
              類型
              <select name="identifierType" className="h-10 rounded-md border border-border px-3 text-sm">
                <option value="email">Email</option>
                <option value="phone">手機</option>
                <option value="ip">IP</option>
                <option value="visitor_id">Visitor ID</option>
                <option value="keyword">禁止關鍵字</option>
              </select>
            </label>
            <p className="-mt-2 text-xs leading-5 text-slate-500">
              禁止關鍵字會以不分大小寫的純文字片段比對；不會執行正規表示式或萬用字元。
            </p>
            <Field label="原因" name="reason" required />
            <TextArea label="備註" name="notes" />
            <SubmitButton>加入黑名單</SubmitButton>
          </form>
        </Card>

        <Card>
          <BlacklistSearchList
            csrfToken={csrfToken}
            entries={entries.map((entry) => ({
              id: entry.id,
              identifier: entry.identifier,
              identifierType: entry.identifierType,
              reason: entry.reason,
              notes: entry.notes,
              isActive: entry.isActive,
              createdAt: entry.createdAt.toISOString(),
            }))}
          />
        </Card>
      </div>
    </>
  );
}
