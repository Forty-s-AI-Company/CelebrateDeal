"use client";

import { useActionState, useState, type ReactNode } from "react";
import { upsertTemplateAction } from "@/app/actions";
import { RichTextEditor } from "@/components/rich-text-editor";
import { Field, SelectField, SubmitButton } from "@/components/ui";
import {
  initialMessageTemplateActionState,
  LINE_WEBINAR_TEMPLATE_TRIGGERS,
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
    return "模板資料無效，內容已保留。請確認通道為 Email 或 LINE，並檢查主旨、內容、觸發條件與可用變數後再儲存。";
  }
  if (error === "conflict") {
    return "這個模板在其他分頁已有新版，你輸入的內容已保留。請確認後再次儲存，才會覆蓋目前伺服器版本。";
  }
  return null;
}

function TemplateChannelFields({ draft }: { draft: MessageTemplateFormDraft }) {
  const [channel, setChannel] = useState(draft.channel);
  const [trigger, setTrigger] = useState(draft.trigger);
  return <div className="grid gap-4 md:grid-cols-2">
    <SelectField label="渠道" name="channel" value={channel} onChange={event => {
      const next = event.target.value;setChannel(next);
      if ((next === "line" && !(LINE_WEBINAR_TEMPLATE_TRIGGERS as readonly string[]).includes(trigger)) || (next === "email" && trigger === "live_started")) setTrigger("registration_confirmed");
    }}>
      <option value="email">Email</option>
      <option value="line">LINE</option>
      <option value="sms" disabled>SMS（尚未串接，不能啟用）</option>
    </SelectField>
    <SelectField label="觸發條件" name="trigger" value={trigger} onChange={event => setTrigger(event.target.value)}>
      <option value="registration_confirmed">報名成功</option>
      <option value="live_reminder">開播提醒</option>
      <option value="live_started" disabled={channel !== "line"}>直播開始（LINE）</option>
      <option value="post_live_followup" disabled={channel === "line"}>課後通知</option>
      <option value="cart_followup" disabled>購買追蹤（購物車事件尚未接通）</option>
    </SelectField>
  </div>;
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
      <TemplateChannelFields key={state.version} draft={draft} />
      <Field label="主旨" name="subject" required maxLength={200} defaultValue={draft.subject} />
      <RichTextEditor
        label="內容"
        name="body"
        required
        rows={8}
        maxLength={20_000}
        defaultValue={draft.body}
        insertTokens={MESSAGE_TEMPLATE_VARIABLES.map((variable) => ({
          value: messageTemplateVariableLabel(variable),
          label: messageTemplateVariableLabel(variable),
        }))}
        insertTokensLabel="點選插入變數"
      />
      <div className="rounded-md border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <p className="font-semibold">可用變數</p>
        <p className="mt-1 break-words font-mono text-xs">
          {MESSAGE_TEMPLATE_VARIABLES.map(messageTemplateVariableLabel).join(" · ")}
        </p>
        <p className="mt-2 text-xs text-blue-700">Email 的報名成功、開播提醒與課後通知會自動附上退訂連結。LINE 的退訂變數會顯示封鎖操作說明網址，訊息末尾也會附上停止接收的方法。</p>
        <p className="mt-2 text-xs text-blue-700">LINE 同一觸發條件以最近儲存的模板為準，套用所有場次；停用它會停止該類通知。更改模板會停止已排入佇列的舊通知，不會補發。報名者須先完成驗證及 LINE 綁定，且商家已連接官方帳號；送達仍受排程與供應商狀態影響。SMS 尚未開放。</p>
        <p className="mt-2 text-xs text-blue-700">請先儲存 LINE 報名成功模板，再讓學員綁定；已處理的舊綁定不補發確認。更改渠道或觸發條件後，原條件會改用先前模板，或原本的預設通知。LINE 內容展開變數後最多五則，每則 5,000 字元；重複使用長網址變數時請縮短內容。</p>
        <p className="mt-2 text-xs text-blue-700">修改報名成功模板也會略過在這次儲存前已綁定、尚未處理的學員；請在招生前確認模板。</p>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
        <input name="isActive" type="checkbox" defaultChecked={draft.isActive} className="h-4 w-4 accent-blue-600" />
        啟用模板
      </label>
      <SubmitButton pendingChildren="儲存模板中…" pendingMessage="正在儲存訊息模板，請勿重複送出。" />
    </form>
  );
}
