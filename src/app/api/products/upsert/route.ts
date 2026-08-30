import { NextResponse } from "next/server";
import { mutateProduct } from "@/app/actions/product-actions";
import { readFormDataBody } from "@/lib/api-security";
import { getCurrentAuth } from "@/lib/auth";
import { assertServerActionSecurity } from "@/lib/csrf";
import { initialProductActionState, type ProductActionError } from "@/lib/product-action-state";

const MANAGER_ROLES = new Set(["owner", "admin"]);
const ERROR_STATUS: Record<ProductActionError, number> = {
  invalid_product: 422,
  invalid_image_asset: 422,
  invalid_course_policy: 422,
  invalid_course_owner: 422,
  invalid_fulfillment: 422,
  invalid_delivery: 422,
  invalid_custom_checkout_fields: 422,
  media_upload_incomplete: 409,
  duplicate_slug: 409,
  conflict: 409,
  not_found: 404,
  unavailable: 500,
};

function safeJson(error: ProductActionError, status = ERROR_STATUS[error]) {
  return NextResponse.json({ error }, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request) {
  const formData = await readFormDataBody(request);
  if (!formData) return safeJson("unavailable", 400);

  try {
    await assertServerActionSecurity(formData);
  } catch {
    return safeJson("unavailable", 403);
  }

  const auth = await getCurrentAuth();
  if (!auth) return safeJson("unavailable", 401);
  if (
    !auth.vendor
    || !auth.member
    || auth.member.status !== "active"
    || !MANAGER_ROLES.has(auth.member.role)
  ) {
    return safeJson("not_found", 403);
  }

  try {
    const result = await mutateProduct(auth.vendor.id, initialProductActionState, formData);
    if (!result.ok) return safeJson(result.state.error ?? "unavailable");
    return NextResponse.redirect(new URL(result.destination, request.url), 303);
  } catch {
    return safeJson("unavailable");
  }
}
