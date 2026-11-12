"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition, type FormEvent, type RefObject } from "react";
import Link from "next/link";
import { createMessageTemplateQuickAction, createProductQuickAction, createRegistrationFormQuickAction, createUrlVideoQuickAction } from "@/app/actions/live-resource-quick-create";
import { MediaUploadField, type MediaUploadPhase } from "@/components/media-upload-field";
import { RichTextEditor } from "@/components/rich-text-editor";
import { SideDrawer } from "@/components/side-drawer";
import { CSRF_FIELD_NAME } from "@/lib/csrf-constants";
import { formatTwd } from "@/lib/format";
import {
  LIVE_QUICK_FORM_LIMITS,
  LIVE_QUICK_PRODUCT_FULFILLMENT_TYPES,
  LIVE_QUICK_PRODUCT_LIMITS,
  LIVE_QUICK_TEMPLATE_LIMITS,
  LIVE_QUICK_VIDEO_LIMITS,
  liveQuickTemplateCopy,
  liveQuickTemplateFieldErrors,
  liveQuickVideoFieldErrors,
  parseLiveQuickProductDraft,
  type LiveQuickFormField,
  type LiveQuickFormOption,
  type LiveQuickProductField,
  type LiveQuickProductOption,
  type LiveQuickTemplateField,
  type LiveQuickTemplateOption,
  type LiveQuickTemplateTrigger,
  type LiveQuickVideoField,
  type LiveQuickVideoOption,
} from "@/lib/live-resource-quick-create";
import type { LiveNotificationRuleTrigger } from "@/lib/live-notification-rules";
import { MESSAGE_TEMPLATE_VARIABLES, messageTemplateVariableLabel } from "@/lib/message-template";

/**
 * The action threw (network drop, timeout): the server may or may not have
 * created the resource, so this never promises that nothing was created.
 */
const NETWORK_ERROR = "連線中斷，無法確認是否已建立。請先關閉抽屜、重新整理頁面確認清單後再試，避免重複建立。";
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

