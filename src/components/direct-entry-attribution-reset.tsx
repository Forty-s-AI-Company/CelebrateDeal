"use client";

import { useEffect } from "react";

export const DIRECT_ENTRY_ATTRIBUTION_ENDPOINT = "/api/affiliate-attribution/direct-entry";

/** Starts a fresh attribution context when a public page was opened directly. */
export function DirectEntryAttributionReset({ isDirectEntry }: { isDirectEntry: boolean }) {
  useEffect(() => {
    if (!isDirectEntry) return;
    void fetch(DIRECT_ENTRY_ATTRIBUTION_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CelebrateDeal-Client": "web",
      },
    }).catch(() => undefined);
  }, [isDirectEntry]);

  return null;
}
