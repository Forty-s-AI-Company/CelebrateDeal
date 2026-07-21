type ClientAnalyticsBase = {
  liveId: string;
  vendorId: string;
  visitorId: string;
};

export type ClientAnalyticsEvent = ClientAnalyticsBase & (
  | { eventType: "page_view"; payload: { slug: string } }
  | { eventType: "video_play"; payload: { slug: string; ref?: string | null } }
  | { eventType: "play_progress"; payload: { seconds: 30 | 60 | 120 | 300 | 600; ref?: string | null } }
  | { eventType: "product_click"; payload: { productId: string; ref?: string | null } }
  | { eventType: "cta_click"; payload: { label: string; ref?: string | null } }
);

export type ClientAnalyticsFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<{ ok: boolean }>;

const analyticsHeaders = {
  "Content-Type": "application/json",
  "X-CelebrateDeal-Client": "web",
};

/**
 * Sends client analytics without allowing reporting failures to affect the UI.
 * This intentionally does not retry so a failed event is never duplicated.
 */
export async function trackClientAnalytics(
  event: ClientAnalyticsEvent,
  fetcher: ClientAnalyticsFetcher = globalThis.fetch,
): Promise<boolean> {
  try {
    const response = await fetcher("/api/analytics", {
      method: "POST",
      headers: analyticsHeaders,
      body: JSON.stringify(event),
      keepalive: true,
    });

    return response.ok;
  } catch {
    return false;
  }
}
