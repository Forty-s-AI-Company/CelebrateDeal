import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  decryptSensitiveValue,
  deriveSensitiveDataKey,
  encryptSensitiveValue,
} from "@/lib/sensitive-data";

const BUYER_ENVELOPE_PURPOSE = "commerce-order-buyer";
const SHIPPING_ENVELOPE_PURPOSE = "commerce-order-shipping";
const IDENTITY_FINGERPRINT_PURPOSE = "commerce-order-identity-fingerprint";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function singleLine(value: string) {
  return value.replace(/\s+/gu, " ").trim();
}

const requiredSingleLine = (label: string, maximumLength: number) => z.string()
  .transform(singleLine)
  .pipe(z.string().min(1, `${label}為必填。`).max(maximumLength, `${label}過長。`))
  .refine((value) => !CONTROL_CHARACTERS.test(value), `${label}包含不允許的控制字元。`);

const optionalSingleLine = (label: string, maximumLength: number) => z.string()
  .transform(singleLine)
  .pipe(z.string().max(maximumLength, `${label}過長。`))
  .refine((value) => !CONTROL_CHARACTERS.test(value), `${label}包含不允許的控制字元。`)
  .transform((value) => value || undefined)
  .optional();

const BuyerContactSchema = z.object({
  name: requiredSingleLine("姓名", 120),
  email: z.string()
    .transform((value) => singleLine(value).toLowerCase())
    .pipe(z.string().email("Email 格式不正確。").max(320, "Email 過長。")),
  phone: optionalSingleLine("電話", 32),
}).strict();

const ShippingAddressSchema = z.object({
  recipientName: requiredSingleLine("收件人", 120),
  phone: requiredSingleLine("收件電話", 32),
  countryCode: z.string()
    .transform((value) => singleLine(value).toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/u, "國家代碼必須是兩碼 ISO 代碼。")),
  postalCode: optionalSingleLine("郵遞區號", 24),
  administrativeArea: requiredSingleLine("縣市／州省", 120),
  locality: requiredSingleLine("鄉鎮市區", 120),
  addressLine1: requiredSingleLine("地址", 240),
  addressLine2: optionalSingleLine("地址補充", 240),
}).strict();

const CommerceOrderPiiSchema = z.object({
  buyer: BuyerContactSchema,
  shipping: ShippingAddressSchema.nullish().transform((value) => value ?? null),
}).strict();

export type CommerceOrderBuyerContact = z.infer<typeof BuyerContactSchema>;
export type CommerceOrderShippingAddress = z.infer<typeof ShippingAddressSchema>;
export type CommerceOrderPii = z.infer<typeof CommerceOrderPiiSchema>;

export type CommerceOrderPiiBinding = {
  vendorId: string;
  orderId: string;
};

export type ProtectedCommerceOrderPii = {
  buyerEncrypted: string;
  shippingEncrypted: string | null;
  buyerNameMasked: string;
  buyerEmailMasked: string;
  buyerPhoneMasked: string | null;
  shippingSummaryMasked: string | null;
  checkoutIdentityHash: string;
};

export class CommerceOrderPiiValidationError extends Error {
  constructor() {
    super("買家或收件資料格式不正確。");
    this.name = "CommerceOrderPiiValidationError";
  }
}

function assertBinding(binding: CommerceOrderPiiBinding) {
  const vendorId = singleLine(binding.vendorId);
  const orderId = singleLine(binding.orderId);
  if (!vendorId || !orderId || CONTROL_CHARACTERS.test(vendorId) || CONTROL_CHARACTERS.test(orderId)) {
    throw new Error("Commerce order PII binding is invalid.");
  }
  return { vendorId, orderId };
}

/**
 * Normalizes and validates checkout PII without exposing field-level values in
 * the thrown error. Callers may safely use the returned value inside the same
 * request/transaction, but must never persist it as plaintext.
 */
export function parseCommerceOrderPii(input: unknown): CommerceOrderPii {
  const parsed = CommerceOrderPiiSchema.safeParse(input);
  if (!parsed.success) {
    // 不轉拋 Zod input，避免上層把姓名、Email 或地址寫進 log。
    throw new CommerceOrderPiiValidationError();
  }
  return parsed.data;
}

function envelopePurpose(basePurpose: string, binding: CommerceOrderPiiBinding) {
  const safeBinding = assertBinding(binding);
  return `${basePurpose}:${safeBinding.vendorId}:${safeBinding.orderId}`;
}

