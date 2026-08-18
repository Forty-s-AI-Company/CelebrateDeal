"use client";

import { useActionState, type ReactNode } from "react";
import { upsertTemplateAction } from "@/app/actions";
import { Field, SelectField, SubmitButton, TextArea } from "@/components/ui";
import {
  initialMessageTemplateActionState,
  MESSAGE_TEMPLATE_VARIABLES,
  messageTemplateVariableLabel,
  type MessageTemplateActionError,
  type MessageTemplateFormDraft,
  type MessageTemplateFormTemplate,
} from "@/lib/message-template";

function templateDraft(template?: MessageTemplateFormTemplate): MessageTemplateFormDraft {
  return {
    name: template?.name ?? "",
    channel: template?.channel ?? "email",
    trigger: template?.trigger ?? "registration_confirmed",
    subject: template?.subject ?? "",
    body: template?.body ?? "",
    isActive: template?.isActive ?? true,
  };
}

function errorMessage(error: MessageTemplateActionError | null) {
  if (error === "missing_template") {
    return "原模板已不存在或不屬於目前商店。你輸入的內容已保留；確認後再次儲存會建立新模板。";
  }
  if (error === "invalid_template") {
    return "模板資料無效，內容已保留。請檢查 Email 主旨、內容、觸發條件與可用變數後再儲存。";
  }
  if (error === "conflict") {
    return "這個模板在其他分頁已有新版，你輸入的內容已保留。請確認後再次儲存，才會覆蓋目前伺服器版本。";
  }
  return null;
}

export function MessageTemplateFormClient({
  template,
  initialError = null,
  csrfField,
}: {
  template?: MessageTemplateFormTemplate;
  initialError?: MessageTemplateActionError | null;
  csrfField: ReactNode;
}) {
  const initialState = initialError
    ? { ...initialMessageTemplateActionState, status: "error" as const, error: initialError }
    : initialMessageTemplateActionState;
  const [state, formAction, pending] = useActionState(upsertTemplateAction, initialState);
  const draft = state.draft ?? templateDraft(template);
  const recoverAsNew = state.error === "missing_template";
  const expectedUpdatedAt = state.expectedUpdatedAt ?? template?.updatedAt ?? null;
  const message = errorMessage(state.error);

  return (
    <form key={state.version} action={formAction} aria-busy={pending} className="grid gap-4">
      {csrfField}
      {template && !recoverAsNew ? <input type="hidden" name="id" value={template.id} /> : null}
      {template && !recoverAsNew && expectedUpdatedAt ? <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} /> : null}
      {message ? (
        <p role="alert" aria-live="assertive" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {message}
        </p>
      ) : null}
      <Field label="模板名稱" name="name" required maxLength={160} defaultValue={draft.name} />
      <div className="grid gap-4 md:grid-cols-2">
        <SelectField label="渠道" name="channel" defaultValue={draft.channel}>
          <option value="email">Email</option>
          <option value="sms" disabled>SMS（尚未串接，不能啟用）</option>
          <option value="line" disabled>LINE（尚未串接，不能啟用）</option>
        </SelectField>
        <SelectField label="觸發條件" name="trigger" defaultValue={draft.trigger}>
          <option value="registration_confirmed">報名成功</option>
          <option value="live_reminder">開播提醒</option>
          <option value="post_live_followup">課後通知</option>
          <option value="cart_followup" disabled>購買追蹤（購物車事件尚未接通）</option>
        </SelectField>
      </div>
      <Field label="主旨" name="subject" required maxLength={200} defaultValue={draft.subject} />
      <TextArea label="內容" name="body" required rows={8} maxLength={20_000} defaultValue={draft.body} />
      <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <p className="font-semibold">可用變數</p>
        <p className="mt-1 break-words font-mono text-xs">
          {MESSAGE_TEMPLATE_VARIABLES.map(messageTemplateVariableLabel).join(" · ")}
        </p>
        <p className="mt-2 text-xs text-blue-700">報名成功、開播提醒與課後通知會自動附上退訂連結；購買追蹤、SMS、LINE 在事件來源或 provider 完成前保持停用。</p>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input name="isActive" type="checkbox" defaultChecked={draft.isActive} className="h-4 w-4 accent-blue-600" />
        啟用模板
      </label>
      <SubmitButton pendingChildren="儲存模板中…" pendingMessage="正在儲存訊息模板，請勿重複送出。" />
    </form>
  );
}
