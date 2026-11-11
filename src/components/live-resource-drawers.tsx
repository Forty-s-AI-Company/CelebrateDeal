"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";
import { createMessageTemplateQuickAction, createRegistrationFormQuickAction } from "@/app/actions/live-resource-quick-create";
import { RichTextEditor } from "@/components/rich-text-editor";
import { SideDrawer } from "@/components/side-drawer";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";
import {
  LIVE_QUICK_FORM_LIMITS,
  LIVE_QUICK_TEMPLATE_COPY,
  LIVE_QUICK_TEMPLATE_LIMITS,
  liveQuickTemplateFieldErrors,
  type LiveQuickFormField,
  type LiveQuickFormOption,
  type LiveQuickTemplateField,
  type LiveQuickTemplateOption,
  type LiveQuickTemplateTrigger,
} from "@/lib/live-resource-quick-create";
import { MESSAGE_TEMPLATE_VARIABLES, messageTemplateVariableLabel } from "@/lib/message-template";

const NETWORK_ERROR = "連線中斷，沒有建立任何資料；請稍後再試。";
const inputClass = "h-11 rounded-md border border-border-control bg-white px-3 text-sm font-normal text-slate-900 aria-[invalid=true]:border-red-600 disabled:bg-slate-100";
const primaryButtonClass = "inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-white hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClass = "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

type FieldErrors<Field extends string> = Partial<Record<Field, string>>;

/**
 * Focuses the first field with an error, in DOM order, once an error has
 * rendered and the fields are enabled again (they are disabled while saving).
 */
function useFocusFirstError(formRef: { current: HTMLFormElement | null }, errorVersion: number, pending: boolean) {
  const focusedVersionRef = useRef(0);
  useEffect(() => {
    if (pending || errorVersion === 0 || focusedVersionRef.current === errorVersion) return;
    focusedVersionRef.current = errorVersion;
    const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
      ?? formRef.current?.querySelector<HTMLElement>("[data-quick-create-error]");
    target?.focus();
  }, [formRef, errorVersion, pending]);
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? <span id={id} className="text-xs font-medium text-red-700">{message}</span> : null;
}

function RootError({ message, detail }: { message: string; detail?: string }) {
  if (!message) return null;
  return (
    <div data-quick-create-error="true" tabIndex={-1} role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      <p className="font-semibold">{message}</p>
      {detail ? <p className="mt-1">{detail}</p> : null}
    </div>
  );
}

function DrawerActions({ formId, pending, submitLabel, pendingLabel, onCancel }: { formId: string; pending: boolean; submitLabel: string; pendingLabel: string; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <button type="button" onClick={onCancel} disabled={pending} className={secondaryButtonClass}>取消</button>
      <button type="submit" form={formId} disabled={pending} aria-disabled={pending} className={primaryButtonClass}>
        {pending ? pendingLabel : submitLabel}
      </button>
    </div>
  );
}

/**
 * 「新增報名表」 inside the live studio: a name and a public headline; the
 * form gets the default name／Email／phone fields and default copy and is
 * active right away. On success the studio selects it; on error the drawer
 * stays open with the field messages.
 */
export function RegistrationFormQuickCreateDrawer({
  csrfToken,
  projectId,
  defaultTitle,
  onClose,
  onCreated,
}: {
  csrfToken: string;
  projectId?: string | null;
  defaultTitle: string;
  onClose: () => void;
  onCreated: (option: LiveQuickFormOption) => void;
}) {
  const formId = useId();
  const nameErrorId = useId();
  const headlineErrorId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FieldErrors<LiveQuickFormField>>({});
  const [errorVersion, setErrorVersion] = useState(0);
  useFocusFirstError(formRef, errorVersion, pending);
  const trimmedTitle = defaultTitle.trim();

  function fail(nextMessage: string, nextErrors: FieldErrors<LiveQuickFormField>) {
    setMessage(nextMessage);
    setErrors(nextErrors);
    setErrorVersion((version) => version + 1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const headline = String(data.get("headline") ?? "").trim();
    const localErrors: FieldErrors<LiveQuickFormField> = {};
    if (!name) localErrors.name = "請填寫表單名稱。";
    if (!headline) localErrors.headline = "請填寫公開標題。";
    if (Object.keys(localErrors).length > 0) {
      fail("有幾個欄位需要調整；內容仍保留在抽屜中。", localErrors);
      return;
    }
    startTransition(async () => {
      try {
        const result = await createRegistrationFormQuickAction(data);
        if (result.status === "success") onCreated(result.option);
        else fail(result.message, result.fieldErrors);
      } catch {
        fail(NETWORK_ERROR, {});
      }
    });
  }

  return (
    <SideDrawer
      title="新增報名表"
      description="建立後會自動選為這場直播的報名頁。表單含姓名、Email 與手機欄位，之後可在「報名表」頁調整欄位與版面。"
      busy={pending}
      onClose={onClose}
      initialFocusRef={nameRef}
      footer={<DrawerActions formId={formId} pending={pending} submitLabel="建立並選取" pendingLabel="建立中…" onCancel={onClose} />}
    >
      <form id={formId} ref={formRef} noValidate onSubmit={submit} aria-busy={pending} className="grid gap-4">
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
        <RootError message={message} detail={errors.root} />
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          表單名稱
          <input
            ref={nameRef}
            name="name"
            required
            maxLength={LIVE_QUICK_FORM_LIMITS.name}
            autoComplete="off"
            defaultValue={trimmedTitle ? `${trimmedTitle} 報名表` : ""}
            disabled={pending}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? nameErrorId : undefined}
            className={inputClass}
          />
          <span className="text-xs font-normal text-slate-500">只在後台顯示，用來辨識這張表單；公開網址會依名稱自動產生。</span>
          <FieldError id={nameErrorId} message={errors.name} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          公開標題
          <input
            name="headline"
            required
            maxLength={LIVE_QUICK_FORM_LIMITS.headline}
            autoComplete="off"
            defaultValue={trimmedTitle}
            disabled={pending}
            aria-invalid={errors.headline ? true : undefined}
            aria-describedby={errors.headline ? headlineErrorId : undefined}
            className={inputClass}
          />
          <span className="text-xs font-normal text-slate-500">報名者在報名頁最上方看到的標題。</span>
          <FieldError id={headlineErrorId} message={errors.headline} />
        </label>
      </form>
    </SideDrawer>
  );
}

