import type { Affiliate } from "@prisma/client";
import { upsertAffiliateAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, SubmitButton } from "@/components/ui";

export function AffiliateForm({ affiliate, portalEmail }: { affiliate?: Affiliate; portalEmail?: string | null }) {
  return (
    <Card>
      <form action={upsertAffiliateAction} className="grid gap-4">
        <CsrfField />
        {affiliate ? <input type="hidden" name="id" value={affiliate.id} /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="夥伴名稱" name="name" required defaultValue={affiliate?.name} />
          <Field label="推廣碼" name="code" required defaultValue={affiliate?.code} />
          <Field label="來源渠道" name="source" defaultValue={affiliate?.source} placeholder="instagram / line / partner-site" />
          <Field label="聯絡 Email" name="contactEmail" type="email" defaultValue={affiliate?.contactEmail} />
          <Field label="佣金 BPS" name="commissionRateBps" type="number" required min={0} max={10000} step={1} defaultValue={affiliate?.commissionRateBps ?? 0} />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input name="isActive" type="checkbox" defaultChecked={affiliate?.isActive ?? true} className="h-4 w-4 accent-blue-600" />
          啟用推廣碼
        </label>
        <div className="rounded-md border border-blue-100 bg-blue-50 p-4">
          <h2 className="font-semibold text-blue-950">推廣者 Portal 權限</h2>
          <p className="mt-1 text-sm text-blue-800">可綁定既有使用者；若 Email 尚未註冊，請同時設定至少 12 字元的初始密碼。</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Portal 登入 Email" name="portalEmail" type="email" defaultValue={portalEmail} autoComplete="off" />
            <Field label="新帳號初始密碼" name="portalPassword" type="password" minLength={12} autoComplete="new-password" />
          </div>
        </div>
        <SubmitButton />
      </form>
    </Card>
  );
}
