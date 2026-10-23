"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import {
  isValidCitizenDigitalCertificate,
  isValidDonationCode,
  isValidMobileBarcode,
  isValidTaiwanBusinessId,
} from "@/lib/taiwan-invoice-validator";

export type CheckoutInvoiceFieldsValue = {
  type: "personal" | "company" | "donation";
  carrier?: "member" | "mobile" | "citizen_certificate";
  carrierNumber?: string;
  businessId?: string;
  companyName?: string;
  donationCode?: string;
};

type InvoiceCarrier = NonNullable<CheckoutInvoiceFieldsValue["carrier"]>;
type InvoiceInputName = "invoiceCarrierNumber" | "invoiceBusinessId" | "invoiceCompanyName" | "invoiceDonationCode";
type InvoiceInputErrors = Partial<Record<InvoiceInputName, string>>;

const inputClass = "mt-1 w-full rounded-lg border border-slate-500 bg-white px-3 py-2.5 text-base text-slate-950 focus:border-blue-500";
const errorId = "invoice-field-error";

/** 目前所選發票類型／載具實際需要填寫的欄位，依畫面順序排列。 */
function invoiceInputNames(type: CheckoutInvoiceFieldsValue["type"], carrier: InvoiceCarrier): InvoiceInputName[] {
  if (type === "company") return ["invoiceBusinessId", "invoiceCompanyName"];
  if (type === "donation") return ["invoiceDonationCode"];
  return carrier === "member" ? [] : ["invoiceCarrierNumber"];
}

/** 單一欄位的格式檢查；訊息與 `invoiceFieldError` 相同。 */
function invoiceInputError(name: InvoiceInputName, value: string, carrier: InvoiceCarrier): string | null {
  if (name === "invoiceBusinessId") return isValidTaiwanBusinessId(value) ? null : "請輸入有效的 8 碼統一編號。";
  if (name === "invoiceCompanyName") return value.trim() ? null : "請填寫發票抬頭。";
  if (name === "invoiceDonationCode") return isValidDonationCode(value) ? null : "愛心捐贈碼須為 3 至 7 碼數字。";
  if (carrier === "mobile") return isValidMobileBarcode(value) ? null : "手機條碼格式不正確。";
  if (carrier === "citizen_certificate") return isValidCitizenDigitalCertificate(value) ? null : "自然人憑證載具格式不正確。";
  return null;
}

function invoiceInputValue(value: CheckoutInvoiceFieldsValue, name: InvoiceInputName) {
  if (name === "invoiceBusinessId") return value.businessId ?? "";
  if (name === "invoiceCompanyName") return value.companyName ?? "";
  if (name === "invoiceDonationCode") return value.donationCode ?? "";
  return value.carrierNumber ?? "";
}

export function invoiceFieldError(value: CheckoutInvoiceFieldsValue): string | null {
  const carrier = value.carrier ?? "member";
  for (const name of invoiceInputNames(value.type, carrier)) {
    const error = invoiceInputError(name, invoiceInputValue(value, name), carrier);
    if (error) return error;
  }
  return null;
}

function invoiceValueFromForm(form: HTMLFormElement): CheckoutInvoiceFieldsValue {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? "").trim();
  const type = text("invoiceType") as CheckoutInvoiceFieldsValue["type"];
  if (type === "company") return { type, businessId: text("invoiceBusinessId"), companyName: text("invoiceCompanyName") };
  if (type === "donation") return { type, donationCode: text("invoiceDonationCode") };
  return { type: "personal", carrier: (text("invoiceCarrier") || "member") as InvoiceCarrier, carrierNumber: text("invoiceCarrierNumber") };
}

function isInvoiceInputName(name: string): name is InvoiceInputName {
  return name === "invoiceCarrierNumber" || name === "invoiceBusinessId" || name === "invoiceCompanyName" || name === "invoiceDonationCode";
}

