"use client";

import { useActionState, useEffect, useState } from "react";
import { Copy, ExternalLink, Eye, LockKeyhole, Save, Send, X } from "lucide-react";
import { Card } from "@/components/ui";
import type { PartnerPageActionState } from "@/app/actions/team-funnel-partner-actions";

const fields = [
  ["HEADLINE", "headline", "主標題"], ["SUBHEADLINE", "subheadline", "副標題"], ["BODY", "body", "內容說明"], ["CTA_LABEL", "ctaLabel", "CTA 按鈕文字"], ["CTA_URL", "ctaUrl", "CTA 連結"],
] as const;
const slots = [["main_product", "主打商品"], ["bundle_product", "組合商品"], ["join_member", "加入會員"], ["consultation", "諮詢預約"]] as const;
const initialState: PartnerPageActionState = { status: "idle", message: "" };

export type PartnerPageEditorData = {
  id: string;
  teamId: string;
  slug: string;
  headline: string;
  subheadline: string | null;
  body: string | null;
  ctaLabel: string;
  ctaUrl: string | null;
  source: { name: string; ownerName: string; version: number; webinar: string | null };
  lockedFields: string[];
  partner: { name: string; email: string };
  isPublished: boolean;
  slots: Array<{ key: string; productId: string | null; overrideUrl: string | null; available: boolean }>;
};

type PartnerAction = (state: PartnerPageActionState, formData: FormData) => Promise<PartnerPageActionState>;

function LockedNotice({ label, source }: { label: string; source: string }) {
  return <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><LockKeyhole size={13} />{label} 由 {source} 的模板版本鎖定，僅供閱讀。</p>;
}

