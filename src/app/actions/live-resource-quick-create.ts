"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireVendorManager, requireVendorManagerContext } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { toSlug } from "@/lib/format";
import {
  isLiveQuickTemplateTrigger,
  LIVE_QUICK_FORM_LIMITS,
  LIVE_QUICK_TEMPLATE_LIMITS,
  liveQuickTemplateFieldErrors,
  type LiveQuickFormField,
  type LiveQuickFormResult,
  type LiveQuickTemplateResult,
} from "@/lib/live-resource-quick-create";
import {
  hasUsableMessageTemplateContent,
  initialMessageTemplateActionState,
  normalizeMessageTemplateDraft,
} from "@/lib/message-template";
import { saveMessageTemplate } from "@/lib/message-template-save";
import { defaultRegistrationFormBuilderFields, REGISTRATION_FORM_DEFAULT_COPY } from "@/lib/registration-form-builder";
import { saveRegistrationForm } from "@/lib/registration-form-save";

const SECURITY_EXPIRED = "安全驗證已失效，請重新整理頁面後再送出。";
/** The base address plus three random suffixes before giving up. */
const MAX_SLUG_ATTEMPTS = 4;
const SLUG_SUFFIX_LENGTH = 6;

/** One text value bounded to `maximum + 1`, so the validator still sees an over-long value. */
function boundedText(formData: FormData, key: string, maximum: number) {
  const values = formData.getAll(key);
  if (values.length !== 1 || typeof values[0] !== "string") return "";
  return values[0].slice(0, maximum + 1);
}

function randomSlugSuffix() {
  return randomBytes(8).toString("hex").slice(0, SLUG_SUFFIX_LENGTH);
}

/**
 * Registration form addresses are unique across every merchant. The quick
 * create derives one from the name and, when it is taken (or the name has no
 * usable characters), appends a random suffix instead of asking for another
 * address; the full editor keeps its own address field.
 */
function registrationFormSlugCandidate(name: string, attempt: number) {
  const base = toSlug(name).slice(0, 80 - SLUG_SUFFIX_LENGTH - 1);
  if (base && attempt === 0) return base;
  return `${base || "form"}-${randomSlugSuffix()}`;
}

function quickFormError(message: string, fieldErrors: Partial<Record<LiveQuickFormField, string>>): LiveQuickFormResult {
  return { status: "error", message, fieldErrors };
}

/**
 * 「就地建立報名表」 from the live studio: name and public headline only, with
 * the default name／Email／phone fields and default copy. Creates through the
 * same core as the form builder (vendor from the session, project bound in
 * the same transaction) and returns the studio's option instead of
 * redirecting.
 */
export async function createRegistrationFormQuickAction(formData: FormData): Promise<LiveQuickFormResult> {
  try {
    await assertServerActionSecurity(formData);
  } catch {
    return quickFormError(SECURITY_EXPIRED, { root: "本頁的安全驗證已過期。" });
  }

  const vendor = await requireVendorManager();
  const name = boundedText(formData, "name", LIVE_QUICK_FORM_LIMITS.name).trim();
  const headline = boundedText(formData, "headline", LIVE_QUICK_FORM_LIMITS.headline).trim();
  const projectValues = formData.getAll("projectId");
  if (projectValues.length > 1 || (projectValues[0] !== undefined && typeof projectValues[0] !== "string")) {
    return quickFormError("找不到目前商家可用的專案，未儲存本次變更。", { root: "請重新整理頁面後再建立。" });
  }
  const projectId = typeof projectValues[0] === "string" ? projectValues[0] : "";

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
    const data = new FormData();
    data.set("name", name);
    data.set("slug", registrationFormSlugCandidate(name, attempt));
    data.set("headline", headline);
    data.set("description", "");
    data.set("fields", JSON.stringify(defaultRegistrationFormBuilderFields()));
    data.set("submitLabel", REGISTRATION_FORM_DEFAULT_COPY.submitLabel);
    data.set("successMessage", REGISTRATION_FORM_DEFAULT_COPY.successMessage);
    data.set("maxVisibleSessions", "0");
    data.set("hideExpiredSessions", "on");
    data.set("isActive", "on");
    // Never trusted: the core binds it to this vendor inside the create transaction.
    if (projectId) data.set("projectId", projectId);

    const result = await saveRegistrationForm(vendor.id, data);
    if (result.ok) {
      // Same refresh as the form builder (project task counts).
      revalidatePath("/(app)", "layout");
      return { status: "success", option: { id: result.form.id, name: result.form.name } };
    }
    if (result.reason === "slug_taken") continue;

    const errors = result.state.fieldErrors ?? {};
    const fieldErrors: Partial<Record<LiveQuickFormField, string>> = {};
    if (errors.name) fieldErrors.name = errors.name;
    if (errors.headline) fieldErrors.headline = errors.headline;
    const other = errors.root ?? Object.entries(errors).find(([key]) => key !== "name" && key !== "headline")?.[1];
    if (other) fieldErrors.root = other;
    return quickFormError(result.state.message, fieldErrors);
  }

  return quickFormError("暫時無法產生可用的公開網址；請稍後再試，或改用完整編輯器建立。", { root: "公開網址產生失敗。" });
}

