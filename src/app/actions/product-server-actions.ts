"use server";

import { redirect } from "next/navigation";
import { mutateProduct } from "@/app/actions/product-actions";
import { requireVendorManager } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import type { ProductActionState } from "@/lib/product-action-state";

/** Progressive-enhancement fallback for browsers that cannot use the native route transport. */
export async function upsertProductAction(
  previousState: ProductActionState,
  formData: FormData,
): Promise<ProductActionState> {
  await assertServerActionSecurity(formData);
  const vendor = await requireVendorManager();
  const result = await mutateProduct(vendor.id, previousState, formData);
  if (!result.ok) return result.state;
  redirect(result.destination);
}
