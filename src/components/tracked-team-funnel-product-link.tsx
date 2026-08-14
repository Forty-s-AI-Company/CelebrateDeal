"use client";

import type { MouseEvent, ReactNode } from "react";

const clientHeaders = {
  "content-type": "application/json",
  "x-celebratedeal-client": "web",
};

export function partnerProductClickEndpoint(sourcePageSlug: string) {
  return `/api/affiliate-clicks?${new URLSearchParams({ sourcePage: sourcePageSlug }).toString()}`;
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/**
 * Records the server-resolved B-page click before navigating to either the
 * platform checkout or an external product site. Navigation still proceeds
 * when tracking is unavailable; an external purchase is never inferred from
 * a click without a trusted callback.
 */
export function TrackedTeamFunnelProductLink({
  href,
  vendorId,
  liveId,
  sourcePageSlug,
  referralCode,
  slotKey,
  children,
}: {
  href: string;
  vendorId: string;
  liveId: string;
  sourcePageSlug: string;
  referralCode: string | null;
  slotKey: string;
  children: ReactNode;
}) {
  async function trackClick() {
    const payload = {
      vendorId,
      liveId,
      visitorId: window.crypto.randomUUID(),
      landingPath: `/p/${encodeURIComponent(sourcePageSlug)}?product=${encodeURIComponent(slotKey)}`,
      ...(referralCode ? { referralCode } : {}),
    };

    try {
      await fetch(partnerProductClickEndpoint(sourcePageSlug), {
        method: "POST",
        headers: clientHeaders,
        credentials: "same-origin",
        keepalive: true,
        body: JSON.stringify(payload),
      });
    } catch {
      // The outbound product link remains usable when analytics is unavailable.
    }
  }

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented) return;
    if (isModifiedClick(event)) {
      void trackClick();
      return;
    }

    event.preventDefault();
    void trackClick().finally(() => {
      window.location.assign(href);
    });
  }

  return (
    <a
      href={href}
      rel="noreferrer"
      onClick={handleClick}
      className="rounded-xl border border-slate-200 p-4 text-sm font-semibold text-blue-700 hover:border-blue-300 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
    >
      {children}
    </a>
  );
}
