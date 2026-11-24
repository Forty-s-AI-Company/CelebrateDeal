import { Prisma, type PrismaClient } from "@prisma/client";

import { DISCOUNT_CODE_TYPES, normalizeDiscountCode, type DiscountCodeType } from "@/lib/discount-codes";
import { parseZonedDateTimeLocal } from "@/lib/zoned-date-time";

/** A4-01 merchant back office for discount codes. Every write is bound to the session vendor. */

export const DISCOUNT_CODE_FORM_ERRORS = {
  invalid_code: "折扣碼只能使用 6–32 個英文字母、數字、- 或 _。",
  invalid_value: "折扣金額需為 NT$1 以上的整數；百分比需為 1–100。",
  invalid_period: "請確認開始與結束時間，結束時間必須晚於開始時間。",
  invalid_limit: "使用上限與最低消費需為正整數（最低消費可為 0）。",
  invalid_products: "請至少選擇一個自己商店的商品，或改為適用全部商品。",
  duplicate_code: "這個折扣碼已存在（不分大小寫），請換一個。",
  not_found: "找不到這個折扣碼，可能已被其他成員修改。",
} as const;
export type DiscountCodeFormError = keyof typeof DISCOUNT_CODE_FORM_ERRORS;

export function discountCodeFormErrorMessage(value: unknown) {
  return typeof value === "string" && Object.hasOwn(DISCOUNT_CODE_FORM_ERRORS, value)
    ? DISCOUNT_CODE_FORM_ERRORS[value as DiscountCodeFormError]
    : null;
}

export type DiscountCodeDraft = {
  code: string;
  normalizedCode: string;
  discountType: DiscountCodeType;
  /** Minor units for fixed amounts; whole percent for percentage. */
  discountValue: number;
  currency: "TWD";
  appliesToAllProducts: boolean;
  productIds: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  maxRedemptions: number | null;
  maxRedemptionsPerBuyer: number | null;
  minSubtotalCents: number | null;
  isActive: boolean;
};

const MAX_PRODUCTS = 200;
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,128}$/u;

function formText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Empty is null; otherwise a whole number within the bounds, or undefined when malformed. */
function optionalWholeNumber(raw: string, min: number, max: number): number | null | undefined {
  if (raw === "") return null;
  if (!/^\d{1,10}$/u.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
}

function optionalLocalDate(raw: string, timeZone: string): Date | null | undefined {
  if (raw === "") return null;
  try {
    return parseZonedDateTimeLocal(raw, timeZone);
  } catch {
    return undefined;
  }
}

export function parseDiscountCodeForm(formData: FormData, timeZone: string):
  | { ok: true; draft: DiscountCodeDraft }
  | { ok: false; error: DiscountCodeFormError } {
  const code = formText(formData, "code");
  const normalizedCode = normalizeDiscountCode(code);
  if (!normalizedCode) return { ok: false, error: "invalid_code" };

  const discountType = formText(formData, "discountType");
  if (!(DISCOUNT_CODE_TYPES as readonly string[]).includes(discountType)) return { ok: false, error: "invalid_value" };
  const rawValue = formText(formData, "discountValue");
  const discountValue = discountType === "percentage"
    ? optionalWholeNumber(rawValue, 1, 100)
    : optionalWholeNumber(rawValue, 1, 1_000_000);
  if (discountValue === null || discountValue === undefined) return { ok: false, error: "invalid_value" };

  const startsAt = optionalLocalDate(formText(formData, "startsAt"), timeZone);
  const endsAt = optionalLocalDate(formText(formData, "endsAt"), timeZone);
  if (startsAt === undefined || endsAt === undefined || (startsAt && endsAt && endsAt <= startsAt)) {
    return { ok: false, error: "invalid_period" };
  }

  const maxRedemptions = optionalWholeNumber(formText(formData, "maxRedemptions"), 1, 1_000_000);
  const maxRedemptionsPerBuyer = optionalWholeNumber(formText(formData, "maxRedemptionsPerBuyer"), 1, 1_000);
  const minSubtotal = optionalWholeNumber(formText(formData, "minSubtotal"), 0, 1_000_000);
  if (maxRedemptions === undefined || maxRedemptionsPerBuyer === undefined || minSubtotal === undefined) {
    return { ok: false, error: "invalid_limit" };
  }

  const appliesToAllProducts = formText(formData, "appliesTo") !== "selected";
  const productIds = appliesToAllProducts ? [] : [...new Set(formData.getAll("productIds")
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim()))];
  if (!appliesToAllProducts && (productIds.length === 0 || productIds.length > MAX_PRODUCTS || productIds.some((id) => !PRODUCT_ID.test(id)))) {
    return { ok: false, error: "invalid_products" };
  }

  return {
    ok: true,
    draft: {
      code,
      normalizedCode,
      discountType: discountType as DiscountCodeType,
      discountValue: discountType === "percentage" ? discountValue : discountValue * 100,
      currency: "TWD",
      appliesToAllProducts,
      productIds,
      startsAt,
      endsAt,
      maxRedemptions,
      maxRedemptionsPerBuyer,
      minSubtotalCents: minSubtotal === null ? null : minSubtotal * 100,
      isActive: formData.get("isActive") === "on",
    },
  };
}

export class DiscountCodeAdminError extends Error {
  constructor(readonly code: DiscountCodeFormError) {
    super(code);
    this.name = "DiscountCodeAdminError";
  }
}