/**
 * 「建立 Email 模板」 inside the live studio, for one of the three triggers
 * the studio binds (fixed by where it was opened). Starts from sendable
 * default copy; only the supported variables are accepted.
 */
export function MessageTemplateQuickCreateDrawer({
  csrfToken,
  trigger,
  onClose,
  onCreated,
}: {
  csrfToken: string;
  trigger: LiveQuickTemplateTrigger;
  onClose: () => void;
  onCreated: (option: LiveQuickTemplateOption) => void;
}) {
  const copy = LIVE_QUICK_TEMPLATE_COPY[trigger];
  const formId = useId();
  const nameErrorId = useId();
  const subjectErrorId = useId();
  const bodyErrorId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [body, setBody] = useState(copy.body);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FieldErrors<LiveQuickTemplateField>>({});
  const [errorVersion, setErrorVersion] = useState(0);
  useFocusFirstError(formRef, errorVersion, pending);

  function fail(nextMessage: string, nextErrors: FieldErrors<LiveQuickTemplateField>) {
    setMessage(nextMessage);
    setErrors(nextErrors);
    setErrorVersion((version) => version + 1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const localErrors = liveQuickTemplateFieldErrors({
      name: String(data.get("name") ?? ""),
      subject: String(data.get("subject") ?? ""),
      body: String(data.get("body") ?? ""),
    });
    if (Object.keys(localErrors).length > 0) {
      fail("有幾個欄位需要調整；內容仍保留在抽屜中。", localErrors);
      return;
    }
    startTransition(async () => {
      try {
        const result = await createMessageTemplateQuickAction(data);
        if (result.status === "success") onCreated(result.option);
        else fail(result.message, result.fieldErrors);
      } catch {
        fail(NETWORK_ERROR, {});
      }
    });
  }

  return (
    <SideDrawer
      title={`建立${copy.label}`}
      description="建立後立即啟用並可在這場直播選用；寄送時會自動附上退訂連結。"
      busy={pending}
      onClose={onClose}
      initialFocusRef={nameRef}
      footer={<DrawerActions formId={formId} pending={pending} submitLabel="建立並選取" pendingLabel="建立中…" onCancel={onClose} />}
    >
      <form id={formId} ref={formRef} noValidate onSubmit={submit} aria-busy={pending} className="grid gap-4">
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        <input type="hidden" name="trigger" value={trigger} />
        <RootError message={message} detail={errors.root ?? errors.trigger} />
        <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-700">
          用途：<strong className="font-semibold text-slate-900">{copy.label}</strong>（Email）
        </p>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          模板名稱
          <input
            ref={nameRef}
            name="name"
            required
            maxLength={LIVE_QUICK_TEMPLATE_LIMITS.name}
            autoComplete="off"
            defaultValue={copy.name}
            disabled={pending}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? nameErrorId : undefined}
            className={inputClass}
          />
          <FieldError id={nameErrorId} message={errors.name} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          Email 主旨
          <input
            name="subject"
            required
            maxLength={LIVE_QUICK_TEMPLATE_LIMITS.subject}
            autoComplete="off"
            defaultValue={copy.subject}
            disabled={pending}
            aria-invalid={errors.subject ? true : undefined}
            aria-describedby={errors.subject ? subjectErrorId : undefined}
            className={inputClass}
          />
          <FieldError id={subjectErrorId} message={errors.subject} />
        </label>
        <div className="grid gap-1.5">
          <RichTextEditor
            label="Email 內容"
            name="body"
            required
            rows={8}
            maxLength={LIVE_QUICK_TEMPLATE_LIMITS.body}
            value={body}
            onChange={setBody}
            disabled={pending}
            invalid={Boolean(errors.body)}
            errorId={errors.body ? bodyErrorId : undefined}
            insertTokens={MESSAGE_TEMPLATE_VARIABLES.map((variable) => ({
              value: messageTemplateVariableLabel(variable),
              label: messageTemplateVariableLabel(variable),
            }))}
            insertTokensLabel="點選插入變數"
          />
          <FieldError id={bodyErrorId} message={errors.body} />
        </div>
      </form>
    </SideDrawer>
  );
}
