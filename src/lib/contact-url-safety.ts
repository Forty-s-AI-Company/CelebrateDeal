import "server-only";

/**
 * Server entry point for brand contact URL checks. The implementation lives in
 * `contact-url-safety-node.ts` (rules shared with the browser preview in
 * `contact-url-rules.ts`); see that file for why it has no `server-only`.
 */
export { isUnsafeContactHostname, parseSafeBrandContactUrl } from "@/lib/contact-url-safety-node";
