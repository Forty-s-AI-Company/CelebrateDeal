import { LIVE_CHAT_INGRESS_PROOF_HEADER } from "./request-client-ip";

/** Carry only resolver metadata; copying a header never grants it trust. */
export function entryRateLimitHeaders(incoming: Pick<Headers, "get">) {
  const forwarded = new Headers();
  for (const name of [
    "cf-connecting-ip", "x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for",
    LIVE_CHAT_INGRESS_PROOF_HEADER,
  ]) {
    const value = incoming.get(name);
    // Preserve malformed/empty values so the resolver can fail closed.
    if (value !== null) forwarded.set(name, value);
  }
  return forwarded;
}
