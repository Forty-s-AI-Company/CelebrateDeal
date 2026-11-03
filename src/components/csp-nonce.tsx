"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * F-156: the per-request CSP nonce for `next/script`. Next.js stamps its own
 * scripts automatically, but `next/script` creates `afterInteractive` scripts
 * in the browser, where only an explicit `nonce` prop reaches the element.
 */
const CspNonceContext = createContext<string | undefined>(undefined);

export function CspNonceProvider({ nonce, children }: { nonce: string | undefined; children: ReactNode }) {
  return <CspNonceContext.Provider value={nonce}>{children}</CspNonceContext.Provider>;
}

export function useCspNonce(): string | undefined {
  return useContext(CspNonceContext);
}
