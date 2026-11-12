"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { saveEmailSequenceAction } from "@/app/actions/email-sequence-actions";
import { Field, FormErrorSummary, SelectField, SubmitButton, focusFirstInvalidField } from "@/components/ui";
import {
  initialEmailSequenceActionState,
  MAX_EMAIL_SEQUENCE_STEPS,
  stepFieldName,
  type EmailSequenceFormDraft,
  type EmailSequenceStepDraft,
} from "@/lib/email-sequence-rules";

export type EmailSequenceFormLive = { id: string; title: string; startLabel: string };
export type EmailSequenceFormTemplate = { id: string; name: string; usable: boolean };
export type EmailSequenceFormSequence = {
  id: string;
  version: number;
  status: string;
  /** Activated at least once: the Live can no longer change. */
  locked: boolean;
};

const subscribeNever = () => () => {};

/**
 * Controls stay disabled until React has hydrated: a click before that would
 * submit the server-rendered step list (or drop the click) instead of what the
 * merchant sees, which made earlier forms flaky in CI.
 */
function useHydrated() {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}

type StepRow = EmailSequenceStepDraft & { key: string };

let rowSequence = 0;
function toRows(steps: EmailSequenceStepDraft[]): StepRow[] {
  return steps.map((step) => ({ ...step, key: `row-${(rowSequence += 1)}` }));
}

function emptyStep(previous: StepRow | undefined): EmailSequenceStepDraft {
  const nextDay = previous?.delayUnit === "days" && /^\d+$/u.test(previous.delayValue) ? String(Number(previous.delayValue) + 2) : "1";
  return { id: "", delayValue: nextDay, delayUnit: "days", messageTemplateId: "", isActive: true };
}

function StepActiveCheckbox({ name, defaultChecked, disabled }: { name: string; defaultChecked: boolean; disabled: boolean }) {
  return (
    <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} disabled={disabled} className="h-4 w-4 accent-blue-600" />
      寄送這一封
    </label>
  );
}

function StepsError({ error }: { error?: string }) {
  return error ? <p className="text-sm font-medium text-red-700">{error}</p> : null;
}

