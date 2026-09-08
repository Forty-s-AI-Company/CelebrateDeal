import { z } from "zod";
import { decryptSensitiveValue, encryptSensitiveValue } from "@/lib/sensitive-data";

const FacebookAccessToken = z.string().trim().min(16).max(4_096);

function tokenPurpose(vendorId: string) {
  if (!vendorId.trim()) throw new Error("Tracking credential vendor is required.");
  return `server-side-tracking:${vendorId}:facebook-access-token`;
}

/** Validates and encrypts an access token under a tenant-specific AES-GCM key. */
export function protectFacebookAccessToken(vendorId: string, accessToken: string) {
  const token = FacebookAccessToken.parse(accessToken);
  return encryptSensitiveValue(token, tokenPurpose(vendorId));
}

/** This must only run in a server-owned dispatch path; never pass its result to a client. */
export function unprotectFacebookAccessToken(vendorId: string, encryptedAccessToken: string) {
  return FacebookAccessToken.parse(decryptSensitiveValue(encryptedAccessToken, tokenPurpose(vendorId)));
}
