export type ClientAnalyticsEvent = {
  liveId: string;
  vendorId: string;
  visitorId: string;
  eventType: string;
  payload: Record<string, unknown>;
};

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
