"use client";

import { useSyncExternalStore, type AnchorHTMLAttributes } from "react";
import { registrationAttributionHref } from "@/lib/landing-page-attribution";

/** Preserve attribution in the actual href, including open-in-new-tab actions. */
const subscribe = (listener: () => void) => {
  window.addEventListener("popstate", listener);
  return () => window.removeEventListener("popstate", listener);
};
export function LandingPageLink({ href = "", pageId, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { pageId?: string }) {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  return <a {...props} href={registrationAttributionHref(href, search, pageId)} />;
}
