import type { RegistrationForm } from "@prisma/client";
import { upsertFormAction } from "@/app/actions";
import { CsrfField } from "@/components/csrf-field";
import { Card, Field, SubmitButton, TextArea } from "@/components/ui";

const defaultFields = JSON.stringify(
  [
    { key: "name", label: "姓名", type: "text", required: true },
    { key: "email", label: "Email", type: "email", required: true },
    { key: "phone", label: "手機", type: "tel", required: false },
  ],
  null,
  2,
);

export function FormBuilder({ form }: { form?: RegistrationForm }) {
  return (
    <Card>
      <form action={upsertFormAction} className="grid gap-4">
        <CsrfField />
        {form ? <input type="hidden" name="id" value={form.id} /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="表單名稱" name="name" required defaultValue={form?.name} />
          <Field label="Slug" name="slug" required defaultValue={form?.slug} />
        </div>
        <Field label="公開標題" name="headline" required defaultValue={form?.headline} />
        <TextArea label="說明文字" name="description" defaultValue={form?.description} />
        <TextArea label="欄位 JSON" name="fields" rows={9} defaultValue={form ? JSON.stringify(form.fields, null, 2) : defaultFields} />
        <Field label="送出按鈕文字" name="submitLabel" defaultValue={form?.submitLabel ?? "送出報名"} />
        <TextArea label="成功訊息" name="successMessage" defaultValue={form?.successMessage} />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input name="isActive" type="checkbox" defaultChecked={form?.isActive ?? true} className="h-4 w-4 accent-blue-600" />
          啟用表單
        </label>
        <SubmitButton />
      </form>
    </Card>
  );
}
