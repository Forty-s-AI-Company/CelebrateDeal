/**
 * F-3 Email 追銷序列: limits, form parsing and shared types. Pure and
 * client-safe; the database work lives in src/lib/email-sequences.ts and
 * src/lib/delayed-step-runs.ts.
 */

/** Server-enforced limits (docs/product/delayed-steps-design.md §4「權限、開關與上限」). */
export const MAX_ACTIVE_EMAIL_SEQUENCES_PER_VENDOR = 5;
export const MAX_EMAIL_SEQUENCE_STEPS = 10;
/** 1 hour: the job runs at most every few minutes, so finer delays would be a false promise (§3「時間精度」). */
export const SEQUENCE_STEP_MIN_DELAY_MINUTES = 60;
/** 90 days. Mirrors the CHECK `EmailSequenceStep_delayMinutes_check`. */
export const SEQUENCE_STEP_MAX_DELAY_MINUTES = 129_600;
export const EMAIL_SEQUENCE_NAME_MAX_LENGTH = 120;

export const EMAIL_SEQUENCE_STATUSES = ["draft", "active", "paused"] as const;
export type EmailSequenceStatus = (typeof EMAIL_SEQUENCE_STATUSES)[number];

export const SEQUENCE_DELAY_UNITS = ["hours", "days"] as const;
export type SequenceDelayUnit = (typeof SEQUENCE_DELAY_UNITS)[number];

const MINUTES_PER_UNIT: Record<SequenceDelayUnit, number> = { hours: 60, days: 1_440 };

export const EMAIL_SEQUENCE_STATUS_LABELS: Record<EmailSequenceStatus, string> = {
  draft: "草稿",
  active: "寄送中",
  paused: "已暫停",
};

export type EmailSequenceStepDraft = {
  /** Existing step id; empty for a new step. */
  id: string;
  delayValue: string;
  delayUnit: SequenceDelayUnit;
  messageTemplateId: string;
  isActive: boolean;
};

export type EmailSequenceFormDraft = {
  name: string;
  liveId: string;
  steps: EmailSequenceStepDraft[];
};

export type EmailSequenceStepInput = {
  id: string | null;
  delayMinutes: number;
  messageTemplateId: string;
  isActive: boolean;
};

export type EmailSequenceInput = {
  name: string;
  liveId: string;
  steps: EmailSequenceStepInput[];
};

export type EmailSequenceFieldErrors = Record<string, string>;

export type EmailSequenceActionState = {
  status: "idle" | "error";
  message: string | null;
  fieldErrors: EmailSequenceFieldErrors;
  draft: EmailSequenceFormDraft | null;
  /** The version the next save must match (optimistic lock); null for a new sequence. */
  expectedVersion: number | null;
  /** Bumped on every error so the form re-mounts with the returned draft. */
  errorVersion: number;
};

export const initialEmailSequenceActionState: EmailSequenceActionState = {
  status: "idle",
  message: null,
  fieldErrors: {},
  draft: null,
  expectedVersion: null,
  errorVersion: 0,
};

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,191}$/u;

export function stepFieldName(index: number, field: "delayValue" | "delayUnit" | "messageTemplateId" | "isActive" | "id") {
  return `steps.${index}.${field}`;
}

/** Splits stored minutes into the unit the form shows: whole days when possible, otherwise hours. */
export function delayMinutesToDraft(minutes: number): Pick<EmailSequenceStepDraft, "delayValue" | "delayUnit"> {
  if (minutes % MINUTES_PER_UNIT.days === 0) return { delayValue: String(minutes / MINUTES_PER_UNIT.days), delayUnit: "days" };
  return { delayValue: String(Math.round(minutes / MINUTES_PER_UNIT.hours)), delayUnit: "hours" };
}

export function describeDelay(minutes: number) {
  const { delayValue, delayUnit } = delayMinutesToDraft(minutes);
  return delayUnit === "days" ? `驗證後第 ${delayValue} 天` : `驗證後 ${delayValue} 小時`;
}

