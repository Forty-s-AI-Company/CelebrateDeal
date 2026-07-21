import { notFound } from "next/navigation";
import { upsertLiveAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, PageHeader, SelectField, SubmitButton, TextArea } from "@/components/ui";
import { requireVendorManager } from "@/lib/auth";
import { getDb } from "@/lib/db";

export default async function EditLivePage({ params }: { params: Promise<{ id: string }> }) {
  const vendor = await requireVendorManager();
  const { id } = await params;
  const db = getDb();
  const [live, videos, products, forms, templates, scripts] = await Promise.all([
    db.live.findFirst({ where: { id, vendorId: vendor.id }, include: { products: true } }),
    db.video.findMany({ where: { vendorId: vendor.id } }),
    db.product.findMany({ where: { vendorId: vendor.id } }),
    db.registrationForm.findMany({ where: { vendorId: vendor.id } }),
    db.messageTemplate.findMany({ where: { vendorId: vendor.id } }),
    db.interactionScript.findMany({ where: { vendorId: vendor.id } }),
  ]);
  if (!live) notFound();
  const selectedProducts = new Set(live.products.map((item) => item.productId));

  return (
    <>
      <PageHeader title="編輯直播間" description="調整直播頁素材、狀態與商品綁定。" />
      <Card>
        <form action={upsertLiveAction} className="grid gap-4">
          <CsrfField />
          <input type="hidden" name="id" value={live.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="直播標題" name="title" required defaultValue={live.title} />
            <Field label="Slug" name="slug" required defaultValue={live.slug} />
            <Field label="開播時間" name="scheduledAt" type="datetime-local" defaultValue={live.scheduledAt.toISOString().slice(0, 16)} />
            <SelectField label="串流模式" name="streamMode" defaultValue={live.streamMode}>
              <option value="vod">Cloudflare Stream VOD</option>
              <option value="live">Cloudflare Stream Live</option>
            </SelectField>
            <SelectField label="狀態" name="status" defaultValue={live.status}>
              <option value="draft">draft</option>
              <option value="scheduled">scheduled</option>
              <option value="live">live</option>
              <option value="ended">ended</option>
            </SelectField>
            <SelectField label="影片" name="videoId" defaultValue={live.videoId}>
              <option value="">不綁定影片</option>
              {videos.map((video) => <option key={video.id} value={video.id}>{video.title}</option>)}
            </SelectField>
            <SelectField label="表單" name="formId" defaultValue={live.formId}>
              <option value="">不綁定表單</option>
              {forms.map((form) => <option key={form.id} value={form.id}>{form.name}</option>)}
            </SelectField>
            <SelectField label="通知模板" name="messageTemplateId" defaultValue={live.messageTemplateId}>
              <option value="">不綁定模板</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </SelectField>
            <SelectField label="互動腳本" name="interactionScriptId" defaultValue={live.interactionScriptId}>
              <option value="">不綁定腳本</option>
              {scripts.map((script) => <option key={script.id} value={script.id}>{script.name}</option>)}
            </SelectField>
          </div>
          <TextArea label="直播說明" name="description" defaultValue={live.description} />
          <Field label="Hero 圖片 URL" name="heroImageUrl" defaultValue={live.heroImageUrl} />
          <Field label="促銷短句" name="accentCopy" defaultValue={live.accentCopy} />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Cloudflare Live Input UID" name="cloudflareLiveInputUid" defaultValue={live.cloudflareLiveInputUid} />
            <Field label="觀看人數上限" name="maxConcurrentViewers" type="number" defaultValue={500} />
            <Field label="點數低於多少停止推播" name="stopWhenCreditsBelow" type="number" defaultValue={300} />
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-semibold text-slate-700">綁定商品</p>
            {products.map((product) => (
              <label key={product.id} className="flex items-center gap-3 rounded-md border border-border p-3 text-sm">
                <input name="productIds" type="checkbox" value={product.id} defaultChecked={selectedProducts.has(product.id)} className="h-4 w-4 accent-blue-600" />
                {product.name}
              </label>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input name="replayEnabled" type="checkbox" defaultChecked={live.replayEnabled} className="h-4 w-4 accent-blue-600" />
            允許回放
          </label>
          <SubmitButton />
        </form>
      </Card>
    </>
  );
}
