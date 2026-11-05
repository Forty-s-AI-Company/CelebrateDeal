import { headers } from "next/headers";
import { CSP_NONCE_HEADER, isValidCspNonce } from "@/lib/content-security-policy";

/**
 * The nonce `src/proxy.ts` generated for this request (F-156). Reading request
 * headers makes the calling route dynamic, which a nonce policy requires.
 * Returns undefined when the proxy did not run or the value is malformed.
 */
export async function requestCspNonce(): Promise<string | undefined> {
  const value = (await headers()).get(CSP_NONCE_HEADER);
  return value && isValidCspNonce(value) ? value : undefined;
}
