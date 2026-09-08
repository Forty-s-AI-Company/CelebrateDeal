import { createHmac } from "node:crypto";
import { decryptSensitiveValue, deriveSensitiveDataKey, encryptSensitiveValue } from "@/lib/sensitive-data";
import {
  parseCheckoutInvoiceSelection,
  type CheckoutInvoiceSelection,
} from "@/lib/taiwan-invoice-validator";

function purpose(vendorId: string, orderId: string) {
  if (!vendorId || !orderId || vendorId.length > 191 || orderId.length > 191) throw new Error("Invoice request binding is invalid.");
  return `commerce-order-invoice:${vendorId}:${orderId}`;
}

export function protectInvoiceRequest(selection: CheckoutInvoiceSelection, vendorId: string, orderId: string) {
  return encryptSensitiveValue(JSON.stringify(selection), purpose(vendorId, orderId));
}

export function revealInvoiceRequest(envelope: string, vendorId: string, orderId: string) {
  const parsed = parseCheckoutInvoiceSelection(JSON.parse(decryptSensitiveValue(envelope, purpose(vendorId, orderId))));
  if (!parsed) throw new Error("Invoice request envelope is invalid.");
  return parsed;
}

export function invoiceBuyerDisplay(selection: CheckoutInvoiceSelection, memberEmail: string) {
  if (selection.type === "company") return `${selection.companyName}（統編末四碼 ${selection.businessId.slice(-4)}）`;
  if (selection.type === "donation") return `捐贈碼 ***${selection.donationCode.slice(-2)}`;
  if (selection.carrier === "member") return memberEmail;
  return `${selection.carrier === "mobile" ? "手機條碼" : "自然人憑證"} ***${selection.carrierNumber.slice(-3)}`;
}

export function createInvoiceCheckoutIdentityHash(baseHash: string, selection: CheckoutInvoiceSelection) {
  return createHmac("sha256", deriveSensitiveDataKey("commerce-order-invoice-fingerprint"))
    .update(JSON.stringify({ baseHash, selection }))
    .digest("base64url");
}
