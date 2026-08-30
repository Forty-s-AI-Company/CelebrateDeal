import { randomBytes } from "node:crypto";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";

const PURPOSE = "commerce-entitlement-access";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export type CommerceEntitlementAccessBinding = {
  vendorId: string;
  entitlementId: string;
  orderItemId: string;
};

function safeBinding(binding: CommerceEntitlementAccessBinding) {
  for (const value of Object.values(binding)) {
    if (!value || value !== value.trim() || value.length > 191 || CONTROL_CHARACTERS.test(value)) {
      throw new Error("Commerce entitlement access binding is invalid.");
    }
  }
  return binding;
}

function purpose(binding: CommerceEntitlementAccessBinding) {
  const safe = safeBinding(binding);
  return `${PURPOSE}:${safe.vendorId}:${safe.entitlementId}:${safe.orderItemId}`;
}

/** Provisions an internal, encrypted grant capability before payment. */
export function protectCommerceEntitlementAccess(binding: CommerceEntitlementAccessBinding) {
  const safe = safeBinding(binding);
  const payload = JSON.stringify({
    version: 1,
    entitlementId: safe.entitlementId,
    orderItemId: safe.orderItemId,
    grantSecret: randomBytes(32).toString("base64url"),
  });
  return {
    accessEncryptedEnvelope: encryptSensitiveValue(payload, purpose(safe)),
    accessMaskedSummary: `安全授權 · ${safe.entitlementId.slice(-6)}`,
  };
}

export function revealCommerceEntitlementAccess(
  envelope: string,
  binding: CommerceEntitlementAccessBinding,
) {
  const payload = JSON.parse(decryptSensitiveValue(envelope, purpose(binding))) as Record<string, unknown>;
  if (
    payload.version !== 1
    || payload.entitlementId !== binding.entitlementId
    || payload.orderItemId !== binding.orderItemId
    || typeof payload.grantSecret !== "string"
    || payload.grantSecret.length < 32
  ) {
    throw new Error("Commerce entitlement access envelope is invalid.");
  }
  return payload as { version: 1; entitlementId: string; orderItemId: string; grantSecret: string };
}
