import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  isFeatureEnabled,
  type FeatureGateVendor,
  type GatedFeature,
} from "@/lib/vendor-feature-toggles";

/**
 * Server-side module gates (F-001 / F-002, B01-01 / B01-02).
 *
 * `FeatureAccessBoundary` only hides UI. Every Server Action, route handler
 * and server component that belongs to a gated module calls one of these
 * helpers with the vendor it already resolved from the session (or, for
 * buyer/viewer entry points, the vendor that owns the requested record), so a
 * hidden module cannot be reached by direct URL, a hand-made Server Action
 * POST or an API call.
 */

export const FEATURE_DISABLED_CODE = "FEATURE_DISABLED";
export const FEATURE_DISABLED_MESSAGE = "此功能目前尚未開放。";

export class FeatureDisabledError extends Error {
  readonly code = FEATURE_DISABLED_CODE;

  constructor(readonly feature: GatedFeature) {
    super(FEATURE_DISABLED_MESSAGE);
    this.name = "FeatureDisabledError";
  }
}

export { isFeatureEnabled };

/** Server Actions: throws an explicit, typed error when the module is closed. */
export function requireFeature(vendor: FeatureGateVendor | null | undefined, feature: GatedFeature): void {
  if (!isFeatureEnabled(vendor, feature)) throw new FeatureDisabledError(feature);
}

/** Server components: a closed module renders the zh-TW 404 page. */
export function requireFeatureOrNotFound(vendor: FeatureGateVendor | null | undefined, feature: GatedFeature): void {
  if (!isFeatureEnabled(vendor, feature)) notFound();
}

/** Route handlers: a closed module answers 404 without revealing anything else. */
export function featureDisabledResponse(): NextResponse {
  return NextResponse.json(
    { error: FEATURE_DISABLED_MESSAGE, code: FEATURE_DISABLED_CODE },
    { status: 404, headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Route handlers: returns the 404 response when closed, otherwise null. */
export function featureGateResponse(vendor: FeatureGateVendor | null | undefined, feature: GatedFeature): NextResponse | null {
  return isFeatureEnabled(vendor, feature) ? null : featureDisabledResponse();
}

type VendorFeatureReader = Pick<PrismaClient, "vendor">;

/**
 * Buyer, learner and viewer entry points only know the vendor through the
 * record they ask for. Reads the flags of exactly that vendor; an unknown
 * vendor is treated as closed.
 */
export async function loadFeatureGateVendor(db: VendorFeatureReader, vendorId: string): Promise<FeatureGateVendor | null> {
  return db.vendor.findUnique({
    where: { id: vendorId },
    select: { enabledFeatureModules: true, betaFeatureGrants: true },
  });
}

export async function isVendorFeatureEnabled(db: VendorFeatureReader, vendorId: string, feature: GatedFeature): Promise<boolean> {
  return isFeatureEnabled(await loadFeatureGateVendor(db, vendorId), feature);
}

/** Server components that only know the vendor id (learner and viewer pages). */
export async function requireVendorFeatureOrNotFound(db: VendorFeatureReader, vendorId: string, feature: GatedFeature): Promise<void> {
  if (!await isVendorFeatureEnabled(db, vendorId, feature)) notFound();
}

type CourseShape = { commerceDomain?: string | null; fulfillmentType?: string | null };

export function isCourseProduct(product: CourseShape): boolean {
  return product.commerceDomain === "course" || product.fulfillmentType === "course";
}

/**
 * A course product can only be bought while the vendor's courses module is
 * open; otherwise the buyer would pay for a learner portal that answers 404.
 */
export function isProductPurchasable(vendor: FeatureGateVendor | null | undefined, product: CourseShape): boolean {
  return !isCourseProduct(product) || isFeatureEnabled(vendor, "courses");
}

/** Prisma filter that drops course products from buyer-facing lists while courses is closed. */
export async function purchasableProductWhere(db: VendorFeatureReader, vendorId: string): Promise<Prisma.ProductWhereInput> {
  if (await isVendorFeatureEnabled(db, vendorId, "courses")) return {};
  return { NOT: [{ commerceDomain: "course" }, { fulfillmentType: "course" }] };
}

/**
 * Card-binding gate (B01-02). While `funnel_binding` is closed nobody can bind
 * a platform-service card, so publication readiness, live quota admission and
 * team live sharing must not demand one. When the module is opened the
 * original verified-payment-method requirement applies unchanged.
 */
export function isCardBindingRequired(vendor: FeatureGateVendor | null | undefined): boolean {
  return isFeatureEnabled(vendor, "funnel_binding");
}

export async function isCardBindingRequiredForVendor(db: VendorFeatureReader, vendorId: string): Promise<boolean> {
  return isCardBindingRequired(await loadFeatureGateVendor(db, vendorId));
}
