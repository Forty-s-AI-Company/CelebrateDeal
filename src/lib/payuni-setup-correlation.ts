import { createHmac, randomBytes } from "node:crypto";
import { activePayUniCredentials } from "@/lib/payuni-credentials";

const PAYUNI_SETUP_ORDER = /^pm[A-Za-z0-9_-]{22}$/;

/** PAYUNi echoes MerTradeNo but not CreditToken in the signed UPP callback. */
export function newPayUniSetupOrderNumber() {
  return `pm${randomBytes(16).toString("base64url")}`;
}

/** Rebuilds the nonce without persisting it or trusting browser callback data. */
export function payUniSetupNonce(orderNumber: string) {
  if (!PAYUNI_SETUP_ORDER.test(orderNumber)) throw new Error("Invalid PayUni setup order number.");
  const { key } = activePayUniCredentials();
  return createHmac("sha256", key).update(`CelebrateDeal:payuni:payment-method-setup:v1:${orderNumber}`).digest("base64url");
}
