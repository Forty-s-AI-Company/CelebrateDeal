import type { CustomCheckoutFields } from "@/lib/commerce-custom-checkout";

export type ProductActionError =
  | "invalid_product"
  | "unsupported_currency"
  | "invalid_image_asset"
  | "invalid_course_policy"
  | "course_feature_disabled"
  | "invalid_course_owner"
  | "invalid_fulfillment"
  | "invalid_delivery"
  | "invalid_custom_checkout_fields"
  | "media_upload_incomplete"
  | "duplicate_slug"
  | "conflict"
  | "not_found"
  | "unavailable";

export type ProductFormDraft = {
  name: string;
  slug: string;
  description: string;
  price: string;
  compareAt: string;
  currency: string;
  inventory: string;
  fulfillmentType: string;
  courseContentOwnerMembershipId: string;
  coursePromoterShareBps: string;
  deliveryTitle: string;
  deliveryUrl: string;
  deliveryInstructions: string;
  deliveryHostConfirmed: boolean;
  imageUrl: string;
  imageAssetId: string;
  checkoutUrl: string;
  isActive: boolean;
  customCheckoutFields?: CustomCheckoutFields;
  upsellProductId?: string;
  downsellProductId?: string;
  upsellDiscount?: string;
};

/** Server-detected invalid fields, keyed by the form control `name` (F-117). */
export type ProductFieldErrors = Partial<Record<
  | "name" | "slug" | "price" | "compareAt" | "inventory" | "description"
  | "imageUrl" | "checkoutUrl" | "courseContentOwnerMembershipId" | "coursePromoterShareBps"
  | "deliveryTitle" | "deliveryUrl" | "deliveryInstructions" | "deliveryHostConfirmed",
  string
>>;

export type ProductActionState = {
  version: number;
  error?: ProductActionError;
  fieldErrors?: ProductFieldErrors;
  draft?: ProductFormDraft;
};

export const initialProductActionState: ProductActionState = { version: 0 };
