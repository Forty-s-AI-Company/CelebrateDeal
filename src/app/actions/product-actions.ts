"use server";

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { redirect } from "next/navigation";
import { assertServerActionSecurity } from "@/lib/csrf";
import { CourseCommerceDomain } from "@/lib/course-commission";
import { getDb } from "@/lib/db";
import { requireVendorManager } from "@/lib/auth";
import { parseSafeExternalHttpUrl } from "@/lib/external-url";
import { toSlug } from "@/lib/format";
import { ImageAssetReferenceError, resolveReadyImageAsset } from "@/lib/image-assets";
import {
  ProductDeliveryValidationError,
  protectProductDeliveryConfig,
  validateProductDeliveryDraft,
  type ValidatedProductDelivery,
} from "@/lib/product-delivery";
import type { ProductActionError, ProductActionState, ProductFormDraft } from "@/lib/product-action-state";

function text(formData: FormData, key: string, fallback = "") {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : fallback;
}

function optionalText(formData: FormData, key: string) {
  const value = text(formData, key);
  return value.length > 0 ? value : null;
}

const MAX_PRODUCT_INTEGER = 2_147_483_647;
const ProductFulfillmentType = z.enum(["physical", "digital", "service", "course"]);
const ProductIdentifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/u);

function nonNegativeInteger(value: string) {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= MAX_PRODUCT_INTEGER ? parsed : null;
}