export function CheckoutInvoiceFields({ disabled = false }: { disabled?: boolean }) {
  const [type, setType] = useState<CheckoutInvoiceFieldsValue["type"]>("personal");
  const [carrier, setCarrier] = useState<InvoiceCarrier>("member");
  const [errors, setErrors] = useState<InvoiceInputErrors>({});
  const fieldsetRef = useRef<HTMLFieldSetElement>(null);
  // dirty：使用者在此欄位輸入過；touched：輸入後離開過、或送出時已檢查過。
  const dirty = useRef(new Set<InvoiceInputName>());
  const touched = useRef(new Set<InvoiceInputName>());
  const activeNames = invoiceInputNames(type, carrier);
  const visibleErrorName = activeNames.find((name) => errors[name]);
  const visibleError = visibleErrorName ? errors[visibleErrorName] : null;

  function resetValidation() {
    dirty.current.clear();
    touched.current.clear();
    setErrors({});
  }

  function updateFieldError(name: InvoiceInputName, value: string) {
    const error = invoiceInputError(name, value.trim(), carrier);
    setErrors((current) => {
      if ((current[name] ?? null) === error) return current;
      const next = { ...current };
      if (error) next[name] = error;
      else delete next[name];
      return next;
    });
  }

  function handleInput(event: FormEvent<HTMLInputElement>) {
    const { name, value } = event.currentTarget;
    if (!isInvoiceInputName(name)) return;
    dirty.current.add(name);
    // 第一次輸入時不打斷；離開過或已有錯誤的欄位，邊輸入邊更新／清除錯誤。
    if (touched.current.has(name) || errors[name]) updateFieldError(name, value);
  }

  function handleBlur(event: FormEvent<HTMLInputElement>) {
    const { name, value } = event.currentTarget;
    if (!isInvoiceInputName(name) || !dirty.current.has(name)) return;
    touched.current.add(name);
    updateFieldError(name, value);
  }

  function handleInvalid(event: FormEvent<HTMLInputElement>) {
    // 瀏覽器原生 required／pattern 擋下送出時，同步顯示對應的中文說明。
    const { name, value } = event.currentTarget;
    if (!isInvoiceInputName(name)) return;
    touched.current.add(name);
    updateFieldError(name, value);
  }

  useEffect(() => {
    const form = fieldsetRef.current?.closest("form");
    if (!form) return;
    // 原生 pattern 擋不住統編檢查碼等規則；送出前以目前選項做完整驗證，
    // 有誤就在結帳流程讀取表單之前停止送出，避免無效發票資料送到伺服器。
    function validateBeforeSubmit(event: Event) {
      const fieldset = fieldsetRef.current;
      if (!fieldset || !form || fieldset.closest("fieldset[disabled]")) return;
      const value = invoiceValueFromForm(form);
      const selectedCarrier = value.carrier ?? "member";
      const nextErrors: InvoiceInputErrors = {};
      for (const name of invoiceInputNames(value.type, selectedCarrier)) {
        touched.current.add(name);
        const error = invoiceInputError(name, invoiceInputValue(value, name), selectedCarrier);
        if (error) nextErrors[name] = error;
      }
      setErrors(nextErrors);
      const firstInvalid = invoiceInputNames(value.type, selectedCarrier).find((name) => nextErrors[name]);
      if (!firstInvalid && !invoiceFieldError(value)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (firstInvalid) fieldset.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus();
    }
    form.addEventListener("submit", validateBeforeSubmit, true);
    return () => form.removeEventListener("submit", validateBeforeSubmit, true);
  }, []);

  const ariaProps = (name: InvoiceInputName, describedBy?: string) => ({
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": [describedBy, visibleErrorName === name ? errorId : undefined].filter(Boolean).join(" ") || undefined,
  });

  return (
    <fieldset ref={fieldsetRef} className="grid gap-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4" disabled={disabled}>
      <legend className="px-1 text-lg font-bold text-slate-950">發票需求</legend>
      <p className="text-sm leading-6 text-amber-950">
        自動電子發票尚未開放。本頁僅收集發票需求，填寫資料或付款成功均不代表已開立；該筆交易的開立主體會依法開立並提供發票，若未收到或未顯示開立主體，請洽客服協助。
      </p>
      <label className="text-sm font-semibold text-slate-800">發票類型
        <select name="invoiceType" value={type} onChange={(event) => { setType(event.target.value as CheckoutInvoiceFieldsValue["type"]); resetValidation(); }} className={inputClass}>
          <option value="personal">個人電子發票</option>
          <option value="company">公司三聯發票</option>
          <option value="donation">捐贈發票</option>
        </select>
      </label>

      {type === "personal" ? <>
        <label className="text-sm font-semibold text-slate-800">載具
          <select name="invoiceCarrier" value={carrier} onChange={(event) => { setCarrier(event.target.value as InvoiceCarrier); resetValidation(); }} className={inputClass}>
            <option value="member">會員載具（結帳 Email）</option>
            <option value="mobile">手機條碼</option>
            <option value="citizen_certificate">自然人憑證</option>
          </select>
        </label>
        {carrier !== "member" ? <label key={carrier} className="text-sm font-semibold text-slate-800">
          {carrier === "mobile" ? "手機條碼" : "自然人憑證載具號碼"}
          <input
            name="invoiceCarrierNumber" onInput={handleInput} onBlur={handleBlur} onInvalid={handleInvalid} {...ariaProps("invoiceCarrierNumber", "invoice-carrier-help")}
            required
            maxLength={carrier === "mobile" ? 8 : 16}
            pattern={carrier === "mobile" ? "/[0-9A-Z.+\\-_]{7}" : "[A-Z]{2}[0-9]{14}"}
            className={inputClass}
          />
          <span id="invoice-carrier-help" className="mt-1 block text-xs font-normal text-slate-600">
            {carrier === "mobile" ? "格式：/ 加 7 碼大寫英數或 . + - _" : "格式：2 碼大寫英文加 14 碼數字"}
          </span>
        </label> : null}
      </> : null}

      {type === "company" ? <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-800">統一編號
          <input name="invoiceBusinessId" onInput={handleInput} onBlur={handleBlur} onInvalid={handleInvalid} {...ariaProps("invoiceBusinessId")} inputMode="numeric" required minLength={8} maxLength={8} pattern="[0-9]{8}" className={inputClass} />
        </label>
        <label className="text-sm font-semibold text-slate-800">發票抬頭
          <input name="invoiceCompanyName" onInput={handleInput} onBlur={handleBlur} onInvalid={handleInvalid} {...ariaProps("invoiceCompanyName")} required maxLength={120} className={inputClass} />
        </label>
      </div> : null}

      {type === "donation" ? <label className="text-sm font-semibold text-slate-800">愛心捐贈碼
        <input name="invoiceDonationCode" onInput={handleInput} onBlur={handleBlur} onInvalid={handleInvalid} {...ariaProps("invoiceDonationCode")} inputMode="numeric" required minLength={3} maxLength={7} pattern="[0-9]{3,7}" className={inputClass} />
      </label> : null}
      <p id={errorId} role="alert" aria-live="polite" className="min-h-5 text-sm font-semibold text-red-700">{visibleError}</p>
    </fieldset>
  );
}
