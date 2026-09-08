/** 財政部電子發票常用識別碼的純函式驗證器。 */
export const MOBILE_BARCODE_PATTERN = /^\/[0-9A-Z.+\-_]{7}$/u;
export const CITIZEN_DIGITAL_CERTIFICATE_PATTERN = /^[A-Z]{2}[0-9]{14}$/u;
export const DONATION_CODE_PATTERN = /^[0-9]{3,7}$/u;

export function isValidMobileBarcode(value: string): boolean {
  return MOBILE_BARCODE_PATTERN.test(value);
}

export function isValidCitizenDigitalCertificate(value: string): boolean {
  return CITIZEN_DIGITAL_CERTIFICATE_PATTERN.test(value);
}

export function isValidDonationCode(value: string): boolean {
  return DONATION_CODE_PATTERN.test(value);
}

/**
 * 台灣公司統編檢核：各位數依 1,2,1,2,1,2,4,1 加權後拆位相加。
 * 一般總和須為 10 的倍數；第七碼為 7 時，總和加一亦可成立。
 */
export function isValidTaiwanBusinessId(value: string): boolean {
  if (!/^[0-9]{8}$/u.test(value)) return false;

  const weights = [1, 2, 1, 2, 1, 2, 4, 1] as const;
  const digits = [...value].map(Number);
  const sum = digits.reduce((total, digit, index) => {
    const product = digit * weights[index]!;
    return total + Math.floor(product / 10) + (product % 10);
  }, 0);

  return sum % 10 === 0 || (digits[6] === 7 && (sum + 1) % 10 === 0);
}

export type CheckoutInvoiceSelection =
  | { type: "personal"; carrier: "member" }
  | { type: "personal"; carrier: "mobile"; carrierNumber: string }
  | { type: "personal"; carrier: "citizen_certificate"; carrierNumber: string }
  | { type: "company"; businessId: string; companyName: string }
  | { type: "donation"; donationCode: string };

export function validateCheckoutInvoiceSelection(value: CheckoutInvoiceSelection): string | null {
  if (value.type === "company") {
    if (!isValidTaiwanBusinessId(value.businessId)) return "請輸入有效的 8 碼統一編號。";
    if (!value.companyName.trim()) return "請填寫發票抬頭。";
    return null;
  }
  if (value.type === "donation") {
    return isValidDonationCode(value.donationCode) ? null : "愛心捐贈碼須為 3 至 7 碼數字。";
  }
  if (value.carrier === "mobile") {
    return isValidMobileBarcode(value.carrierNumber) ? null : "手機條碼須以 / 開頭，後接 7 碼大寫英數或 . + - _。";
  }
  if (value.carrier === "citizen_certificate") {
    return isValidCitizenDigitalCertificate(value.carrierNumber) ? null : "自然人憑證載具須為 2 碼大寫英文加 14 碼數字。";
  }
  return null;
}

export function parseCheckoutInvoiceSelection(input: unknown): CheckoutInvoiceSelection | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.type === "company" && typeof value.businessId === "string" && typeof value.companyName === "string") {
    const result = { type: "company" as const, businessId: value.businessId, companyName: value.companyName.trim() };
    return validateCheckoutInvoiceSelection(result) ? null : result;
  }
  if (value.type === "donation" && typeof value.donationCode === "string") {
    const result = { type: "donation" as const, donationCode: value.donationCode };
    return validateCheckoutInvoiceSelection(result) ? null : result;
  }
  if (value.type === "personal" && value.carrier === "member") return { type: "personal", carrier: "member" };
  if (
    value.type === "personal"
    && (value.carrier === "mobile" || value.carrier === "citizen_certificate")
    && typeof value.carrierNumber === "string"
  ) {
    const result: CheckoutInvoiceSelection = value.carrier === "mobile"
      ? { type: "personal", carrier: "mobile", carrierNumber: value.carrierNumber }
      : { type: "personal", carrier: "citizen_certificate", carrierNumber: value.carrierNumber };
    return validateCheckoutInvoiceSelection(result) ? null : result;
  }
  return null;
}