function currencyAmountToCents(value: string) {
  if (!/^\d{1,10}(?:\.\d{1,2})?$/u.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const parsed = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(parsed) && parsed <= MAX_PRODUCT_INTEGER ? parsed : null;
}

function boundedDraftText(formData: FormData, key: string, maximum: number) {
  return text(formData, key).slice(0, maximum);
}

function draftFrom(formData: FormData): ProductFormDraft {
  return {
    name: boundedDraftText(formData, "name", 200),
    slug: boundedDraftText(formData, "slug", 200),
    description: boundedDraftText(formData, "description", 10_000),
    price: boundedDraftText(formData, "price", 32),
    compareAt: boundedDraftText(formData, "compareAt", 32),
    currency: boundedDraftText(formData, "currency", 3).toUpperCase() || "TWD",
    inventory: boundedDraftText(formData, "inventory", 16),
    fulfillmentType: boundedDraftText(formData, "fulfillmentType", 32) || "physical",
    courseContentOwnerMembershipId: boundedDraftText(formData, "courseContentOwnerMembershipId", 160),
    coursePromoterShareBps: boundedDraftText(formData, "coursePromoterShareBps", 16),
    deliveryTitle: boundedDraftText(formData, "deliveryTitle", 120),
    deliveryUrl: boundedDraftText(formData, "deliveryUrl", 2_048),
    deliveryInstructions: boundedDraftText(formData, "deliveryInstructions", 4_000),
    deliveryHostConfirmed: formData.get("deliveryHostConfirmed") === "on",
    imageUrl: boundedDraftText(formData, "imageUrl", 2_048),
    imageAssetId: boundedDraftText(formData, "imageAssetId", 160),
    checkoutUrl: boundedDraftText(formData, "checkoutUrl", 2_048),
    isActive: formData.get("isActive") === "on",
  };
}

function productFailure(
  previousState: ProductActionState,
  formData: FormData,
  error: ProductActionError,
): ProductActionState {
  return { version: previousState.version + 1, error, draft: draftFrom(formData) };
}

function parseProductCommercePolicy(formData: FormData) {
  const requestedCommerceDomain = optionalText(formData, "commerceDomain");
  const requestedFulfillmentType = optionalText(formData, "fulfillmentType");
  const inferredFulfillmentType = requestedFulfillmentType
    ?? (requestedCommerceDomain === "course" ? "course" : "physical");
  const fulfillmentType = ProductFulfillmentType.safeParse(inferredFulfillmentType);
  if (!fulfillmentType.success) return { success: false as const, error: "invalid_fulfillment" as const };
  const derivedCommerceDomain = fulfillmentType.data === "course" ? "course" : "merchant";
  const commerceDomain = CourseCommerceDomain.safeParse(requestedCommerceDomain ?? derivedCommerceDomain);
  if (!commerceDomain.success) return { success: false as const, error: "invalid_course_policy" as const };
  if (commerceDomain.data !== derivedCommerceDomain) {
    return { success: false as const, error: "invalid_fulfillment" as const };
  }
  return { success: true as const, commerceDomain: commerceDomain.data, fulfillmentType: fulfillmentType.data };
}

function parseCoursePolicy(formData: FormData, commerceDomain: "merchant" | "course") {
  const courseContentOwnerMembershipId = optionalText(formData, "courseContentOwnerMembershipId");
  if (commerceDomain !== "course") {
    return { success: true as const, courseContentOwnerMembershipId: null, coursePromoterShareBps: null };
  }
  const share = z.coerce.number().int().min(1).max(9_999).safeParse(optionalText(formData, "coursePromoterShareBps"));
  if (!courseContentOwnerMembershipId || !share.success) return { success: false as const };
  return { success: true as const, courseContentOwnerMembershipId, coursePromoterShareBps: share.data };
}

function parseProductInput(formData: FormData) {
  const name = text(formData, "name");
  const slug = toSlug(text(formData, "slug"));
  const isActive = formData.get("isActive") === "on";
  const priceMajor = optionalText(formData, "price");
  const priceCents = priceMajor === null
    ? nonNegativeInteger(text(formData, "priceCents"))
    : currencyAmountToCents(priceMajor);
  const compareAtMajor = optionalText(formData, "compareAt");
  const compareAtLegacy = optionalText(formData, "compareAtCents");
  const compareAtRaw = compareAtMajor ?? compareAtLegacy;
  const compareAtCents = compareAtRaw === null
    ? null
    : compareAtMajor === null
      ? nonNegativeInteger(compareAtRaw)
      : currencyAmountToCents(compareAtRaw);
  const inventory = nonNegativeInteger(text(formData, "inventory"));
  const currency = text(formData, "currency", "TWD").toUpperCase();
  const imageUrlRaw = optionalText(formData, "imageUrl");
  const imageUrl = imageUrlRaw ? parseSafeExternalHttpUrl(imageUrlRaw) : null;
  const checkoutUrlRaw = optionalText(formData, "checkoutUrl");
  const checkoutUrl = checkoutUrlRaw ? parseSafeExternalHttpUrl(checkoutUrlRaw) : null;

  const description = optionalText(formData, "description");
  if (!name || name.length > 200 || !slug || priceCents === null || inventory === null) return null;
  if (description && description.length > 10_000) return null;
  if (isActive && priceCents === 0) return null;
  if (compareAtRaw !== null && (compareAtCents === null || compareAtCents === 0)) return null;
  if (compareAtCents !== null && priceCents !== null && compareAtCents < priceCents) return null;
  if (!/^[A-Z]{3}$/u.test(currency)) return null;
  if ((imageUrlRaw !== null && imageUrl === null) || (checkoutUrlRaw !== null && checkoutUrl === null)) return null;

  return { name, slug, isActive, priceCents, compareAtCents, inventory, currency, imageUrl, checkoutUrl, description };
}

function parseProductRequest(previousState: ProductActionState, formData: FormData) {
  const idRaw = optionalText(formData, "id");
  const id = idRaw && ProductIdentifier.safeParse(idRaw).success ? idRaw : null;
  if (idRaw && !id) return { success: false as const, state: productFailure(previousState, formData, "not_found") };
  const commercePolicy = parseProductCommercePolicy(formData);
  if (!commercePolicy.success) return { success: false as const, state: productFailure(previousState, formData, commercePolicy.error) };
  const coursePolicy = parseCoursePolicy(formData, commercePolicy.commerceDomain);
  if (!coursePolicy.success) return { success: false as const, state: productFailure(previousState, formData, "invalid_course_policy") };
  const productInput = parseProductInput(formData);
  if (!productInput) return { success: false as const, state: productFailure(previousState, formData, "invalid_product") };
  let delivery: ValidatedProductDelivery | null;
  try {
    delivery = validateProductDeliveryDraft({
      fulfillmentType: commercePolicy.fulfillmentType,
      isActive: productInput.isActive,
      title: optionalText(formData, "deliveryTitle"),
      destinationUrl: optionalText(formData, "deliveryUrl"),
      instructions: optionalText(formData, "deliveryInstructions"),
      hostConfirmed: formData.get("deliveryHostConfirmed") === "on",
    });
  } catch (error) {
    if (error instanceof ProductDeliveryValidationError) {
      return { success: false as const, state: productFailure(previousState, formData, "invalid_delivery") };
    }
    throw error;
  }
  const imageUploadPhase = text(formData, "imageUploadPhase");
  if (imageUploadPhase && !["idle", "success"].includes(imageUploadPhase)) {
    return { success: false as const, state: productFailure(previousState, formData, "media_upload_incomplete") };
  }
  const expectedRevision = id ? nonNegativeInteger(text(formData, "revision")) : null;
  if (id && (!expectedRevision || expectedRevision < 1)) {
    return { success: false as const, state: productFailure(previousState, formData, "conflict") };
  }
  return {
    success: true as const, id, expectedRevision, productInput,
    commerceDomain: commercePolicy.commerceDomain,
    fulfillmentType: commercePolicy.fulfillmentType,
    courseContentOwnerMembershipId: coursePolicy.courseContentOwnerMembershipId,
    coursePromoterShareBps: coursePolicy.coursePromoterShareBps,
    imageAssetId: optionalText(formData, "imageAssetId"),
    delivery,
  };
}

type ProductRequest = Extract<ReturnType<typeof parseProductRequest>, { success: true }>;
type ProductDb = ReturnType<typeof getDb>;
type ExistingDeliveryConfig = {
  id: string;
  revision: number;
  status: string;
  fulfillmentType: string;
  destinationEncryptedEnvelope: string | null;
  instructionsEncryptedEnvelope: string | null;
} | null;

function hasPrismaErrorCode(error: unknown, code: string) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === code;
}

