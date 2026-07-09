import type { MessageTemplate } from "@prisma/client";
import { upsertTemplateAction } from "@/app/actions";
import { Card, Field, SelectField, SubmitButton, TextArea } from "@/components/ui";

export function MessageTemplateForm({ template }: { template?: MessageTemplate }) {
  return (
    <Card>
      <form action={upsertTemplateAction} className="grid gap-4">
        {template ? <input type="hidden" name="id" value={template.id} /> : null}
        <Field label="模板名稱" name="name" required defaultValue={template?.name} />
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField label="渠道" name="channel" defaultValue={template?.channel ?? "email"}>
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="line">LINE</option>
          </SelectField>
          <SelectField label="觸發條件" name="trigger" defaultValue={template?.trigger ?? "registration_confirmed"}>
            <option value="registration_confirmed">報名成功</option>
            <option value="live_reminder">開播提醒</option>
            <option value="cart_followup">購買追蹤</option>
          </SelectField>
        </div>
        <Field label="主旨" name="subject" defaultValue={template?.subject} />
        <TextArea label="內容" name="body" rows={8} defaultValue={template?.body} />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <input name="isActive" type="checkbox" defaultChecked={template?.isActive ?? true} className="h-4 w-4 accent-blue-600" />
          啟用模板
        </label>
        <SubmitButton />
      </form>
    </Card>
  );
}
