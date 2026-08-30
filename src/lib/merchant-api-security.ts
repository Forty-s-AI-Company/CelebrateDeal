import { NextResponse } from "next/server";
import { requireSameOriginRequest } from "@/lib/api-security";
import { getCurrentAuth } from "@/lib/auth";
import { verifyCsrfToken } from "@/lib/csrf";

export const MERCHANT_API_CSRF_HEADER = "x-csrf-token";

export type MerchantApiActor = {
  vendorId: string;
  memberId: string;
};

type MerchantApiAuthorization =
  | { actor: MerchantApiActor; response?: never }
  | { actor?: never; response: NextResponse };

/**
 * Verifies browser request provenance before consulting the session, then
 * derives the tenant exclusively from the active owner/admin membership.
 */
export async function requireMerchantApiActor(request: Request): Promise<MerchantApiAuthorization> {
  const boundary = requireSameOriginRequest(request, { requireClientHeader: true });
  if (boundary) return { response: boundary };

  const auth = await getCurrentAuth();
  if (!auth) {
    return { response: NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }) };
  }

  if (
    !auth.vendor
    || !auth.member
    || auth.member.status !== "active"
    || !["owner", "admin"].includes(auth.member.role)
  ) {
    return { response: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }) };
  }

  const csrfValid = await verifyCsrfToken(request.headers.get(MERCHANT_API_CSRF_HEADER));
  if (!csrfValid) {
    return { response: NextResponse.json({ error: { code: "FORBIDDEN" } }, { status: 403 }) };
  }

  return {
    actor: {
      vendorId: auth.vendor.id,
      memberId: auth.member.id,
    },
  };
}