async function loadProductDependencies(db: ProductDb, vendorId: string, request: ProductRequest) {
  if (!request.id) {
    const duplicateProduct = await db.product.findFirst({
      where: { vendorId, slug: request.productInput.slug },
      select: { id: true },
    });
    if (duplicateProduct) return { success: false as const, error: "duplicate_slug" as const };
  }
  let imageAsset: Awaited<ReturnType<typeof resolveReadyImageAsset>>;
  try {
    imageAsset = await resolveReadyImageAsset(db, { vendorId, assetId: request.imageAssetId });
  } catch (error) {
    if (error instanceof ImageAssetReferenceError) return { success: false as const, error: "invalid_image_asset" as const };
    throw error;
  }
  const existingProduct = request.id
    ? await db.product.findFirst({
        where: { id: request.id, vendorId },
        select: {
          id: true,
          courseContentOwnerMembershipId: true,
          coursePromoterShareBps: true,
          commerceDomain: true,
          coursePolicyVersion: true,
          revision: true,
          deliveryConfig: {
            select: {
              id: true,
              revision: true,
              status: true,
              fulfillmentType: true,
              destinationEncryptedEnvelope: true,
              instructionsEncryptedEnvelope: true,
            },
          },
        },
      })
    : null;
  if (request.id && !existingProduct) return { success: false as const, error: "not_found" as const };
  if (request.commerceDomain === "course") {
    const ownerMembership = await db.teamMembership.findFirst({
      where: { id: request.courseContentOwnerMembershipId!, vendorId, status: "ACTIVE", leftAt: null },
      select: { id: true },
    });
    if (!ownerMembership) return { success: false as const, error: "invalid_course_owner" as const };
  }
  return { success: true as const, imageAsset, existingProduct };
}

async function persistProduct(
  db: Pick<Prisma.TransactionClient, "product">,
  vendorId: string,
  request: ProductRequest,
  data: Prisma.ProductUncheckedCreateInput,
): Promise<ProductActionError | null> {
  try {
    if (request.id) {
      const updateData: Prisma.ProductUncheckedUpdateManyInput = { ...data, revision: { increment: 1 } };
      delete updateData.vendorId;
      delete updateData.id;
      const updated = await db.product.updateMany({
        where: { id: request.id, vendorId, revision: request.expectedRevision! },
        data: updateData,
      });
      return updated.count === 1 ? null : "conflict";
    }
    await db.product.create({ data });
    return null;
  } catch (error) {
    // Next.js production bundles may load Prisma through a different module
    // boundary, which makes `instanceof` unreliable even though the stable
    // Prisma error code is preserved.
    if (hasPrismaErrorCode(error, "P2002")) return "duplicate_slug";
    throw error;
  }
}

class ProductDeliveryConflictError extends Error {}

