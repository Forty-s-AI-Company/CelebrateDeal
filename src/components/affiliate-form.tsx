import type { Affiliate } from "@prisma/client";
import Link from "next/link";
import { upsertAffiliateAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { AdvancedSettings, Field, FormActions, FormLayout, FormSection, SubmitButton } from "@/components/ui";

export function AffiliateForm({ affiliate, portalEmail }: { affiliate?: Affiliate; portalEmail?: string | null }) {
  return (
    <FormLayout>
      <form action={upsertAffiliateAction} className="grid gap-5">
        <CsrfField />
        {affiliate ? <input type="hidden" name="id" value={affiliate.id} /> : null}
        <FormSection title="夥伴資料" description="建立團隊看得懂的夥伴名稱、聯絡方式與推廣來源。">
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="夥伴名稱" name="name" required defaultValue={affiliate?.name} />
            <Field label="聯絡 Email" name="contactEmail" type="email" defaultValue={affiliate?.contactEmail} />
            <Field label="來源渠道" name="source" defaultValue={affiliate?.source} placeholder="例如 Instagram、LINE 或合作網站" />
            <Field label="專屬推廣碼" name="code" required defaultValue={affiliate?.code} />
          </div>
        </FormSection>
        <FormSection title="分潤與狀態" description="設定成交後的佣金比例，停用時既有資料仍會保留。">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="佣金比例" name="commissionRateBps" type="number" required min={0} max={10000} step={1} defaultValue={affiliate?.commissionRateBps ?? 0} />
            <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-3 text-sm text-blue-900">100 代表 1%，例如輸入 1500 代表 15%。</div>
          </div>
          <label className="mt-4 flex items-center gap-2 text-sm font-medium text-slate-700">
            <input name="isActive" type="checkbox" defaultChecked={affiliate?.isActive ?? true} className="h-4 w-4 accent-blue-600" />
            建立後立即啟用推廣碼
          </label>
        </FormSection>
        <AdvancedSettings title="夥伴登入權限" description="只有需要讓夥伴登入查看成效時才需設定。">
          <p className="text-sm text-slate-600">可綁定既有使用者；若 Email 尚未註冊，請同時設定至少 12 字元的初始密碼。</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Portal 登入 Email" name="portalEmail" type="email" defaultValue={portalEmail} autoComplete="off" />
            <Field label="新帳號初始密碼" name="portalPassword" type="password" minLength={12} autoComplete="new-password" />
          </div>
        </AdvancedSettings>
        <FormActions>
          <Link href="/affiliates" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">取消</Link>
          <SubmitButton>{affiliate ? "儲存變更" : "建立夥伴"}</SubmitButton>
        </FormActions>
      </form>
    </FormLayout>
  );
}