export function PartnerPageEditor({ page, products, csrfToken, saveAction, publishAction }: {
  page: PartnerPageEditorData;
  products: Array<{ id: string; name: string }>;
  csrfToken: string;
  saveAction: PartnerAction;
  publishAction: PartnerAction;
}) {
  const [saveState, saveFormAction, saving] = useActionState(saveAction, initialState);
  const [publishState, publishFormAction, publishing] = useActionState(publishAction, initialState);
  const [copied, setCopied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const locked = new Set(page.lockedFields);
  const slotByKey = new Map(page.slots.map((slot) => [slot.key, slot]));
  const publicUrl = typeof window === "undefined" ? `/p/${page.slug}` : new URL(`/p/${page.slug}`, window.location.origin).toString();

  useEffect(() => { if (!copied) return; const timeout = window.setTimeout(() => setCopied(false), 1800); return () => window.clearTimeout(timeout); }, [copied]);
  async function copyUrl() {
    await navigator.clipboard?.writeText(publicUrl);
    setCopied(true);
  }

  return (
    <div className="grid gap-5">
      <Card className="border-blue-100 bg-blue-50">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm font-semibold text-blue-900">來源 A：{page.source.ownerName} · {page.source.name} v{page.source.version}</p><p className="mt-1 text-sm text-blue-800">研討會：{page.source.webinar ?? "未綁定"}</p></div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${page.isPublished ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700"}`}>{page.isPublished ? "已發布" : "未發布"}</span>
        </div>
        <p className="mt-3 flex gap-2 text-xs leading-5 text-blue-800"><LockKeyhole size={15} className="mt-0.5 shrink-0" />A 鎖定的內容沿用該版本，不能由夥伴變更；未鎖定欄位與你的商品連結可在下方管理。</p>
      </Card>

      <Card>
        <form action={saveFormAction} className="grid gap-6">
          <input type="hidden" name="_csrf" value={csrfToken} /><input type="hidden" name="teamId" value={page.teamId} /><input type="hidden" name="pageId" value={page.id} />
          <section className="grid gap-4" aria-labelledby="content-title"><h2 id="content-title" className="font-semibold text-slate-950">頁面內容</h2>
            {fields.map(([field, name, label]) => {
              const isLocked = locked.has(field); const current = page[name];
              const common = { name, defaultValue: current ?? "", disabled: isLocked, className: "rounded-md border border-border bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500" };
              return <label key={field} className="grid gap-1.5 text-sm font-medium text-slate-700">{label}
                {name === "body" ? <textarea {...common} rows={6} /> : <input {...common} type={name === "ctaUrl" ? "url" : "text"} required={name === "headline" || name === "ctaLabel"} />}
                {isLocked ? <LockedNotice label={label} source={page.source.ownerName} /> : null}
              </label>;
            })}
          </section>

          <section className="grid gap-4 rounded-lg border border-border p-4" aria-labelledby="profile-title"><h2 id="profile-title" className="font-semibold text-slate-950">帳號聯絡資料</h2><p className="text-xs text-slate-500">公開頁會使用登入帳號的名稱與 Email；此處僅供閱讀，不會隨儲存表單送出。</p>
            <dl className="grid gap-4 md:grid-cols-2"><div className="grid gap-1.5"><dt className="text-sm font-medium text-slate-700">帳號名稱</dt><dd className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">{page.partner.name || "尚未設定"}</dd></div><div className="grid gap-1.5"><dt className="text-sm font-medium text-slate-700">帳號 Email</dt><dd className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">{page.partner.email || "尚未設定"}</dd></div></dl>
          </section>

          <section className="grid gap-4" aria-labelledby="slot-title"><h2 id="slot-title" className="font-semibold text-slate-950">四個商品槽</h2>
            {locked.has("PRODUCT_SLOTS") ? <LockedNotice label="商品槽" source={page.source.ownerName} /> : null}
            <div className="grid gap-4 md:grid-cols-2">{slots.map(([key, label]) => {
              const slot = slotByKey.get(key); const disabled = locked.has("PRODUCT_SLOTS") || !slot?.available;
              return <div key={key} className="grid gap-2 rounded-md border border-slate-100 p-3"><label className="grid gap-1 text-sm font-medium text-slate-700">{label}
                <select name={`product_${key}`} defaultValue={slot?.productId ?? ""} disabled={disabled} className="h-10 rounded-md border border-border bg-white px-3 text-sm disabled:bg-slate-100"><option value="">使用模板預設商品</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
                <label className="grid gap-1 text-xs text-slate-600">或輸入你的外部連結<input name={`url_${key}`} type="url" defaultValue={slot?.overrideUrl ?? ""} disabled={disabled} placeholder="https://..." className="h-9 rounded-md border border-border px-3 text-sm disabled:bg-slate-100" /></label>
                {!slot?.available ? <p className="text-xs text-slate-500">A 的模板未提供此商品槽。</p> : null}{locked.has("PRODUCT_SLOTS") ? <LockedNotice label={label} source={page.source.ownerName} /> : null}
              </div>;
            })}</div>
          </section>
          {saveState.status !== "idle" ? <p role={saveState.status === "error" ? "alert" : "status"} aria-live="polite" className={saveState.status === "success" ? "rounded-md bg-emerald-50 p-3 text-sm text-emerald-800" : "rounded-md bg-red-50 p-3 text-sm text-red-800"}>{saveState.message}</p> : null}
          <button disabled={saving} className="inline-flex h-10 w-fit items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white disabled:opacity-60"><Save size={16} />{saving ? "儲存中…" : "儲存可編輯內容"}</button>
        </form>
      </Card>

      <Card><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-semibold text-slate-950">預覽與發布</h2><p className="mt-1 text-sm text-slate-500">公開網址：<code>/p/{page.slug}</code></p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setShowPreview((visible) => !visible)} aria-expanded={showPreview} className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700">{showPreview ? <X size={16} /> : <Eye size={16} />}{showPreview ? "關閉預覽" : "預覽"}</button>{page.isPublished ? <a href={`/p/${page.slug}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700"><ExternalLink size={16} />開啟公開頁</a> : null}<button type="button" onClick={copyUrl} className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700"><Copy size={16} />{copied ? "已複製" : "複製公開 URL"}</button></div></div>
        {showPreview ? <section aria-label="夥伴頁預覽" className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-5"><p className="text-xs font-semibold tracking-wide text-slate-500">未發布內容預覽</p><h3 className="mt-2 text-2xl font-semibold text-slate-950">{page.headline || "尚未填寫主標題"}</h3>{page.subheadline ? <p className="mt-2 text-slate-600">{page.subheadline}</p> : null}{page.body ? <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-700">{page.body}</p> : null}<button type="button" className="mt-5 rounded-md bg-cta px-4 py-2 text-sm font-semibold text-white">{page.ctaLabel || "尚未填寫 CTA"}</button><p className="mt-4 text-xs text-slate-500">聯絡夥伴：{page.partner.name || "尚未填寫名稱"}{page.partner.email ? ` · ${page.partner.email}` : ""}</p></section> : null}
        <form action={publishFormAction} className="mt-4 flex flex-wrap items-center gap-3"><input type="hidden" name="_csrf" value={csrfToken} /><input type="hidden" name="teamId" value={page.teamId} /><input type="hidden" name="pageId" value={page.id} /><input type="hidden" name="publish" value={page.isPublished ? "false" : "true"} />
          <button disabled={publishing} className={`inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-semibold text-white disabled:opacity-60 ${page.isPublished ? "bg-slate-700" : "bg-cta"}`}><Send size={16} />{publishing ? "更新中…" : page.isPublished ? "停止公開" : "發布公開頁"}</button>{publishState.status !== "idle" ? <p role={publishState.status === "error" ? "alert" : "status"} aria-live="polite" className={publishState.status === "success" ? "text-sm text-emerald-800" : "text-sm text-red-800"}>{publishState.message}</p> : null}
        </form>
      </Card>
    </div>
  );
}
