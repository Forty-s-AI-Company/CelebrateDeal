"use client";

import { ArrowDown, ArrowUp, LockKeyhole, Trash2 } from "lucide-react";
import {
  REGISTRATION_FORM_CORE_FIELD_KEYS,
  REGISTRATION_FORM_FIELD_TYPES,
  type RegistrationFormBuilderField,
  type RegistrationFormBuilderFieldType,
} from "@/lib/registration-form-builder";

const fieldTypeLabels: Record<RegistrationFormBuilderFieldType, string> = {
  text: "單行文字",
  email: "Email",
  tel: "電話",
  number: "數字",
  url: "網址",
};

export function registrationFormFieldTypeLabel(type: RegistrationFormBuilderFieldType) {
  return fieldTypeLabels[type];
}

export function FormFieldEditor({
  fields,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  fields: RegistrationFormBuilderField[];
  disabled: boolean;
  onChange: (index: number, field: RegistrationFormBuilderField) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="grid gap-3">
      {fields.map((field, index) => {
        const isCore = REGISTRATION_FORM_CORE_FIELD_KEYS.has(field.key);
        const labelId = `builder-field-${field.key}-label`;
        const helpId = `builder-field-${field.key}-help`;

        return (
          <section key={field.key} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby={`${labelId}-title`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id={`${labelId}-title`} className="font-semibold text-slate-900">
                  欄位 {index + 1}
                  {isCore ? (
                    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
                      <LockKeyhole size={12} aria-hidden="true" />核心欄位
                    </span>
                  ) : null}
                </h3>
                <p id={helpId} className="mt-1 text-xs text-slate-500 [overflow-wrap:anywhere]">
                  資料識別碼：<code>{field.key}</code>{isCore ? "（為確保名單可用，不能移除或改變類型）" : "（建立後保持穩定）"}
                </p>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={disabled || index === 0}
                  onClick={() => onMove(index, -1)}
                  aria-label={`將「${field.label}」上移`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowUp size={17} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  disabled={disabled || index === fields.length - 1}
                  onClick={() => onMove(index, 1)}
                  aria-label={`將「${field.label}」下移`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowDown size={17} aria-hidden="true" />
                </button>
                {!isCore ? (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onRemove(index)}
                    aria-label={`移除「${field.label}」`}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-red-200 text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem_auto] md:items-end">
              <label className="grid gap-1.5 text-sm font-medium text-slate-700" htmlFor={labelId}>
                顯示名稱
                <input
                  id={labelId}
                  required
                  maxLength={160}
                  value={field.label}
                  disabled={disabled}
                  aria-describedby={helpId}
                  onChange={(event) => onChange(index, { ...field, label: event.target.value })}
                  className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-slate-700">
                輸入類型
                <select
                  value={field.type}
                  disabled={disabled || isCore}
                  onChange={(event) => onChange(index, { ...field, type: event.target.value as RegistrationFormBuilderFieldType })}
                  className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                >
                  {REGISTRATION_FORM_FIELD_TYPES.map((type) => <option key={type} value={type}>{fieldTypeLabels[type]}</option>)}
                </select>
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={field.required}
                  disabled={disabled || isCore}
                  onChange={(event) => onChange(index, { ...field, required: event.target.checked })}
                  className="h-4 w-4 accent-blue-600"
                />
                必填
              </label>
            </div>
          </section>
        );
      })}
    </div>
  );
}
