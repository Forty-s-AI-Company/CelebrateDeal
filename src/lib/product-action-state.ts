export type ProductActionError =
  | "invalid_product"
  | "invalid_image_asset"
  | "invalid_course_policy"
  | "invalid_course_owner"
  | "invalid_fulfillment"
  | "invalid_delivery"
  | "media_upload_incomplete"
  | "duplicate_slug"
  | "conflict"
  | "not_found";

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
};

export type ProductActionState = {
  version: number;
  error?: ProductActionError;
  draft?: ProductFormDraft;
};

export const initialProductActionState: ProductActionState = { version: 0 };