type AdminTx = Prisma.TransactionClient;

/** Every selected product must belong to this vendor; never connect by global id. */
async function assertVendorProducts(tx: AdminTx, vendorId: string, draft: DiscountCodeDraft) {
  if (draft.appliesToAllProducts) return;
  const count = await tx.product.count({ where: { vendorId, id: { in: draft.productIds } } });
  if (count !== draft.productIds.length) throw new DiscountCodeAdminError("invalid_products");
}

function codeData(draft: DiscountCodeDraft) {
  return {
    // The CHECK constraint ties normalizedCode to upper(code); both are ASCII only.
    code: draft.code,
    normalizedCode: draft.normalizedCode,
    discountType: draft.discountType,
    discountValue: draft.discountValue,
    currency: draft.currency,
    appliesToAllProducts: draft.appliesToAllProducts,
    startsAt: draft.startsAt,
    endsAt: draft.endsAt,
    maxRedemptions: draft.maxRedemptions,
    maxRedemptionsPerBuyer: draft.maxRedemptionsPerBuyer,
    minSubtotalCents: draft.minSubtotalCents,
    isActive: draft.isActive,
  };
}

function rethrowDuplicate(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new DiscountCodeAdminError("duplicate_code");
  throw error;
}

export async function createDiscountCode(db: PrismaClient, vendorId: string, draft: DiscountCodeDraft) {
  try {
    return await db.$transaction(async (tx) => {
      await assertVendorProducts(tx, vendorId, draft);
      const created = await tx.discountCode.create({ data: { vendorId, ...codeData(draft) }, select: { id: true } });
      if (!draft.appliesToAllProducts) {
        await tx.discountCodeProduct.createMany({ data: draft.productIds.map((productId) => ({ vendorId, discountCodeId: created.id, productId })) });
      }
      return created;
    });
  } catch (error) {
    rethrowDuplicate(error);
  }
}

/**
 * Edits move `revision`, so a checkout quoted under the old terms is refused
 * instead of reserving at a stale price. Orders already placed keep their
 * own redemption snapshot; `redemptionCount` is never written here.
 */
export async function updateDiscountCode(db: PrismaClient, vendorId: string, id: string, draft: DiscountCodeDraft) {
  try {
    return await db.$transaction(async (tx) => {
      await assertVendorProducts(tx, vendorId, draft);
      const updated = await tx.discountCode.updateMany({
        where: { id, vendorId },
        data: { ...codeData(draft), revision: { increment: 1 } },
      });
      if (updated.count !== 1) throw new DiscountCodeAdminError("not_found");
      await tx.discountCodeProduct.deleteMany({ where: { vendorId, discountCodeId: id } });
      if (!draft.appliesToAllProducts) {
        await tx.discountCodeProduct.createMany({ data: draft.productIds.map((productId) => ({ vendorId, discountCodeId: id, productId })) });
      }
      return { id };
    });
  } catch (error) {
    rethrowDuplicate(error);
  }
}

export async function setDiscountCodeActive(db: PrismaClient, vendorId: string, id: string, isActive: boolean) {
  const updated = await db.discountCode.updateMany({
    where: { id, vendorId },
    data: { isActive, revision: { increment: 1 } },
  });
  if (updated.count !== 1) throw new DiscountCodeAdminError("not_found");
}

const PRODUCT_OPTION_SELECT = { id: true, name: true, priceCents: true, currency: true, isActive: true } as const;
export const DISCOUNT_CODE_PRODUCT_OPTION_LIMIT = 200;

/**
 * Product checkboxes for the form: the vendor's latest priced products plus
 * every product the code already links (review m-4), whatever the list
 * limit. The form posts only the boxes it shows, so a linked product missing
 * here would be silently unlinked on save.
 */
export async function discountCodeProductOptions(
  db: Pick<PrismaClient, "product">,
  vendorId: string,
  linkedProductIds: readonly string[] = [],
) {
  const [recent, linked] = await Promise.all([
    db.product.findMany({
      where: { vendorId, priceCents: { gt: 0 } },
      orderBy: { createdAt: "desc" },
      take: DISCOUNT_CODE_PRODUCT_OPTION_LIMIT,
      select: PRODUCT_OPTION_SELECT,
    }),
    linkedProductIds.length > 0
      ? db.product.findMany({ where: { vendorId, id: { in: [...linkedProductIds] } }, select: PRODUCT_OPTION_SELECT })
      : Promise.resolve([]),
  ]);
  const shown = new Set(recent.map((product) => product.id));
  return [...recent, ...linked.filter((product) => !shown.has(product.id))];
}

/** Reserved (pending payment) and redeemed uses per code, for the list page. */
export async function discountCodeUsageByCode(db: PrismaClient, vendorId: string) {
  const rows = await db.discountCodeRedemption.groupBy({
    by: ["discountCodeId", "status"],
    where: { vendorId, status: { in: ["reserved", "redeemed"] } },
    _count: { _all: true },
  });
  const usage = new Map<string, { reserved: number; redeemed: number }>();
  for (const row of rows) {
    const current = usage.get(row.discountCodeId) ?? { reserved: 0, redeemed: 0 };
    if (row.status === "reserved") current.reserved += row._count._all;
    if (row.status === "redeemed") current.redeemed += row._count._all;
    usage.set(row.discountCodeId, current);
  }
  return usage;
}