/** A labelled text input whose hint and error are described by, not part of, its label. */
function DrawerTextField({
  label,
  name,
  maxLength,
  defaultValue,
  hint,
  error,
  disabled,
  inputRef,
  type = "text",
  placeholder,
}: {
  label: string;
  name: string;
  /** Omit for a pasted address: the browser would cut it silently; the validator reports it instead. */
  maxLength?: number;
  defaultValue: string;
  hint?: string;
  error?: string;
  disabled: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  /** "number" is a text field with the numeric keypad: no spinner, no wheel changes, no silent rounding. */
  type?: "text" | "url" | "number";
  placeholder?: string;
}) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-700">{label}</label>
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type={type === "url" ? "url" : "text"}
        inputMode={type === "url" ? "url" : type === "number" ? "numeric" : undefined}
        spellCheck={type === "text" ? undefined : false}
        placeholder={placeholder}
        required
        maxLength={maxLength}
        autoComplete="off"
        defaultValue={defaultValue}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass}
      />
      {hint ? <span id={hintId} className="text-xs text-slate-600">{hint}</span> : null}
      <FieldError id={errorId} message={error} />
    </div>
  );
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
  onInFlightChange,
}: {
  csrfToken: string;
  projectId?: string | null;
  defaultTitle: string;
  onClose: () => void;
  onCreated: (option: LiveQuickFormOption) => void;
  /** true when the create starts; false when it ends without `onCreated` (an error). */
  onInFlightChange?: (inFlight: boolean) => void;
}) {
  const formId = useId();
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
    onInFlightChange?.(true);
    startTransition(async () => {
      try {
        const result = await createRegistrationFormQuickAction(data);
        if (result.status === "success") {
          onCreated(result.option);
        } else {
          onInFlightChange?.(false);
          fail(result.message, result.fieldErrors);
        }
      } catch {
        onInFlightChange?.(false);
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
        <DrawerTextField
          label="表單名稱"
          name="name"
          maxLength={LIVE_QUICK_FORM_LIMITS.name}
          defaultValue={trimmedTitle ? `${trimmedTitle} 報名表` : ""}
          hint="只在後台顯示，用來辨識這張表單；公開網址會依名稱自動產生。"
          error={errors.name}
          disabled={pending}
          inputRef={nameRef}
        />
        <DrawerTextField
          label="公開標題"
          name="headline"
          maxLength={LIVE_QUICK_FORM_LIMITS.headline}
          defaultValue={trimmedTitle}
          hint="報名者在報名頁最上方看到的標題。"
          error={errors.headline}
          disabled={pending}
        />
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
  ruleTrigger,
  onClose,
  onCreated,
  onInFlightChange,
}: {
  csrfToken: string;
  trigger: LiveQuickTemplateTrigger;
  /** The rule group the drawer was opened from; 「直播中」 gets its own copy for the same trigger. */
  ruleTrigger?: LiveNotificationRuleTrigger;
  onClose: () => void;
  onCreated: (option: LiveQuickTemplateOption) => void;
  /** true when the create starts; false when it ends without `onCreated` (an error). */
  onInFlightChange?: (inFlight: boolean) => void;
}) {
  const copy = liveQuickTemplateCopy(trigger, ruleTrigger);
  const formId = useId();
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
    onInFlightChange?.(true);
    startTransition(async () => {
      try {
        const result = await createMessageTemplateQuickAction(data);
        if (result.status === "success") {
          onCreated(result.option);
        } else {
          onInFlightChange?.(false);
          fail(result.message, result.fieldErrors);
        }
      } catch {
        onInFlightChange?.(false);
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
        <DrawerTextField
          label="模板名稱"
          name="name"
          maxLength={LIVE_QUICK_TEMPLATE_LIMITS.name}
          defaultValue={copy.name}
          error={errors.name}
          disabled={pending}
          inputRef={nameRef}
        />
        <DrawerTextField
          label="Email 主旨"
          name="subject"
          maxLength={LIVE_QUICK_TEMPLATE_LIMITS.subject}
          defaultValue={copy.subject}
          error={errors.subject}
          disabled={pending}
        />
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

/**
 * 「新增商品」 inside the live studio's 成交 step: a listed physical product
 * from a name, a whole-dollar TWD price and stock; every other setting keeps
 * the product editor's default and can be filled in there later. Other types
 * need a post-purchase delivery setup, so they link to the full editor in a
 * new tab. On success the studio ticks the new product; on error the drawer
 * stays open with the field messages.
 */
export function ProductQuickCreateDrawer({
  csrfToken,
  projectId,
  onClose,
  onCreated,
  onInFlightChange,
}: {
  csrfToken: string;
  projectId?: string | null;
  onClose: () => void;
  onCreated: (option: LiveQuickProductOption) => void;
  /** true when the create starts; false when it ends without `onCreated` (an error). */
  onInFlightChange?: (inFlight: boolean) => void;
}) {
  const formId = useId();
  const typeLabelId = useId();
  const typeHintId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FieldErrors<LiveQuickProductField>>({});
  const [errorVersion, setErrorVersion] = useState(0);
  useFocusFirstError(formRef, errorVersion, pending);
  const fullEditorHref = projectId ? `/products/new?projectId=${encodeURIComponent(projectId)}` : "/products/new";

  function fail(nextMessage: string, nextErrors: FieldErrors<LiveQuickProductField>) {
    setMessage(nextMessage);
    setErrors(nextErrors);
    setErrorVersion((version) => version + 1);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const parsed = parseLiveQuickProductDraft({
      name: String(data.get("name") ?? ""),
      price: String(data.get("price") ?? ""),
      inventory: String(data.get("inventory") ?? ""),
      fulfillmentType: String(data.get("fulfillmentType") ?? ""),
    });
    if (!parsed.success) {
      fail("有幾個欄位需要調整；內容仍保留在抽屜中。", parsed.errors);
      return;
    }
    onInFlightChange?.(true);
    startTransition(async () => {
      try {
        const result = await createProductQuickAction(data);
        if (result.status === "success") {
          onCreated(result.option);
        } else {
          onInFlightChange?.(false);
          fail(result.message, result.fieldErrors);
        }
      } catch {
        onInFlightChange?.(false);
        fail(NETWORK_ERROR, {});
      }
    });
  }

  return (
    <SideDrawer
      title="新增商品"
      description="建立後立即上架，並自動勾選為這場直播的商品。圖片、描述與原價可以之後在「商品」頁補上。"
      busy={pending}
      onClose={onClose}
      initialFocusRef={nameRef}
      footer={<DrawerActions formId={formId} pending={pending} submitLabel="建立並選取" pendingLabel="建立中…" onCancel={onClose} />}
    >
      <form id={formId} ref={formRef} noValidate onSubmit={submit} aria-busy={pending} className="grid gap-4">
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
        <RootError message={message} detail={errors.root ?? errors.fulfillmentType} />
        <DrawerTextField
          label="商品名稱"
          name="name"
          maxLength={LIVE_QUICK_PRODUCT_LIMITS.name}
          defaultValue=""
          hint="買家在直播間與結帳頁看到的名稱；商品網址會依名稱自動產生。"
          error={errors.name}
          disabled={pending}
          inputRef={nameRef}
        />
        <DrawerTextField
          label="售價（新台幣整數元）"
          name="price"
          type="number"
          placeholder="例如 1290"
          defaultValue=""
          hint={`平台結帳只收新台幣，請填整數元，不含小數點與逗號；上限 ${formatTwd(LIVE_QUICK_PRODUCT_LIMITS.priceMax * 100)}。`}
          error={errors.price}
          disabled={pending}
        />
        <DrawerTextField
          label="可售庫存"
          name="inventory"
          type="number"
          placeholder="例如 50"
          defaultValue=""
          hint="買家結帳時扣除；庫存用完後無法再結帳。"
          error={errors.inventory}
          disabled={pending}
        />
        <div role="group" aria-labelledby={typeLabelId} aria-describedby={typeHintId} className="grid gap-1.5">
          <span id={typeLabelId} className="text-sm font-medium text-slate-700">商品類型</span>
          <input type="hidden" name="fulfillmentType" value={LIVE_QUICK_PRODUCT_FULFILLMENT_TYPES[0]} />
          <p className="rounded-md border border-border bg-slate-50 px-3 py-2 text-sm text-slate-900">
            <strong className="font-semibold">實體商品</strong>：買家結帳時填寫收件地址，由你出貨。
          </p>
          <p id={typeHintId} className="text-xs leading-5 text-slate-600">
            數位內容、服務與課程需要付款後的交付設定，請到完整商品頁的
            <Link href={fullEditorHref} target="_blank" rel="noopener" className="mx-0.5 font-semibold text-primary underline">
              更多設定<span className="sr-only">（另開新分頁）</span>
            </Link>
            建立。
          </p>
        </div>
      </form>
    </SideDrawer>
  );
}

const BUSY_UPLOAD_PHASES: ReadonlySet<MediaUploadPhase> = new Set(["provisioning", "uploading", "finalizing"]);

/**
 * 「上傳影片或貼上影片網址」 inside the live studio. The upload reuses the video
 * editor's field and routes: the provider row is created when the upload is
 * signed, so nothing else needs saving, and the studio waits for Cloudflare
 * to finish processing (`onUploaded`). While a file is being sent the drawer
 * cannot close; 「暫停上傳」 stops it first. An external URL is created at
 * once (`onUrlCreated`).
 */
export function VideoQuickCreateDrawer({
  csrfToken,
  defaultTitle,
  onClose,
  onUploaded,
  onUrlCreated,
  onInFlightChange,
}: {
  csrfToken: string;
  defaultTitle: string;
  onClose: () => void;
  /** The file reached Cloudflare; the row is still processing and not yet selectable. */
  onUploaded: (video: LiveQuickVideoOption) => void;
  onUrlCreated: (video: LiveQuickVideoOption, ready: boolean) => void;
  /** true when an upload or a create starts; false when it ends without a result (an error or a pause). */
  onInFlightChange?: (inFlight: boolean) => void;
}) {
  const formId = useId();
  const urlHintId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const urlSectionRef = useRef<HTMLDetailsElement>(null);
  const [creatingUrl, startTransition] = useTransition();
  const [uploadPhase, setUploadPhase] = useState<MediaUploadPhase>("idle");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<FieldErrors<LiveQuickVideoField>>({});
  const [errorVersion, setErrorVersion] = useState(0);
  const inFlightRef = useRef(false);
  const uploading = BUSY_UPLOAD_PHASES.has(uploadPhase);
  const busy = uploading || creatingUrl;
  useFocusFirstError(formRef, errorVersion, busy);
  // Leaving the page while the file is being sent would cut the upload off:
  // ask the browser to confirm. Removed when the upload ends, is paused or
  // fails, and when the drawer unmounts.
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);
  const callbacksRef = useRef({ onUploaded, onInFlightChange });
  useEffect(() => { callbacksRef.current = { onUploaded, onInFlightChange }; });

  function setInFlight(next: boolean) {
    if (inFlightRef.current === next) return;
    inFlightRef.current = next;
    callbacksRef.current.onInFlightChange?.(next);
  }

  function fail(nextMessage: string, nextErrors: FieldErrors<LiveQuickVideoField>) {
    setMessage(nextMessage);
    setErrors(nextErrors);
    setErrorVersion((version) => version + 1);
  }

  const handleUploadPhase = useCallback((phase: MediaUploadPhase, resourceId: string) => {
    setUploadPhase(phase);
    if (BUSY_UPLOAD_PHASES.has(phase)) {
      if (!inFlightRef.current) {
        inFlightRef.current = true;
        callbacksRef.current.onInFlightChange?.(true);
      }
      return;
    }
    if (phase === "success" && resourceId) {
      // The title field is locked while the file is sent, so it is the title the row was created with.
      const title = titleRef.current?.value.trim() || "未命名影片";
      callbacksRef.current.onUploaded({ id: resourceId, title });
      return;
    }
    if (inFlightRef.current) {
      inFlightRef.current = false;
      callbacksRef.current.onInFlightChange?.(false);
    }
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Enter in the title field while the URL section is closed starts nothing; the upload has its own button.
    if (busy || !urlSectionRef.current?.open) return;
    const data = new FormData(event.currentTarget);
    const localErrors = liveQuickVideoFieldErrors({
      title: String(data.get("title") ?? ""),
      videoUrl: String(data.get("videoUrl") ?? ""),
    });
    if (Object.keys(localErrors).length > 0) {
      fail("有幾個欄位需要調整；內容仍保留在抽屜中。", localErrors);
      return;
    }
    setInFlight(true);
    startTransition(async () => {
      try {
        const result = await createUrlVideoQuickAction(data);
        if (result.status === "success") {
          onUrlCreated(result.option, result.ready);
        } else {
          setInFlight(false);
          fail(result.message, result.fieldErrors);
        }
      } catch {
        setInFlight(false);
        fail(NETWORK_ERROR, {});
      }
    });
  }

  return (
    <SideDrawer
      title="新增影片"
      description="上傳影片檔，或貼上已放在其他平台的影片網址。上傳的影片要等轉檔完成才能播放，完成後會自動選為這場直播的影片。"
      busy={busy}
      onClose={onClose}
      initialFocusRef={titleRef}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          {uploading ? <p className="mr-auto text-xs text-slate-600">上傳中無法關閉；需要離開請先按「暫停上傳」。</p> : null}
          <button type="button" onClick={onClose} disabled={busy} className={secondaryButtonClass}>取消</button>
        </div>
      )}
    >
      <form id={formId} ref={formRef} noValidate onSubmit={submit} aria-busy={busy} className="grid gap-4">
        <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
        {/* Read and filled by the upload field: the length bounds the Cloudflare upload. */}
        <input type="hidden" name="durationSec" defaultValue="0" />
        <input type="hidden" name="estimatedMinutes" defaultValue="0" />
        <RootError message={message} detail={errors.root} />
        <DrawerTextField
          label="影片名稱"
          name="title"
          maxLength={LIVE_QUICK_VIDEO_LIMITS.title}
          defaultValue={defaultTitle.trim().slice(0, LIVE_QUICK_VIDEO_LIMITS.title)}
          hint="在後台與影片選單中顯示的名稱。"
          error={errors.title}
          disabled={busy}
          inputRef={titleRef}
        />
        <MediaUploadField
          kind="video"
          label="上傳影片檔"
          description="檔案會直接送往 Cloudflare Stream。上傳完成後通常要幾分鐘轉檔；轉檔期間可以先繼續設定其他步驟。"
          titleInputName="title"
          durationInputName="durationSec"
          estimatedMinutesInputName="estimatedMinutes"
          allowFrameCapture={false}
          successMessage="檔案已送達 Cloudflare Stream，正在轉檔。"
          onPhaseChange={handleUploadPhase}
        />
        <details ref={urlSectionRef} className="rounded-lg border border-border bg-white p-3">
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">改用外部影片網址</summary>
          <div className="mt-3 grid gap-3">
            <p id={urlHintId} className="text-xs leading-5 text-slate-600">適合已放在 CDN 或其他影片平台、可直接播放的網址；建立後立即可選用。</p>
            <DrawerTextField
              label="影片網址"
              name="videoUrl"
              type="url"
              placeholder="https://..."
              defaultValue=""
              error={errors.videoUrl}
              disabled={busy}
            />
            <div className="flex justify-end">
              <button type="submit" disabled={busy} aria-describedby={urlHintId} className={primaryButtonClass}>
                {creatingUrl ? "建立中…" : "以網址建立並選取"}
              </button>
            </div>
          </div>
        </details>
      </form>
    </SideDrawer>
  );
}
