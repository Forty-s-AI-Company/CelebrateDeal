import type { Product } from "@prisma/client";
import { upsertProductAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, SubmitButton, TextArea } from "@/components/ui";

export function ProductForm({ product }: { product?: Product }) {
  return (
    <Card>
      <form action={upsertProductAction} className="grid gap-4">
        <CsrfField />
        {product ? <input type="hidden" name="id" value={product.id} /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="商品名稱" name="name" required defaultValue={product?.name} />
          <Field label="Slug" name="slug" required defaultValue={product?.slug} />
          <Field label="售價（分）" name="priceCents" type="number" required defaultValue={product?.priceCents ?? 0} />
          <Field label="原價（分）" name="compareAtCents" type="number" defaultValue={product?.compareAtCents} />
          <Field label="幣別" name="currency" defaultValue={product?.currency ?? "TWD"} />
          <Field label="庫存" name="inventory" type="number" defaultValue={product?.inventory ?? 0} />
        </div>
        <TextArea label="商品描述" name="description" defaultValue={product?.description} />
        <Field label="圖片 URL" name="imageUrl" defaultValue={product?.imageUrl} placeholder="https://..." />
        <Field label="結帳 URL" name="checkoutUrl" defaultValue={product?.checkoutUrl} placeholder="https://..." />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input name="isActive" type="checkbox" defaultChecked={product?.isActive ?? true} className="h-4 w-4 accent-blue-600" />
          上架商品
        </label>
        <SubmitButton />
      </form>
    </Card>
  );
}