/**
 * 「就地建立 Email 模板」 from the live studio: only Email templates for the
 * three triggers the studio binds. The template must be sendable (subject,
 * body and only supported variables) before it is written; it is created
 * through the template editor's core (vendor from the session, audit log).
 */
export async function createMessageTemplateQuickAction(formData: FormData): Promise<LiveQuickTemplateResult> {
  try {
    await assertServerActionSecurity(formData);
  } catch {
    return { status: "error", message: SECURITY_EXPIRED, fieldErrors: { root: "本頁的安全驗證已過期。" } };
  }

  const { auth, vendor } = await requireVendorManagerContext();
  const trigger = boundedText(formData, "trigger", 64);
  if (!isLiveQuickTemplateTrigger(trigger)) {
    return {
      status: "error",
      message: "這裡只能建立報名成功、開播提醒或課後 Email 模板。",
      fieldErrors: { trigger: "不支援的模板用途。" },
    };
  }
  const draft = {
    name: boundedText(formData, "name", LIVE_QUICK_TEMPLATE_LIMITS.name),
    channel: "email",
    trigger,
    subject: boundedText(formData, "subject", LIVE_QUICK_TEMPLATE_LIMITS.subject),
    body: boundedText(formData, "body", LIVE_QUICK_TEMPLATE_LIMITS.body),
    isActive: true,
  };
  const fieldErrors = liveQuickTemplateFieldErrors(draft);
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: "有幾個欄位需要調整；內容仍保留在抽屜中。", fieldErrors };
  }
  const normalized = normalizeMessageTemplateDraft(draft);
  if (!normalized.success || !hasUsableMessageTemplateContent(normalized.data)) {
    return {
      status: "error",
      message: "模板內容無法寄送；請檢查主旨、內容與可用變數後再建立。",
      fieldErrors: { root: "模板內容無法寄送。" },
    };
  }

  const data = new FormData();
  data.set("name", draft.name);
  data.set("channel", "email");
  data.set("trigger", trigger);
  data.set("subject", draft.subject);
  data.set("body", draft.body);
  data.set("isActive", "on");
  const result = await saveMessageTemplate({
    vendorId: vendor.id,
    auditActor: { actorId: auth.user.id, actorLabel: auth.member?.role ?? "vendor_manager" },
    previousState: initialMessageTemplateActionState,
    formData: data,
  });
  if (!result.ok) {
    return {
      status: "error",
      message: "模板資料無效，內容仍保留在抽屜中。請檢查主旨、內容與可用變數後再建立。",
      fieldErrors: { root: "模板沒有建立。" },
    };
  }
  // No post-write usability check: the same content was already verified as
  // sendable before the write, and answering "error" here would leave an
  // orphan template behind while the drawer keeps asking to create it again.
  // No revalidation: the template editor does not refresh other pages either,
  // and the studio adds the returned option to its own list.
  return {
    status: "success",
    option: { id: result.template.id, name: result.template.name, channel: result.template.channel, trigger: result.template.trigger },
  };
}
