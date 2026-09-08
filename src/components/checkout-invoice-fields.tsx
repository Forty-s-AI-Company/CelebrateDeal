"use client";

import { type FormEvent, useState } from "react";
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

const inputClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-950 focus:border-blue-500";

export function invoiceFieldError(value: CheckoutInvoiceFieldsValue): string | null {
  if (value.type === "company") {
    if (!isValidTaiwanBusinessId(value.businessId ?? "")) return "請輸入有效的 8 碼統一編號。";
    return value.companyName?.trim() ? null : "請填寫發票抬頭。";
  }
  if (value.type === "donation") return isValidDonationCode(value.donationCode ?? "") ? null : "愛心捐贈碼須為 3 至 7 碼數字。";
  if (value.carrier === "mobile") return isValidMobileBarcode(value.carrierNumber ?? "") ? null : "手機條碼格式不正確。";
  if (value.carrier === "citizen_certificate") return isValidCitizenDigitalCertificate(value.carrierNumber ?? "") ? null : "自然人憑證載具格式不正確。";
  return null;
}

function invoiceValueFromForm(form: HTMLFormElement): CheckoutInvoiceFieldsValue {
  const data = new FormData(form);
  const text = (name: string) => String(data.get(name) ?? "").trim();
  const type = text("invoiceType") as CheckoutInvoiceFieldsValue["type"];
  if (type === "company") return { type, businessId: text("invoiceBusinessId"), companyName: text("invoiceCompanyName") };
  if (type === "donation") return { type, donationCode: text("invoiceDonationCode") };
  return { type: "personal", carrier: (text("invoiceCarrier") || "member") as NonNullable<CheckoutInvoiceFieldsValue["carrier"]>, carrierNumber: text("invoiceCarrierNumber") };
}

export function CheckoutInvoiceFields({ disabled = false }: { disabled?: boolean }) {
  const [type, setType] = useState<CheckoutInvoiceFieldsValue["type"]>("personal");
  const [carrier, setCarrier] = useState<NonNullable<CheckoutInvoiceFieldsValue["carrier"]>>("member");
  const [error, setError] = useState<string | null>(null);
  function validateCurrentForm(event: FormEvent<HTMLFieldSetElement>) {
    if (event.currentTarget.form) setError(invoiceFieldError(invoiceValueFromForm(event.currentTarget.form)));
  }

  return (
    <fieldset className="grid gap-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4" disabled={disabled} onInput={validateCurrentForm}>
      <legend className="px-1 text-lg font-bold text-slate-950">電子發票</legend>
      <label className="text-sm font-semibold text-slate-800">發票類型
        <select name="invoiceType" value={type} onChange={(event) => setType(event.target.value as CheckoutInvoiceFieldsValue["type"])} className={inputClass}>
          <option value="personal">個人電子發票</option>
          <option value="company">公司三聯發票</option>
          <option value="donation">捐贈發票</option>
        </select>
      </label>

      {type === "personal" ? <>
        <label className="text-sm font-semibold text-slate-800">載具
          <select name="invoiceCarrier" value={carrier} onChange={(event) => setCarrier(event.target.value as typeof carrier)} className={inputClass}>
            <option value="member">會員載具（結帳 Email）</option>
            <option value="mobile">手機條碼</option>
            <option value="citizen_certificate">自然人憑證</option>
          </select>
        </label>
        {carrier !== "member" ? <label className="text-sm font-semibold text-slate-800">
          {carrier === "mobile" ? "手機條碼" : "自然人憑證載具號碼"}
          <input
            name="invoiceCarrierNumber"
            required
            maxLength={carrier === "mobile" ? 8 : 16}
            pattern={carrier === "mobile" ? "/[0-9A-Z.+\\-_]{7}" : "[A-Z]{2}[0-9]{14}"}
            aria-describedby="invoice-carrier-help"
            className={inputClass}
          />
          <span id="invoice-carrier-help" className="mt-1 block text-xs font-normal text-slate-600">
            {carrier === "mobile" ? "格式：/ 加 7 碼大寫英數或 . + - _" : "格式：2 碼大寫英文加 14 碼數字"}
          </span>
        </label> : null}
      </> : null}

      {type === "company" ? <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-800">統一編號
          <input name="invoiceBusinessId" inputMode="numeric" required minLength={8} maxLength={8} pattern="[0-9]{8}" className={inputClass} />
        </label>
        <label className="text-sm font-semibold text-slate-800">發票抬頭
          <input name="invoiceCompanyName" required maxLength={120} className={inputClass} />
        </label>
      </div> : null}

      {type === "donation" ? <label className="text-sm font-semibold text-slate-800">愛心捐贈碼
        <input name="invoiceDonationCode" inputMode="numeric" required minLength={3} maxLength={7} pattern="[0-9]{3,7}" className={inputClass} />
      </label> : null}
      <p role="alert" aria-live="polite" className="min-h-5 text-sm font-semibold text-red-700">{error}</p>
    </fieldset>
  );
}