function maskName(name: string) {
  const characters = Array.from(name);
  if (characters.length <= 1) return "＊";
  return `${characters[0]}${"＊".repeat(Math.min(2, characters.length - 1))}`;
}

function maskEmail(email: string) {
  const separator = email.lastIndexOf("@");
  if (separator <= 0) return "***";
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  return `${local.slice(0, 1)}***@${domain}`;
}

function maskPhone(phone?: string) {
  if (!phone) return null;
  const digits = phone.replace(/\D/gu, "");
  return digits.length >= 4 ? `****${digits.slice(-4)}` : "****";
}

function maskShippingSummary(shipping: CommerceOrderShippingAddress | null) {
  if (!shipping) return null;
  return `${shipping.countryCode} · ${shipping.administrativeArea} · ${shipping.locality} · …`;
}

function canonicalIdentityPayload(pii: CommerceOrderPii, vendorId: string) {
  return JSON.stringify({
    vendorId,
    buyer: {
      name: pii.buyer.name,
      email: pii.buyer.email,
      phone: pii.buyer.phone ?? null,
    },
    shipping: pii.shipping ? {
      recipientName: pii.shipping.recipientName,
      phone: pii.shipping.phone,
      countryCode: pii.shipping.countryCode,
      postalCode: pii.shipping.postalCode ?? null,
      administrativeArea: pii.shipping.administrativeArea,
      locality: pii.shipping.locality,
      addressLine1: pii.shipping.addressLine1,
      addressLine2: pii.shipping.addressLine2 ?? null,
    } : null,
  });
}

function fingerprintParsedPii(pii: CommerceOrderPii, vendorId: string) {
  return createHmac("sha256", deriveSensitiveDataKey(IDENTITY_FINGERPRINT_PURPOSE))
    .update(canonicalIdentityPayload(pii, vendorId))
    .digest("base64url");
}

export function createCommerceOrderIdentityHash(input: unknown, vendorId: string) {
  const pii = parseCommerceOrderPii(input);
  const safeVendorId = assertBinding({ vendorId, orderId: "fingerprint" }).vendorId;
  return fingerprintParsedPii(pii, safeVendorId);
}

export function commerceOrderIdentityMatches(
  input: unknown,
  vendorId: string,
  expectedHash: string,
) {
  const actual = Buffer.from(createCommerceOrderIdentityHash(input, vendorId), "utf8");
  const expected = Buffer.from(expectedHash, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function protectCommerceOrderPii(
  input: unknown,
  binding: CommerceOrderPiiBinding,
): ProtectedCommerceOrderPii {
  const pii = parseCommerceOrderPii(input);
  const safeBinding = assertBinding(binding);

  return {
    buyerEncrypted: encryptSensitiveValue(
      JSON.stringify(pii.buyer),
      envelopePurpose(BUYER_ENVELOPE_PURPOSE, safeBinding),
    ),
    shippingEncrypted: pii.shipping ? encryptSensitiveValue(
      JSON.stringify(pii.shipping),
      envelopePurpose(SHIPPING_ENVELOPE_PURPOSE, safeBinding),
    ) : null,
    buyerNameMasked: maskName(pii.buyer.name),
    buyerEmailMasked: maskEmail(pii.buyer.email),
    buyerPhoneMasked: maskPhone(pii.buyer.phone),
    shippingSummaryMasked: maskShippingSummary(pii.shipping),
    checkoutIdentityHash: fingerprintParsedPii(pii, safeBinding.vendorId),
  };
}

export function revealCommerceOrderPii(
  protectedPii: Pick<ProtectedCommerceOrderPii, "buyerEncrypted" | "shippingEncrypted">,
  binding: CommerceOrderPiiBinding,
): CommerceOrderPii {
  const safeBinding = assertBinding(binding);
  try {
    const buyer = JSON.parse(decryptSensitiveValue(
      protectedPii.buyerEncrypted,
      envelopePurpose(BUYER_ENVELOPE_PURPOSE, safeBinding),
    ));
    const shipping = protectedPii.shippingEncrypted ? JSON.parse(decryptSensitiveValue(
      protectedPii.shippingEncrypted,
      envelopePurpose(SHIPPING_ENVELOPE_PURPOSE, safeBinding),
    )) : null;
    return parseCommerceOrderPii({ buyer, shipping });
  } catch (error) {
    if (error instanceof CommerceOrderPiiValidationError) throw error;
    throw new Error("Commerce order PII envelope could not be decrypted.");
  }
}
