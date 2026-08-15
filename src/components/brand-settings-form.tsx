"use client";

import { useActionState, useState, type ChangeEvent, type ReactNode } from "react";
import { saveBrandSettingsActionState, type BrandSettingsActionState, type BrandSettingsFormValues } from "@/app/actions";
import { FormSubmitButton } from "@/components/form-submit-button";

const inputClassName = "h-11 rounded-md border border-border bg-white px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-blue-100";

export function BrandSettingsForm({
  initialValues,
  csrfField,
}: {
  initialValues: BrandSettingsFormValues;
  csrfField: ReactNode;
}) {
  const initialState: BrandSettingsActionState = {
    status: "idle",
    message: "",
    values: initialValues,
  };
  const [state, formAction, pending] = useActionState(saveBrandSettingsActionState, initialState);
  const [editedValues, setEditedValues] = useState<Partial<BrandSettingsFormValues>>({});
  // The Server Action state is the authoritative base after a round trip;
  // local edits overlay only the field currently being changed, so every input
  // remains controlled without an effect-driven cascading render.
  const values = { ...state.values, ...editedValues };

  function updateValue(key: keyof BrandSettingsFormValues) {
    return (event: ChangeEvent<HTMLInputElement>) => {
      setEditedValues((current) => ({ ...current, [key]: event.target.value }));
    };
  }

  return (
    <form action={formAction} aria-busy={pending} className="grid gap-4">
      {csrfField}
      {state.status === "error" ? (
        <p role="alert" aria-live="assertive" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          品牌名稱
          <input name="name" required value={values.name} onChange={updateValue("name")} className={inputClassName} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          品牌 Slug
          <input name="slug" required value={values.slug} onChange={updateValue("slug")} className={inputClassName} />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          主要色
          <input name="primaryColor" type="color" value={values.primaryColor} onChange={updateValue("primaryColor")} className="h-11 w-full rounded-md border border-border bg-white p-1" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          CTA 色
          <input name="ctaColor" type="color" value={values.ctaColor} onChange={updateValue("ctaColor")} className="h-11 w-full rounded-md border border-border bg-white p-1" />
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          時區
          <input name="timezone" required value={values.timezone} onChange={updateValue("timezone")} className={inputClassName} />
          <span className="text-xs font-normal text-slate-500">請使用 IANA 時區，例如 Asia/Taipei。</span>
        </label>
        <label className="grid gap-1.5 text-sm font-medium text-slate-700">
          客服 Email
          <input name="supportEmail" type="email" value={values.supportEmail} onChange={updateValue("supportEmail")} className={inputClassName} />
        </label>
      </div>

      <label className="grid gap-1.5 text-sm font-medium text-slate-700">
        Logo URL
        <input name="logoUrl" type="url" value={values.logoUrl} onChange={updateValue("logoUrl")} placeholder="https://..." className={inputClassName} />
        <span className="text-xs font-normal text-slate-500">目前保留 URL 設定；圖片上傳元件會在媒體資產流程接入。</span>
      </label>

      <div className="flex justify-end">
        <FormSubmitButton pendingChildren="儲存中…" pendingMessage="正在儲存品牌設定，請勿重複送出。">
          儲存品牌設定
        </FormSubmitButton>
      </div>
    </form>
  );
}