function StepFields({
  index,
  row,
  templates,
  errors,
  disabled,
  canRemove,
  onRemove,
}: {
  index: number;
  row: StepRow;
  templates: EmailSequenceFormTemplate[];
  errors: Record<string, string>;
  disabled: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const selected = templates.find((template) => template.id === row.messageTemplateId);
  return (
    <fieldset className="grid gap-3 rounded-lg border border-border p-4" data-sequence-step={index}>
      <legend className="px-1 text-sm font-semibold text-slate-900">第 {index + 1} 封</legend>
      <input type="hidden" name={stepFieldName(index, "id")} value={row.id} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
        <Field
          label="驗證後多久寄出"
          name={stepFieldName(index, "delayValue")}
          type="number"
          min={1}
          max={2_160}
          step={1}
          required
          readOnly={disabled}
          defaultValue={row.delayValue}
          error={errors[stepFieldName(index, "delayValue")]}
          hint="從報名者完成 Email 驗證的時間起算，最短 1 小時、最長 90 天。"
        />
        <SelectField label="單位" name={stepFieldName(index, "delayUnit")} defaultValue={row.delayUnit} error={errors[stepFieldName(index, "delayUnit")]}>
          <option value="hours">小時</option>
          <option value="days">天</option>
        </SelectField>
      </div>
      <SelectField
        label="信件模板"
        name={stepFieldName(index, "messageTemplateId")}
        defaultValue={row.messageTemplateId}
        error={errors[stepFieldName(index, "messageTemplateId")]}
      >
        <option value="">請選擇模板</option>
        {templates.map((template) => (
          <option key={template.id} value={template.id}>{template.usable ? template.name : `${template.name}（已停用）`}</option>
        ))}
        {row.messageTemplateId && !selected ? <option value={row.messageTemplateId}>（找不到這個模板）</option> : null}
      </SelectField>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StepActiveCheckbox name={stepFieldName(index, "isActive")} defaultChecked={row.isActive} disabled={disabled} />
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="inline-flex min-h-11 items-center rounded-md border border-border bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            移除第 {index + 1} 封
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}

function SequenceFields({
  draft,
  lives,
  templates,
  errors,
  locked,
  disabled,
}: {
  draft: EmailSequenceFormDraft;
  lives: EmailSequenceFormLive[];
  templates: EmailSequenceFormTemplate[];
  errors: Record<string, string>;
  locked: boolean;
  disabled: boolean;
}) {
  const [rows, setRows] = useState<StepRow[]>(() => toRows(draft.steps.length > 0 ? draft.steps : [emptyStep(undefined)]));
  const liveField = (
    <SelectField
      label="跟著哪一場直播"
      name={locked ? "liveIdLocked" : "liveId"}
      defaultValue={draft.liveId}
      error={errors.liveId}
      hint={locked ? "啟用過的序列不能換直播；要換請另外建立一條。" : "這場直播完成 Email 驗證的報名者，會從序列啟用之後開始收信。"}
    >
      <option value="">請選擇直播</option>
      {lives.map((live) => <option key={live.id} value={live.id}>{live.title}（{live.startLabel}）</option>)}
    </SelectField>
  );
  return (
    <>
      <Field label="序列名稱" name="name" required maxLength={120} readOnly={disabled} defaultValue={draft.name} error={errors.name} hint="只有你看得到，例如「報名後三天追銷」。" />
      {locked ? (
        <>
          <input type="hidden" name="liveId" value={draft.liveId} />
          <fieldset disabled className="contents">{liveField}</fieldset>
        </>
      ) : liveField}
      <input type="hidden" name="stepCount" value={rows.length} />
      <div className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-900">要寄的信</h2>
            <p className="text-sm text-slate-600">每一封都從驗證時間起算；同一條序列的時間不能重複。最多 {MAX_EMAIL_SEQUENCE_STEPS} 封。</p>
          </div>
        </div>
        <StepsError error={errors.steps} />
        {rows.map((row, index) => (
          <StepFields
            key={row.key}
            index={index}
            row={row}
            templates={templates}
            errors={errors}
            disabled={disabled}
            canRemove={rows.length > 1}
            onRemove={() => setRows((current) => current.filter((item) => item.key !== row.key))}
          />
        ))}
        <div>
          <button
            type="button"
            onClick={() => setRows((current) => [...current, ...toRows([emptyStep(current.at(-1))])])}
            disabled={disabled || rows.length >= MAX_EMAIL_SEQUENCE_STEPS}
            className="inline-flex min-h-11 items-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            新增一封
          </button>
        </div>
      </div>
    </>
  );
}

export function EmailSequenceFormClient({
  csrfField,
  lives,
  templates,
  sequence,
  initialDraft,
}: {
  csrfField: ReactNode;
  lives: EmailSequenceFormLive[];
  templates: EmailSequenceFormTemplate[];
  sequence?: EmailSequenceFormSequence;
  initialDraft: EmailSequenceFormDraft;
}) {
  const [state, formAction, pending] = useActionState(saveEmailSequenceAction, {
    ...initialEmailSequenceActionState,
    expectedVersion: sequence?.version ?? null,
  });
  const hydrated = useHydrated();
  const formRef = useRef<HTMLFormElement>(null);
  const disabled = pending || !hydrated;
  const draft = state.draft ?? initialDraft;

  useEffect(() => {
    if (state.errorVersion > 0 && !pending) focusFirstInvalidField(formRef.current);
  }, [state.errorVersion, pending]);

  return (
    <form ref={formRef} action={formAction} aria-busy={pending} className="grid gap-5">
      {csrfField}
      {sequence ? (
        <>
          <input type="hidden" name="sequenceId" value={sequence.id} />
          <input type="hidden" name="expectedVersion" value={state.expectedVersion ?? sequence.version} />
        </>
      ) : null}
      <FormErrorSummary message={state.message} errors={state.fieldErrors} />
      {templates.length === 0 ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          還沒有「追銷序列信」模板。先到<Link href="/messages/templates/new" className="mx-1 font-semibold underline underline-offset-2">新增訊息模板</Link>，觸發條件選「追銷序列信」，再回來排進序列。
        </p>
      ) : null}
      <SequenceFields
        key={state.errorVersion}
        draft={draft}
        lives={lives}
        templates={templates}
        errors={state.fieldErrors}
        locked={sequence?.locked ?? false}
        disabled={disabled}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton disabled={!hydrated} pendingChildren="儲存中…" pendingMessage="正在儲存追銷序列，請勿重複送出。">
          儲存序列
        </SubmitButton>
        <Link href="/messages/sequences" className="inline-flex min-h-11 items-center rounded-md border border-border bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
          返回列表
        </Link>
        {!hydrated ? <span className="text-sm text-slate-500">頁面載入完成後才能儲存。</span> : null}
      </div>
    </form>
  );
}
