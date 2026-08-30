import { NextResponse } from "next/server";
import { completeShippingFulfillment } from "@/lib/commerce-shipping-action";

function browserOrigin(request: Request) {
  const fallback = new URL(request.url).origin;
  const incoming = request.headers.get("origin");
  if (!incoming) return fallback;

  try {
    return new URL(incoming).origin;
  } catch {
    // assertServerActionSecurity already treats an unparsable Origin as absent;
    // keep the redirect on the request origin instead of throwing during the
    // response transport itself.
    return fallback;
  }
}

/**
 * Native POST transport for the nested order-fulfillment flow. The shared
 * helper performs CSRF, origin, MFA, tenant and CAS validation before this
 * route commits a same-origin redirect.
 */
export async function POST(request: Request) {
  const destination = await completeShippingFulfillment(await request.formData());
  return NextResponse.redirect(new URL(destination, browserOrigin(request)), 303);
}
