import type { Affiliate } from "@prisma/client";
import { upsertAffiliateAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, SubmitButton } from "@/components/ui";

export function AffiliateForm({ affiliate }: { affiliate?: Affiliate }) {
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
          <Field label="佣金 BPS" name="commissionRateBps" type="number" defaultValue={affiliate?.commissionRateBps ?? 0} />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input name="isActive" type="checkbox" defaultChecked={affiliate?.isActive ?? true} className="h-4 w-4 accent-blue-600" />
          啟用推廣碼
        </label>
        <SubmitButton />
      </form>
    </Card>
  );
}
