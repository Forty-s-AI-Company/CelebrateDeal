import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";

function purpose(vendorId: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(vendorId)) throw new TypeError("Invalid tracking tenant.");
  return `server-side-tracking:${vendorId}:facebook-access-token`;
}

function validToken(value: string) {
  const token = value.trim();
  // A bounded bearer token cannot inject headers or include pasted diagnostics.
  if (token.length < 16 || token.length > 4096 || !/^[A-Za-z0-9._~+/-]+=*$/u.test(token)) {
    throw new TypeError("Invalid tracking credential.");
  }
  return token;
}

/** Only server-owned settings code may encrypt a credential for this tenant. */
export function protectFacebookAccessToken(vendorId: string, accessToken: string) {
  return encryptSensitiveValue(validToken(accessToken), purpose(vendorId));
}

/** Never serialize this result into client props, job receipts or diagnostics. */
export function unprotectFacebookAccessToken(vendorId: string, encryptedAccessToken: string) {
  try {
    return validToken(decryptSensitiveValue(encryptedAccessToken, purpose(vendorId)));
  } catch {
    // Cryptographic failures expose neither the envelope nor its plaintext.
    throw new Error("Tracking credential unavailable.");
  }
}