async function persistProductDelivery(
  db: Pick<Prisma.TransactionClient, "vendorDeliveryUrlAllowlist" | "productDeliveryConfig">,
  input: {
    vendorId: string;
    productId: string;
    fulfillmentType: ProductRequest["fulfillmentType"];
    delivery: ValidatedProductDelivery | null;
    existing: ExistingDeliveryConfig;
    now: Date;
  },
) {
  const existing = input.existing;
  if (!input.delivery) {
    if (!existing) return;
    const disabled = await db.productDeliveryConfig.updateMany({
      where: { id: existing.id, vendorId: input.vendorId, productId: input.productId, revision: existing.revision },
      data: { status: "disabled", disabledAt: input.now, revision: { increment: 1 } },
    });
    if (disabled.count !== 1) throw new ProductDeliveryConflictError();
    return;
  }

  let allowlistId: string | null = null;
  if (input.delivery.destinationHostname && input.delivery.destinationPathPrefix) {
    const allowlist = await db.vendorDeliveryUrlAllowlist.upsert({
      where: {
        vendorId_hostname_pathPrefix: {
          vendorId: input.vendorId,
          hostname: input.delivery.destinationHostname,
          pathPrefix: input.delivery.destinationPathPrefix,
        },
      },
      create: {
        id: randomUUID(),
        vendorId: input.vendorId,
        hostname: input.delivery.destinationHostname,
        pathPrefix: input.delivery.destinationPathPrefix,
        allowQuery: false,
        status: "active",
      },
      update: { status: "active", allowQuery: false },
      select: { id: true },
    });
    allowlistId = allowlist.id;
  }

  const configId = existing?.id ?? randomUUID();
  const revision = (existing?.revision ?? 0) + 1;
  const protectedConfig = protectProductDeliveryConfig(input.delivery, {
    vendorId: input.vendorId,
    productId: input.productId,
    configId,
    revision,
  });
  const data = {
    vendorId: input.vendorId,
    productId: input.productId,
    allowlistId,
    revision,
    status: input.delivery.status,
    fulfillmentType: input.fulfillmentType,
    deliveryKind: input.delivery.deliveryKind,
    title: input.delivery.title,
    ...protectedConfig,
    activatedAt: input.delivery.status === "active" ? input.now : null,
    disabledAt: null,
  } as const;

  if (!existing) {
    await db.productDeliveryConfig.create({ data: { id: configId, ...data } });
    return;
  }
  const updated = await db.productDeliveryConfig.updateMany({
    where: { id: existing.id, vendorId: input.vendorId, productId: input.productId, revision: existing.revision },
    data,
  });
  if (updated.count !== 1) throw new ProductDeliveryConflictError();
}

export async function upsertProductAction(previousState: ProductActionState, formData: FormData): Promise<ProductActionState> {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const request = parseProductRequest(previousState, formData);
  if (!request.success) return request.state;
  const db = getDb();
  const dependencies = await loadProductDependencies(db, vendor.id, request);
  if (!dependencies.success) return productFailure(previousState, formData, dependencies.error);
  const { existingProduct, imageAsset } = dependencies;
  const policyChanged = request.commerceDomain === "course" && existingProduct !== null
    && (
      existingProduct.commerceDomain !== request.commerceDomain
      || existingProduct.courseContentOwnerMembershipId !== request.courseContentOwnerMembershipId
      || existingProduct.coursePromoterShareBps !== request.coursePromoterShareBps
    );
  const productId = request.id ?? randomUUID();
  const data = {
    ...request.productInput,
    id: productId,
    vendorId: vendor.id,
    imageUrl: imageAsset?.publicUrl ?? request.productInput.imageUrl,
    imageAssetId: imageAsset?.id ?? null,
    commerceDomain: request.commerceDomain,
    fulfillmentType: request.fulfillmentType,
    fulfillmentTypeConfirmed: true,
    courseContentOwnerMembershipId: request.commerceDomain === "course" ? request.courseContentOwnerMembershipId : null,
    coursePromoterShareBps: request.commerceDomain === "course" ? request.coursePromoterShareBps : null,
    ...(existingProduct ? { coursePolicyVersion: existingProduct.coursePolicyVersion + (policyChanged ? 1 : 0) } : {}),
  };
  let persistenceError: ProductActionError | null;
  try {
    persistenceError = await db.$transaction(async (tx) => {
      const productError = await persistProduct(tx, vendor.id, request, data);
      if (productError) return productError;
      await persistProductDelivery(tx, {
        vendorId: vendor.id,
        productId,
        fulfillmentType: request.fulfillmentType,
        delivery: request.delivery,
        existing: existingProduct?.deliveryConfig ?? null,
        now: new Date(),
      });
      return null;
    });
  } catch (error) {
    if (error instanceof ProductDeliveryConflictError || hasPrismaErrorCode(error, "P2002")) {
      persistenceError = request.id ? "conflict" : "duplicate_slug";
    } else {
      throw error;
    }
  }
  if (persistenceError) return productFailure(previousState, formData, persistenceError);
  redirect(`/products?updated=${request.id ? "saved" : "created"}`);
}