function readText(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Reads the raw form back into a draft (also used to refill the form after an error). */
export function readEmailSequenceDraft(formData: FormData): EmailSequenceFormDraft {
  const countText = readText(formData, "stepCount");
  const count = /^\d{1,2}$/u.test(countText) ? Math.min(Number(countText), MAX_EMAIL_SEQUENCE_STEPS + 1) : 0;
  const steps: EmailSequenceStepDraft[] = [];
  for (let index = 0; index < count; index += 1) {
    const unit = readText(formData, stepFieldName(index, "delayUnit"));
    steps.push({
      id: readText(formData, stepFieldName(index, "id")).trim(),
      delayValue: readText(formData, stepFieldName(index, "delayValue")).trim(),
      delayUnit: (SEQUENCE_DELAY_UNITS as readonly string[]).includes(unit) ? unit as SequenceDelayUnit : "days",
      messageTemplateId: readText(formData, stepFieldName(index, "messageTemplateId")).trim(),
      isActive: formData.get(stepFieldName(index, "isActive")) === "on",
    });
  }
  return {
    name: readText(formData, "name").replace(/\s+/gu, " ").trim(),
    liveId: readText(formData, "liveId").trim(),
    steps,
  };
}

export type EmailSequenceParseResult =
  | { ok: true; data: EmailSequenceInput }
  | { ok: false; message: string; fieldErrors: EmailSequenceFieldErrors };

/**
 * Validates the shape and the limits that do not need the database. Whether
 * the Live and templates belong to the vendor is checked in the save
 * transaction, against the current vendor only.
 */
export function parseEmailSequenceDraft(draft: EmailSequenceFormDraft, rawStepCount: number = draft.steps.length): EmailSequenceParseResult {
  const fieldErrors: EmailSequenceFieldErrors = {};
  if (!draft.name) fieldErrors.name = "請輸入序列名稱。";
  else if (draft.name.length > EMAIL_SEQUENCE_NAME_MAX_LENGTH) fieldErrors.name = `序列名稱最多 ${EMAIL_SEQUENCE_NAME_MAX_LENGTH} 字。`;
  if (!draft.liveId) fieldErrors.liveId = "請選擇這條序列要跟的直播。";
  else if (!ID_PATTERN.test(draft.liveId)) fieldErrors.liveId = "找不到這場直播，請重新選擇。";

  if (rawStepCount > MAX_EMAIL_SEQUENCE_STEPS) {
    return { ok: false, message: `一條序列最多 ${MAX_EMAIL_SEQUENCE_STEPS} 封信。`, fieldErrors };
  }

  const steps: EmailSequenceStepInput[] = [];
  const seenDelays = new Map<number, number>();
  draft.steps.forEach((step, index) => {
    if (step.id && !ID_PATTERN.test(step.id)) {
      fieldErrors[stepFieldName(index, "delayValue")] = "這一步的資料已失效，請重新整理頁面。";
      return;
    }
    const delayField = stepFieldName(index, "delayValue");
    const value = /^\d{1,6}$/u.test(step.delayValue) ? Number(step.delayValue) : Number.NaN;
    const minutes = value * MINUTES_PER_UNIT[step.delayUnit];
    if (!Number.isSafeInteger(value) || value < 1) {
      fieldErrors[delayField] = "請輸入大於 0 的整數。";
    } else if (minutes < SEQUENCE_STEP_MIN_DELAY_MINUTES || minutes > SEQUENCE_STEP_MAX_DELAY_MINUTES) {
      fieldErrors[delayField] = "寄送時間要在驗證後 1 小時到 90 天之間。";
    } else if (seenDelays.has(minutes)) {
      fieldErrors[delayField] = `和第 ${(seenDelays.get(minutes) ?? 0) + 1} 封的寄送時間相同，請調整其中一封。`;
    } else {
      seenDelays.set(minutes, index);
    }
    if (!step.messageTemplateId) fieldErrors[stepFieldName(index, "messageTemplateId")] = "請選擇這一封要用的信件模板。";
    else if (!ID_PATTERN.test(step.messageTemplateId)) fieldErrors[stepFieldName(index, "messageTemplateId")] = "找不到這個模板，請重新選擇。";
    steps.push({ id: step.id || null, delayMinutes: minutes, messageTemplateId: step.messageTemplateId, isActive: step.isActive });
  });
  const stepIds = steps.map((step) => step.id).filter(Boolean);
  if (new Set(stepIds).size !== stepIds.length) return { ok: false, message: "步驟資料重複，請重新整理頁面後再儲存。", fieldErrors };

  if (Object.keys(fieldErrors).length > 0) return { ok: false, message: "有幾個欄位需要修正，內容已保留。", fieldErrors };
  // Kept in form order so server-side field errors point at the same rows.
  return { ok: true, data: { name: draft.name, liveId: draft.liveId, steps } };
}
